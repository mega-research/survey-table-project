import { permanentObjectExists, urlToR2Key } from '@/lib/r2-client';
import * as Sentry from '@sentry/nextjs';

import { extractImageUrlsFromHtml } from '@/lib/image-extractor';
import { copyR2Objects } from '@/lib/image-utils-server';
import { getR2PublicUrl } from '@/lib/r2-env';

/**
 * promote 가 최종 실패했을 때 throw 되는 에러.
 * 저장(메일 템플릿 create/update) 흐름이 이를 catch 해 트랜잭션을 abort 시키도록 한다.
 * (notice-attachment-promote.ts 의 NoticeAttachmentPromoteError 와 동일 패턴)
 */
export class MailImagePromoteError extends Error {
  failedKeys: string[];
  constructor(failedKeys: string[]) {
    super(
      `메일 이미지 promote 실패: ${failedKeys.length}개 객체가 영구 위치로 이동되지 못함`,
    );
    this.failedKeys = failedKeys;
    this.name = 'MailImagePromoteError';
  }
}

/**
 * tmp/mail/ prefix를 가진 URL만 추출합니다.
 * 영구 URL이나 외부 URL, 다른 kind의 tmp URL은 무시합니다.
 */
export function extractTmpMailUrls(html: string): string[] {
  if (!html) return [];
  const allUrls = extractImageUrlsFromHtml(html);
  const prefix = `${getR2PublicUrl()}/tmp/mail/`;
  return [...new Set(allUrls.filter((url) => url.startsWith(prefix)))];
}

/**
 * tmp/mail/ URL을 영구 mail/ URL로 변환합니다 (단순 prefix 치환).
 */
export function tmpToPermanentUrl(tmpUrl: string): string {
  const publicUrl = getR2PublicUrl();
  return tmpUrl.replace(`${publicUrl}/tmp/mail/`, `${publicUrl}/mail/`);
}

/**
 * URL에서 R2 key를 추출합니다 (pathname, leading slash 제거).
 */

/**
 * 메일 bodyHtml의 tmp/mail/ 이미지를 영구 prefix로 promote합니다.
 *
 * 1. tmp/mail/ URL 추출
 * 2. R2 COPY tmp/mail/X → mail/X (copy-only, 원본 미삭제)
 * 3. bodyHtml의 URL prefix 일괄 치환 (성공한 것만)
 *
 * 복구 후에도 실패가 남으면 MailImagePromoteError throw — caller(템플릿 저장 흐름)가
 * 이를 catch 해 abort 해야 한다. tmp 원본은 copy-only 라 그대로 남아 재시도 가능(무해).
 * tmp 잔여물은 R2 lifecycle(tmp/ 24h) 위임 — 대시보드 규칙 존재 확인 필요(키 권한으로 코드에서 미검증).
 *
 * @returns 치환된 bodyHtml
 */
export async function promoteMailImages(bodyHtml: string): Promise<string> {
  const tmpUrls = extractTmpMailUrls(bodyHtml);
  if (tmpUrls.length === 0) return bodyHtml;

  const pairs = tmpUrls
    .map((url) => {
      const srcKey = urlToR2Key(url);
      if (!srcKey || !srcKey.startsWith('tmp/mail/')) return null;
      const dstKey = srcKey.replace('tmp/mail/', 'mail/');
      return { srcKey, dstKey };
    })
    .filter((p): p is { srcKey: string; dstKey: string } => p !== null);

  if (pairs.length === 0) return bodyHtml;

  const moveResult = await copyR2Objects(pairs);
  let movedKeys = moveResult.movedKeys;
  let failed = moveResult.failed;

  // 클라이언트 stale state 로 같은 publish 가 재시도된 케이스는 영구 위치에
  // 객체가 이미 존재. tmp 객체는 copy-only 라 항상 남아있지만, dst 가
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
    // copy-only 이므로 이번 호출에서 이미 영구 위치로 copy 한 객체(movedKeys)를
    // 롤백할 필요가 없다 — tmp 원본이 그대로 남아있어 재시도하면 다시 copy 될 뿐이고,
    // dst 삭제는 과거 "유일 사본(dst) 삭제 사고"의 원인이었으므로 의도적으로 하지 않는다.
    Sentry.captureMessage(
      `메일 이미지 promote 최종 실패: ${failed.length}개 (tmp 원본 보존 — 재시도 가능)`,
      {
        level: 'error',
        tags: { operation: 'image_promote', kind: 'mail' },
        extra: { failedKeys: failed },
      },
    );
    throw new MailImagePromoteError(failed);
  }

  // 여기 도달했다는 것은 전체가 성공(또는 idempotent 복구)했다는 뜻 —
  // 실패가 남아있었다면 위에서 이미 throw 했다.
  const publicUrl = getR2PublicUrl();
  let updated = bodyHtml;
  for (const { srcKey, dstKey } of movedKeys) {
    const srcUrl = `${publicUrl}/${srcKey}`;
    const dstUrl = `${publicUrl}/${dstKey}`;
    // split/join으로 정확 매칭 치환 (regex special char 이슈 회피)
    updated = updated.split(srcUrl).join(dstUrl);
  }

  return updated;
}
