/**
 * 첨부 파일 업로드 정책 — mail-attachment와 notice-attachment 라우트가 공유한다.
 * - MIME 화이트리스트 (실행 가능 형식 차단, Office/HWP/PDF/ZIP/이미지 허용)
 * - 확장자 우선 정책 (브라우저가 file.type 을 빈 문자열로 보내는 hwp/hwpx 케이스 보강)
 * - 파일명 검증 (path traversal·윈도우 reserved 문자·NUL/CR/LF 차단)
 */

export const MIN_FILE_BYTES = 1;

export const ALLOWED_MIME = new Set<string>([
  'application/pdf',
  'application/zip',
  'application/x-zip-compressed',
  'application/msword',
  'application/vnd.ms-excel',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.hancom.hwp',
  'application/x-hwp',
  'application/haansofthwp',
  'application/hwp',
  'application/vnd.hancom.hwpx',
  'application/haansofthwpx',
  'application/hwp+zip',
  'text/plain',
  'text/csv',
]);

const ALLOWED_IMAGE_PREFIX = 'image/';

export const EXT_TO_MIME: Record<string, string> = {
  hwp: 'application/vnd.hancom.hwp',
  hwpx: 'application/vnd.hancom.hwpx',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  pdf: 'application/pdf',
  zip: 'application/zip',
  txt: 'text/plain',
  csv: 'text/csv',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  bmp: 'image/bmp',
};

export const SAFE_FILENAME_RE = /^[^\\/:*?"<>|\x00-\x1f]{1,200}$/;

// notice 전용 prefix — mail-attachment 와 키 공간 분리
export const TMP_NOTICE_ATTACHMENT_PREFIX = 'tmp/notice-attachment/';
export const NOTICE_ATTACHMENT_PREFIX = 'notice-attachment/';

export function isAllowedMime(mime: string): boolean {
  if (!mime) return false;
  if (ALLOWED_MIME.has(mime)) return true;
  if (mime.startsWith(ALLOWED_IMAGE_PREFIX)) return true;
  return false;
}

export function getFileExt(filename: string): string {
  const idx = filename.lastIndexOf('.');
  if (idx < 0 || idx === filename.length - 1) return '';
  return filename.slice(idx + 1).toLowerCase();
}

export function resolveAttachmentType(
  filename: string,
  mime: string,
): { mime: string } | null {
  const ext = getFileExt(filename);
  if (ext && ext in EXT_TO_MIME) {
    return { mime: mime && isAllowedMime(mime) ? mime : EXT_TO_MIME[ext] };
  }
  if (mime && isAllowedMime(mime)) {
    return { mime };
  }
  return null;
}

export function validateFilename(name: string): string | null {
  const trimmed = name.trim();
  if (trimmed.length === 0) return '파일명이 비어있습니다.';
  if (trimmed.length > 200) return '파일명이 너무 깁니다 (최대 200자).';
  if (!SAFE_FILENAME_RE.test(trimmed)) return '파일명에 사용할 수 없는 문자가 있습니다.';
  if (trimmed.startsWith('.') && trimmed.lastIndexOf('.') === 0) {
    return '파일명이 비어있습니다 (확장자만 있음).';
  }
  if (trimmed === '.' || trimmed === '..') {
    return '유효하지 않은 파일명입니다.';
  }
  return null;
}
