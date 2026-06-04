// 서버 전용 모듈 — 클라이언트에서 import 금지 (R2 SDK 포함)
import { HeadObjectCommand, S3Client } from '@aws-sdk/client-s3';
import * as Sentry from '@sentry/nextjs';

import { extractImageUrlsFromHtml } from '@/lib/image-extractor';
import { moveR2Objects } from '@/lib/image-utils-server';
import { getR2PublicUrl } from '@/lib/r2-env';

const r2Client = new S3Client({
  region: 'auto',
  endpoint: `https://${process.env['CLOUDFLARE_ACCOUNT_ID']}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env['CLOUDFLARE_R2_ACCESS_KEY'] || '',
    secretAccessKey: process.env['CLOUDFLARE_R2_SECRET_KEY'] || '',
  },
});

/**
 * 영구 위치(dstKey)에 객체가 이미 존재하는지 확인.
 * 클라이언트의 stale state 가 같은 publish 를 N 회 시도해도 idempotent 하도록
 * 첫 publish 가 이미 옮겨놓은 객체를 재인식하는 데 사용한다.
 */
async function permanentObjectExists(dstKey: string): Promise<boolean> {
  const bucketName = process.env['CLOUDFLARE_R2_BUCKET'];
  if (!bucketName) return false;
  try {
    await r2Client.send(new HeadObjectCommand({ Bucket: bucketName, Key: dstKey }));
    return true;
  } catch {
    return false;
  }
}

/**
 * promoteSurveyImages가 처리하는 데 필요한 최소 질문 필드 형태.
 * Question / NewQuestion / Partial<Question> 모두 호환됩니다.
 */
export type PromotableQuestion = {
  description?: string | null;
  noticeContent?: string | null;
  tableRowsData?: Array<{ cells: Array<{ imageUrl?: string | null }> }> | null;
};

/**
 * tmp/survey/ prefix를 가진 URL인지 확인합니다.
 */
export function isTmpSurveyUrl(url: string): boolean {
  return url.startsWith(`${getR2PublicUrl()}/tmp/survey/`);
}

/**
 * tmp/survey/ URL을 영구 survey/ URL로 변환합니다 (단순 prefix 치환).
 */
export function tmpToPermanentUrl(url: string): string {
  const publicUrl = getR2PublicUrl();
  return url.replace(`${publicUrl}/tmp/survey/`, `${publicUrl}/survey/`);
}

/**
 * URL에서 R2 key를 추출합니다 (pathname, leading slash 제거).
 */
export function urlToR2Key(url: string): string | null {
  try {
    const u = new URL(url);
    return u.pathname.startsWith('/') ? u.pathname.slice(1) : u.pathname;
  } catch {
    return null;
  }
}

/**
 * 단일 질문에서 tmp/survey/ URL을 모두 추출합니다.
 * - description (TipTap HTML)
 * - noticeContent (TipTap HTML)
 * - tableRowsData[].cells[].imageUrl (직접 URL 필드)
 */
export function extractTmpSurveyUrlsFromQuestion(question: PromotableQuestion): string[] {
  const urls: string[] = [];

  if (question.description) {
    urls.push(...extractImageUrlsFromHtml(question.description).filter(isTmpSurveyUrl));
  }
  if (question.noticeContent) {
    urls.push(...extractImageUrlsFromHtml(question.noticeContent).filter(isTmpSurveyUrl));
  }
  if (question.tableRowsData) {
    for (const row of question.tableRowsData) {
      for (const cell of row.cells) {
        if (cell.imageUrl && isTmpSurveyUrl(cell.imageUrl)) {
          urls.push(cell.imageUrl);
        }
      }
    }
  }

  return [...new Set(urls)];
}

/**
 * 질문 객체 안의 모든 tmp/survey/ URL을 영구 URL로 in-place 치환합니다.
 * mapping에 없는 URL은 그대로 유지됩니다.
 */
export function replaceUrlsInQuestion<T extends PromotableQuestion>(
  question: T,
  mapping: Map<string, string>,
): T {
  if (mapping.size === 0) return question;

  const replaceText = (text: string): string => {
    let updated = text;
    for (const [tmp, perm] of mapping) {
      updated = updated.split(tmp).join(perm);
    }
    return updated;
  };

  return {
    ...question,
    description: question.description ? replaceText(question.description) : question.description,
    noticeContent: question.noticeContent
      ? replaceText(question.noticeContent)
      : question.noticeContent,
    tableRowsData: question.tableRowsData?.map((row) => ({
      ...row,
      cells: row.cells.map((cell) => ({
        ...cell,
        imageUrl:
          cell.imageUrl && mapping.has(cell.imageUrl)
            ? mapping.get(cell.imageUrl)!
            : cell.imageUrl,
      })),
    })),
  };
}

/**
 * 질문 배열 전체의 tmp/survey/ 이미지를 영구 prefix로 promote합니다.
 *
 * 1. 모든 질문에서 tmp/survey/ URL 수집
 * 2. R2 COPY tmp/survey/X → survey/X + DELETE tmp/survey/X
 * 3. 성공한 URL만 질문 배열 내 URL 치환 (description / noticeContent / cell.imageUrl)
 *
 * 실패한 move는 tmp URL 그대로 남음 → Cloudflare 24h lifecycle이 처리.
 * caller 타입 보존: Question / NewQuestion / Partial<Question> 무엇이든 그대로 반환.
 *
 * @returns URL이 치환된 questions 배열 (입력 타입 T 그대로)
 */
export async function promoteSurveyImages<T extends PromotableQuestion>(
  questions: T[],
): Promise<T[]> {
  // 1. 모든 tmp URL 수집
  const allTmpUrls = new Set<string>();
  for (const q of questions) {
    for (const url of extractTmpSurveyUrlsFromQuestion(q)) {
      allTmpUrls.add(url);
    }
  }
  if (allTmpUrls.size === 0) return questions;

  // 2. R2 move pairs 구성
  const pairs = [...allTmpUrls]
    .map((url) => {
      const srcKey = urlToR2Key(url);
      if (!srcKey || !srcKey.startsWith('tmp/survey/')) return null;
      const dstKey = srcKey.replace('tmp/survey/', 'survey/');
      return { srcKey, dstKey, srcUrl: url };
    })
    .filter(
      (p): p is { srcKey: string; dstKey: string; srcUrl: string } => p !== null,
    );

  if (pairs.length === 0) return questions;

  // 3. R2 move 실행
  const moveResult = await moveR2Objects(
    pairs.map(({ srcKey, dstKey }) => ({ srcKey, dstKey })),
  );
  let movedKeys = moveResult.movedKeys;
  let failed = moveResult.failed;

  // 3a. 클라이언트 stale state 로 같은 publish 가 재시도된 케이스는 영구 위치에
  // 객체가 이미 존재. tmp 객체는 첫 publish 가 옮긴 뒤 사라졌지만, dst 가
  // 살아있으면 정상 promote 와 동등 — URL 만 영구로 치환해 idempotent 동작 유지.
  if (failed.length > 0) {
    const recoveredFromExisting: string[] = [];
    for (const srcKey of failed) {
      const pair = pairs.find((p) => p.srcKey === srcKey);
      if (!pair) continue;
      if (await permanentObjectExists(pair.dstKey)) {
        movedKeys = [...movedKeys, { srcKey: pair.srcKey, dstKey: pair.dstKey }];
        recoveredFromExisting.push(srcKey);
      }
    }
    failed = failed.filter((k) => !recoveredFromExisting.includes(k));
  }

  if (failed.length > 0) {
    Sentry.captureMessage(
      `설문 이미지 promote 부분 실패: ${failed.length}개 객체가 tmp 에 잔존`,
      {
        level: 'warning',
        tags: { operation: 'image_promote', kind: 'survey' },
        extra: { failedKeys: failed },
      },
    );
  }

  // 4. 성공한 URL만 mapping 구성 (이미 idempotency 처리됨)
  const movedSrcKeys = new Set(movedKeys.map((m) => m.srcKey));
  const publicUrl = getR2PublicUrl();
  const mapping = new Map<string, string>();
  for (const { srcKey, srcUrl } of pairs) {
    if (movedSrcKeys.has(srcKey)) {
      const dstKey = srcKey.replace('tmp/survey/', 'survey/');
      const dstUrl = `${publicUrl}/${dstKey}`;
      mapping.set(srcUrl, dstUrl);
    }
  }

  // 5. 질문 배열 전체에서 URL 치환
  return questions.map((q) => replaceUrlsInQuestion(q, mapping));
}
