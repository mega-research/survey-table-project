/**
 * 클라이언트 사이드 파일 다운로드 유틸
 *
 * Blob → 브라우저 다운로드 트리거, 안전한 파일명 생성.
 * export-data-modal, export-panel 등 여러 곳에서 공유.
 */

export function downloadBlob(blob: Blob, filename: string): void {
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  window.URL.revokeObjectURL(url);
  document.body.removeChild(a);
}

export function buildSafeFilename(title: string, suffix: string, ext: string): string {
  const safeName = title.replace(/[^a-zA-Z0-9가-힣\s]/g, '').slice(0, 50);
  const timestamp = new Date().toISOString().split('T')[0];
  return `${safeName}_${suffix}_${timestamp}.${ext}`;
}

/** 문자열 데이터를 지정 MIME 타입의 Blob으로 다운로드 */
export function downloadText(data: string, filename: string, mimeType: string): void {
  const blob = new Blob([data], { type: mimeType });
  downloadBlob(blob, filename);
}
