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

/**
 * `<a class="notice-file-attachment">` 안의 sub-text 메타 라인 빌더.
 * filename · size 형식으로 결합하며, 둘 다 빈 값이면 빈 문자열을 반환.
 */
export function buildAttachmentMetaText(
  filename: string | null | undefined,
  size: number | string | null | undefined,
): string {
  const sizeText = formatFileSize(size);
  return [filename, sizeText].filter(Boolean).join(' · ');
}
