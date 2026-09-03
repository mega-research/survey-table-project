import * as Sentry from '@sentry/nextjs';
import 'server-only';

/**
 * PDF 바이트에서 쪽 수를 읽는다. 렌더는 하지 않으므로 canvas 가 필요 없다.
 *
 * 쪽 수를 클라이언트가 보내온 값으로 믿지 않는 이유는 하나다 — 앵커의 page 가
 * 1..pageCount 범위를 가정하고, 그 범위가 틀리면 응답 화면에서 조용히 잘못
 * 그려진다(ADR 0020). 값의 출처가 파일 자체여야 한다.
 *
 * legacy 빌드를 쓰는 이유: Node 런타임에는 DOM 이 없다. 워커 스레드도 띄우지 않는다 —
 * pdfjs 는 워커가 없으면 "fake worker" 로 같은 스레드에서 numPages 를 푼다.
 *
 * 워커 모듈은 우리가 리터럴 지정자로 직접 import 해 `globalThis.pdfjsWorker` 에 넣는다.
 * pdf.mjs 는 워커를 `import(this.workerSrc)`(런타임 문자열 + webpackIgnore) 로 부르는데,
 * 서버 함수 번들의 파일 추적기가 이를 따라가지 못해 pdf.worker.mjs 가 빠졌고, fake worker
 * 설정이 실패하면서 멀쩡한 PDF 가 "암호/손상" 으로 거부됐다 (2026-09-01 프로덕션).
 * 전역에 핸들러가 있으면 pdfjs 는 동적 import 를 건너뛴다.
 */
async function ensureWorkerModule(): Promise<void> {
  const g = globalThis as { pdfjsWorker?: { WorkerMessageHandler?: unknown } };
  if (g.pdfjsWorker?.WorkerMessageHandler) return;
  g.pdfjsWorker = await import('pdfjs-dist/legacy/build/pdf.worker.mjs');
}

export async function readPdfPageCount(bytes: Uint8Array): Promise<number | null> {
  try {
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    await ensureWorkerModule();
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
  } catch (error) {
    // 암호화·손상 PDF 는 호출자가 400 으로 돌려준다. 다만 환경 결함(번들 누락 등)도 여기로
    // 떨어지므로 원인을 남긴다 — 파일 내용은 절대 싣지 않는다.
    const err = error instanceof Error ? error : new Error(String(error));
    Sentry.captureMessage('survey-document: PDF 쪽 수 판독 실패', {
      level: 'warning',
      extra: { name: err.name, message: err.message },
    });
    return null;
  }
}
