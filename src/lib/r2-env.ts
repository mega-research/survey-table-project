/**
 * R2 환경 변수 헬퍼
 *
 * - env 누락 시 즉시 throw (silent no-op 방지)
 * - protocol 누락 시 throw (http:// / https:// 필수)
 */

/**
 * CLOUDFLARE_R2_PUBLIC_URL 환경변수를 검증하여 반환합니다.
 * env 미설정 또는 protocol 누락 시 즉시 throw합니다.
 */
export function getR2PublicUrl(): string {
  const url = process.env['CLOUDFLARE_R2_PUBLIC_URL'];
  if (!url) {
    throw new Error('CLOUDFLARE_R2_PUBLIC_URL 환경변수가 설정되지 않았습니다');
  }
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    throw new Error(
      'CLOUDFLARE_R2_PUBLIC_URL 은 http:// 또는 https:// 로 시작해야 합니다',
    );
  }
  return url;
}
