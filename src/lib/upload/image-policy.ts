/**
 * 이미지 업로드 입력 위생 정책 — /api/upload/image·/api/upload/avatar 라우트가 사용한다.
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

/**
 * 파일 첫 16바이트로 실제 이미지 형식을 감지 (defense in depth).
 * MIME 헤더가 위조되어도 magic byte 로 차단한다. 감지 불가면 null.
 *
 * 이미지 업로드 라우트가 둘(설문·메일 본문 / 아바타)이라 정책 모듈이 집이다 —
 * 한쪽에만 새 형식이 추가되면 같은 파일이 라우트마다 다른 판정을 받는다.
 */
export function detectImageKind(buf: Buffer): string | null {
  // JPEG: FF D8 FF
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47 &&
    buf[4] === 0x0d &&
    buf[5] === 0x0a &&
    buf[6] === 0x1a &&
    buf[7] === 0x0a
  )
    return 'image/png';
  // GIF: 47 49 46 38
  if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x38) return 'image/gif';
  // WebP: 52 49 46 46 .. .. .. .. 57 45 42 50
  if (
    buf[0] === 0x52 &&
    buf[1] === 0x49 &&
    buf[2] === 0x46 &&
    buf[3] === 0x46 &&
    buf[8] === 0x57 &&
    buf[9] === 0x45 &&
    buf[10] === 0x42 &&
    buf[11] === 0x50
  )
    return 'image/webp';
  // BMP: 42 4D
  if (buf[0] === 0x42 && buf[1] === 0x4d) return 'image/bmp';
  // SVG: starts with '<'
  if (buf[0] === 0x3c) return 'image/svg+xml';
  return null;
}

/**
 * 아바타 업로드 정책 — 라우트(/api/upload/avatar)와 프로필 화면이 **같은 값을 본다**.
 *
 * 두 벌로 두면 "서버와 같은 값이어야 한다" 는 주석만 남고 한쪽만 고쳐진다. 서버가 유일한
 * 판정자지만 화면이 먼저 걸러야 5MB 를 올리고 나서 거부당하지 않는다.
 *
 * SVG·GIF 가 없는 것이 설문 이미지 정책과 갈리는 지점이다 — 아바타는 벡터일 이유가 없고
 * 인라인 스크립트 위험만 남으며, 애니메이션도 필요 없다.
 */
export const AVATAR_UPLOAD_POLICY = {
  allowedTypes: ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/bmp'],
  maxBytes: 5 * 1024 * 1024,
  /** 저장 해상도 — 헤더 30px·프로필 72px 표시에 2배수까지 충분하다. */
  sizePx: 256,
} as const;

/** 파일 대화상자 필터에 쓸 accept 문자열 — 정책 하나에서 파생한다. */
export const AVATAR_ACCEPT_ATTR = AVATAR_UPLOAD_POLICY.allowedTypes.join(',');

/** 정책 위반 문구 — 라우트와 화면이 같은 문장을 쓴다. */
export const AVATAR_TYPE_ERROR = '지원하지 않는 파일 형식입니다. JPG, PNG, WebP, BMP만 업로드 가능합니다.';
export const AVATAR_SIZE_ERROR = '파일 크기는 5MB 이하여야 합니다.';
