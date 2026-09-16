/**
 * label·filename 양쪽 모두 비어있을 때 사용하는 fallback 라벨.
 * NodeView 와 renderHTML 서버 직렬화 양쪽에서 동일 텍스트를 보장한다.
 */
export const FILE_ATTACHMENT_DEFAULT_LABEL = '첨부 파일';

/**
 * 바이트 크기를 사람이 읽기 좋은 표시로 변환.
 * NodeView 와 renderHTML 서버 직렬화 양쪽에서 동일 결과를 보장한다.
 */
export function formatFileSize(size: number | string | null | undefined): string {
  if (size == null) return '';
  const n = typeof size === 'string' ? parseInt(size, 10) : size;
  if (!Number.isFinite(n) || n <= 0) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

// MIME → 타입 라벨. 확장자가 없는 파일(브라우저 MIME 만으로 업로드 정책을 통과한 경우)
// 에서만 쓰인다 — lib/upload/attachment-policy.ts 의 ALLOWED_MIME 과 같은 집합이고,
// 한글 문서 MIME 변종은 브라우저·OS 마다 갈려 여러 값이 같은 라벨로 모인다.
const MIME_TYPE_LABEL: Record<string, string> = {
  'application/pdf': 'PDF',
  'application/zip': 'ZIP',
  'application/x-zip-compressed': 'ZIP',
  'application/msword': 'DOC',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'DOCX',
  'application/vnd.ms-excel': 'XLS',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'XLSX',
  'application/vnd.ms-powerpoint': 'PPT',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'PPTX',
  'application/vnd.hancom.hwp': 'HWP',
  'application/x-hwp': 'HWP',
  'application/haansofthwp': 'HWP',
  'application/hwp': 'HWP',
  'application/hwp+zip': 'HWP',
  'application/vnd.hancom.hwpx': 'HWPX',
  'application/haansofthwpx': 'HWPX',
  'text/plain': 'TXT',
  'text/csv': 'CSV',
};

// 표시용 확장자 판정 — 업로드 허용 판정(attachment-policy 의 getFileExt)과 목적이 다르다.
// 저쪽은 "받아도 되는 형식인가"를, 이쪽은 "사람에게 보여줄 만한 꼬리인가"를 본다.
// 영숫자 1~8자만 확장자로 치므로 「보고서.최종본」 같은 한글 꼬리는 걸러진다.
const DISPLAY_EXT_RE = /\.([A-Za-z0-9]{1,8})$/;

/**
 * 첨부 상자 메타 줄에 쓰는 파일 타입 라벨 (PDF·HWP·XLSX …).
 * 확장자를 우선하고 없을 때만 MIME 으로 판정한다 — 한글 문서는 브라우저가 MIME 을
 * 비워 보내는 일이 잦아 확장자가 더 믿을 만하다 (attachment-policy 와 같은 이유).
 */
export function resolveFileTypeLabel(
  filename: string | null | undefined,
  mime: string | null | undefined,
): string {
  const ext = filename?.match(DISPLAY_EXT_RE)?.[1];
  if (ext) return ext.toUpperCase();

  if (!mime) return '';
  const known = MIME_TYPE_LABEL[mime];
  if (known) return known;
  // image/* 는 화이트리스트가 prefix 로 열려 있어 표에 없는 형식(heic·avif)도 들어온다.
  // `image/svg+xml` 처럼 뒤에 붙는 suffix 는 떼고 서브타입만 올린다.
  if (mime.startsWith('image/')) {
    const subtype = mime.slice('image/'.length).split('+')[0] ?? '';
    return subtype.toUpperCase();
  }
  return '';
}

/**
 * `<a class="notice-file-attachment">` 안의 sub-text 메타 라인 빌더.
 * 타입 · 크기 형식으로 결합하며, 둘 다 빈 값이면 빈 문자열을 반환.
 *
 * 원본 파일명은 일부러 넣지 않는다 — 윗줄 라벨이 사람이 읽을 이름이고, 파일명은
 * 대개 길고 공문 번호가 섞여 상자를 넘친다. 내려받을 때의 이름은 `download` 속성과
 * `data-filename` 이 그대로 들고 있으므로 표시에서만 빠진다.
 */
export function buildAttachmentMetaText(
  filename: string | null | undefined,
  size: number | string | null | undefined,
  mime: string | null | undefined,
): string {
  const typeText = resolveFileTypeLabel(filename, mime);
  const sizeText = formatFileSize(size);
  return [typeText, sizeText].filter(Boolean).join(' · ');
}
