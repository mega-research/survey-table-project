import 'server-only';

/**
 * PDF 바이트에서 쪽 수를 읽는다. 렌더는 하지 않으므로 canvas 가 필요 없다.
 *
 * 쪽 수를 클라이언트가 보내온 값으로 믿지 않는 이유는 하나다 — 앵커의 page 가
 * 1..pageCount 범위를 가정하고, 그 범위가 틀리면 응답 화면에서 조용히 잘못
 * 그려진다(ADR 0020). 값의 출처가 파일 자체여야 한다.
 *
 * legacy 빌드를 쓰는 이유: Node 런타임에는 DOM 이 없다. 워커도 띄우지 않는다
 * (`getDocument` 는 워커 없이도 numPages 를 푼다).
 */
export async function readPdfPageCount(bytes: Uint8Array): Promise<number | null> {
  try {
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const task = pdfjs.getDocument({
      data: bytes,
      useWorkerFetch: false,
      disableFontFace: true,
      useSystemFonts: false,
    });
    try {
      const doc = await task.promise;
      const count = doc.numPages;
      return Number.isInteger(count) && count > 0 ? count : null;
    } finally {
      await task.destroy();
    }
  } catch {
    // 암호화·손상 PDF — 호출자가 400 으로 돌려준다
    return null;
  }
}
