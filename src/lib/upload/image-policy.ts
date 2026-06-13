/**
 * 이미지 업로드 입력 위생 정책 — POST /api/upload/image 라우트가 사용한다.
 * - 감지된 MIME(detectImageKind 결과)으로 확장자를 결정해 파일명 의존을 제거한다.
 * - 변환 스킵 경로에서 파일명 확장자를 보간할 때 mail/notice 첨부 라우트와 동일한
 *   sanitize 규칙(영숫자만·16자 절단·bin 폴백)을 적용한다.
 * - SVG 본문 스크립트 가드는 앞 256KB 만이 아니라 전체 본문을 검사한다.
 */

/**
 * 감지된 이미지 MIME 을 저장 확장자로 매핑.
 * 파일명에 의존하지 않고 detectImageKind 결과만으로 확장자를 정한다.
 */
export const IMAGE_KIND_TO_EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/bmp': 'bmp',
  'image/svg+xml': 'svg',
};

/** 감지된 MIME 으로 확장자 반환. 매핑에 없으면 null. */
export function imageKindToExt(mime: string): string | null {
  if (!mime) return null;
  return IMAGE_KIND_TO_EXT[mime] ?? null;
}

/**
 * 파일명 유래 확장자 sanitize — mail/notice 첨부 라우트의 safeExt 규칙과 대칭.
 * 영숫자만 남기고 16자로 절단, 남는 게 없으면 'bin' 폴백.
 */
export function sanitizeImageExt(ext: string): string {
  return ext.replace(/[^a-zA-Z0-9]/g, '').slice(0, 16).toLowerCase() || 'bin';
}

/**
 * SVG 본문에 스크립트/이벤트 핸들러/javascript: URL 이 있는지 전체 본문을 검사.
 * 기존 라우트는 앞 256KB 만 검사해 SVG 최대 10MB 의 뒷부분에 숨긴 스크립트를
 * 놓치는 갭이 있었다. 전체 본문을 UTF-8 로 해석해 검사한다.
 */
export function svgBodyHasScript(buffer: Buffer): boolean {
  const text = buffer.toString('utf8');
  return /<script|on\w+\s*=|javascript:/i.test(text);
}
