import * as Sentry from '@sentry/nextjs';

import { extractImageUrlsFromHtml } from '@/lib/image-extractor';
import { moveR2Objects } from '@/lib/image-utils-server';
import { getR2PublicUrl } from '@/lib/r2-env';

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
export function urlToR2Key(url: string): string | null {
  try {
    const u = new URL(url);
    return u.pathname.startsWith('/') ? u.pathname.slice(1) : u.pathname;
  } catch {
    return null;
  }
}

/**
 * 메일 bodyHtml의 tmp/mail/ 이미지를 영구 prefix로 promote합니다.
 *
 * 1. tmp/mail/ URL 추출
 * 2. R2 COPY tmp/mail/X → mail/X + DELETE tmp/mail/X
 * 3. bodyHtml의 URL prefix 일괄 치환 (성공한 것만)
 *
 * 실패한 항목은 tmp URL 그대로 남음 → Cloudflare 24h lifecycle이 처리.
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

  const { movedKeys, failed } = await moveR2Objects(pairs);

  if (failed.length > 0) {
    Sentry.captureMessage(
      `메일 이미지 promote 부분 실패: ${failed.length}개 객체가 tmp 에 잔존`,
      {
        level: 'warning',
        tags: { operation: 'image_promote', kind: 'mail' },
        extra: { failedKeys: failed },
      },
    );
  }

  // 성공한 URL만 치환 (실패한 건 tmp URL 그대로 — lifecycle 처리)
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
