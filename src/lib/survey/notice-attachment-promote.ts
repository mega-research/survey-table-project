// 서버 전용 모듈 — 클라이언트에서 import 금지 (R2 SDK 포함)
import { permanentObjectExists, urlToR2Key } from '@/lib/r2-client';
import * as Sentry from '@sentry/nextjs';

import {
  extractAttachmentHrefsFromHtml,
  extractPermanentAttachmentKeysFromHtml,
} from '@/components/ui/rich-text-editor/file-attachment-html-utils';
import { copyR2Objects } from '@/lib/image-utils-server';
import { getR2PublicUrl } from '@/lib/r2-env';
import {
  NOTICE_ATTACHMENT_PREFIX,
  TMP_NOTICE_ATTACHMENT_PREFIX,
} from '@/lib/upload/attachment-policy';

export { extractPermanentAttachmentKeysFromHtml };

export type PromotableNoticeQuestion = {
  type?: string;
  noticeContent?: string | null;
};

/**
 * promote 가 최종 실패했을 때 throw 되는 에러.
 * publish 흐름이 이를 catch 해 트랜잭션을 abort 시키도록 한다.
 * (mail/services/attachment-promote.ts 의 AttachmentPromoteError 와 동일 패턴)
 */
export class NoticeAttachmentPromoteError extends Error {
  failedKeys: string[];
  constructor(failedKeys: string[]) {
    super(
      `공지사항 첨부 promote 실패: ${failedKeys.length}개 객체가 영구 위치로 이동되지 못함`,
    );
    this.failedKeys = failedKeys;
    this.name = 'NoticeAttachmentPromoteError';
  }
}

export function isTmpNoticeAttachmentUrl(url: string): boolean {
  return url.startsWith(`${getR2PublicUrl()}/${TMP_NOTICE_ATTACHMENT_PREFIX}`);
}


/**
 * HTML 안의 `<a data-file-attachment="true">` href 중 tmp/notice-attachment/ prefix 만 추출.
 * 중복 제거된 배열 반환.
 */
export function extractTmpNoticeAttachmentUrlsFromHtml(html: string): string[] {
  return extractAttachmentHrefsFromHtml(html).filter((url) =>
    isTmpNoticeAttachmentUrl(url),
  );
}

/**
 * 질문 안 모든 noticeContent 의 tmp 첨부 URL 추출 (중복 제거).
 */
export function extractTmpNoticeAttachmentUrlsFromQuestion(
  question: PromotableNoticeQuestion,
): string[] {
  if (!question.noticeContent) return [];
  return extractTmpNoticeAttachmentUrlsFromHtml(question.noticeContent);
}

/**
 * noticeContent HTML 안의 URL 을 mapping 으로 치환. mapping 없는 URL 은 유지.
 * mapping 비어있으면 same reference 반환 (참조 동등성 보존).
 *
 * URL 치환 후 동일 split/join 패스로 `data-key` 의 R2 key 부분 문자열도 함께 변환.
 * (TipTap FileAttachment 의 `data-key` 는 URL 의 pathname 과 1:1 매칭이라 안전.)
 */
export function replaceNoticeAttachmentUrlsInQuestion<
  T extends PromotableNoticeQuestion,
>(question: T, mapping: Map<string, string>): T {
  if (mapping.size === 0) return question;
  if (!question.noticeContent) return question;

  let updated = question.noticeContent;
  for (const [tmp, perm] of mapping) {
    updated = updated.split(tmp).join(perm);
    const tmpKey = urlToR2Key(tmp);
    const permKey = urlToR2Key(perm);
    if (tmpKey && permKey && tmpKey !== permKey) {
      updated = updated.split(tmpKey).join(permKey);
    }
  }
  return { ...question, noticeContent: updated };
}

/**
 * 질문 배열 안 모든 tmp/notice-attachment/ URL 을 영구 prefix 로 promote.
 * survey-image-promote.ts 와 동일 패턴 (R2 copy-only + URL split/join 치환).
 *
 * copy-only — 원본(tmp)은 삭제하지 않는다. 실패한 copy 는 tmp URL 그대로 남아
 * 재시도 가능(무해) — Cloudflare 24h lifecycle 이 최종 청소.
 * tmp 잔여물은 R2 lifecycle(tmp/ 24h) 위임 — 대시보드 규칙 존재 확인 필요(키 권한으로 코드에서 미검증).
 *
 * 과거에는 이전 영구 첨부 키 중 새 publish 영구 키에 없는 것을 orphan 으로 간주해
 * R2 에서 DELETE 했다(2번째 인자 `options.previousQuestions`). 이 cleanup 은 제거됨 —
 * 발행 스냅샷(survey_versions)·복제 설문·보관함이 같은 영구 키를 계속 참조할 수 있어
 * 확인 없이 지우면 라이브 콘텐츠가 파괴된다.
 */
export async function promoteNoticeAttachments<T extends PromotableNoticeQuestion>(
  questions: T[],
): Promise<T[]> {
  const allTmpUrls = new Set<string>();
  for (const q of questions) {
    for (const url of extractTmpNoticeAttachmentUrlsFromQuestion(q)) {
      allTmpUrls.add(url);
    }
  }

  const pairs = [...allTmpUrls]
    .map((url) => {
      const srcKey = urlToR2Key(url);
      if (!srcKey || !srcKey.startsWith(TMP_NOTICE_ATTACHMENT_PREFIX)) return null;
      const dstKey = srcKey.replace(
        TMP_NOTICE_ATTACHMENT_PREFIX,
        NOTICE_ATTACHMENT_PREFIX,
      );
      return { srcKey, dstKey, srcUrl: url };
    })
    .filter(
      (p): p is { srcKey: string; dstKey: string; srcUrl: string } => p !== null,
    );

  let result = questions;

  if (pairs.length > 0) {
    const movePairs = pairs.map(({ srcKey, dstKey }) => ({ srcKey, dstKey }));

    let allMoved = [] as Array<{ srcKey: string; dstKey: string }>;
    let stillFailed: string[] = [];

    const first = await copyR2Objects(movePairs);
    allMoved = first.movedKeys;
    stillFailed = first.failed;

    // R2 read-after-write 일시 불일치나 transient 네트워크 케이스 대비 1회 retry
    if (stillFailed.length > 0) {
      const retryPairs = movePairs.filter((p) => stillFailed.includes(p.srcKey));
      await new Promise((resolve) => setTimeout(resolve, 500));
      const second = await copyR2Objects(retryPairs);
      allMoved = [...allMoved, ...second.movedKeys];
      stillFailed = second.failed;
    }

    // 클라이언트 stale state 로 같은 publish 가 재시도된 케이스는 영구 위치에 객체가
    // 이미 존재. tmp 객체는 copy-only 라 항상 남아있지만, dst 가 이미 살아있으면
    // 정상 promote 와 동등 — URL 만 영구로 치환해 idempotent 동작 유지.
    if (stillFailed.length > 0) {
      const recoveredFromExisting: string[] = [];
      for (const srcKey of stillFailed) {
        const pair = movePairs.find((p) => p.srcKey === srcKey);
        if (!pair) continue;
        if (await permanentObjectExists(pair.dstKey)) {
          allMoved.push(pair);
          recoveredFromExisting.push(srcKey);
        }
      }
      stillFailed = stillFailed.filter((k) => !recoveredFromExisting.includes(k));
    }

    if (stillFailed.length > 0) {
      // copy-only 이므로 이번 호출에서 이미 영구 위치로 copy 한 객체(allMoved)를
      // 롤백할 필요가 없다 — tmp 원본이 그대로 남아있어 재시도하면 다시 copy 될 뿐이고,
      // dst 삭제는 과거 "유일 사본(dst) 삭제 사고"의 원인이었으므로 의도적으로 하지 않는다.
      Sentry.captureMessage(
        `공지사항 첨부 promote 최종 실패: ${stillFailed.length}개 (tmp 원본 보존 — 재시도 가능)`,
        {
          level: 'error',
          tags: { operation: 'notice_attachment_promote' },
          extra: { failedKeys: stillFailed },
        },
      );
      throw new NoticeAttachmentPromoteError(stillFailed);
    }

    const movedSrcKeys = new Set(allMoved.map((m) => m.srcKey));
    const publicUrl = getR2PublicUrl();
    const mapping = new Map<string, string>();
    for (const { srcKey, srcUrl } of pairs) {
      if (movedSrcKeys.has(srcKey)) {
        const dstKey = srcKey.replace(
          TMP_NOTICE_ATTACHMENT_PREFIX,
          NOTICE_ATTACHMENT_PREFIX,
        );
        mapping.set(srcUrl, `${publicUrl}/${dstKey}`);
      }
    }

    result = questions.map((q) => replaceNoticeAttachmentUrlsInQuestion(q, mapping));
  }

  // orphan cleanup(이전 영구 키 중 새 publish 에 없는 것 DELETE)은 의도적으로 제거됨.
  // 발행 스냅샷·복제 설문·보관함이 같은 영구 첨부 키를 참조할 수 있어, 이번 publish 의
  // diff 만 보고 지우면 다른 곳에서 여전히 유효한 첨부가 함께 사라진다.
  return result;
}
