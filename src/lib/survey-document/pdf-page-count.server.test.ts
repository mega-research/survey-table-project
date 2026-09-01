import { afterEach, describe, expect, it, vi } from 'vitest';

import { readPdfPageCount } from './pdf-page-count.server';

vi.mock('@sentry/nextjs', () => ({ captureMessage: vi.fn() }));

/** 손으로 쓴 최소 PDF (2쪽). xref 오프셋이 어긋나도 pdf.js 가 복구 스캔으로 연다. */
function minimalPdf(pages: number): Uint8Array {
  const kids = Array.from({ length: pages }, (_, i) => `${3 + i} 0 R`).join(' ');
  const pageObjs = Array.from(
    { length: pages },
    (_, i) => `${3 + i} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] >>\nendobj\n`,
  ).join('');
  const body =
    `%PDF-1.4\n` +
    `1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n` +
    `2 0 obj\n<< /Type /Pages /Kids [ ${kids} ] /Count ${pages} >>\nendobj\n` +
    pageObjs +
    `trailer\n<< /Root 1 0 R >>\n%%EOF\n`;
  return new TextEncoder().encode(body);
}

describe('readPdfPageCount — 서버 쪽 수 판독', () => {
  afterEach(() => {
    delete (globalThis as { pdfjsWorker?: unknown }).pdfjsWorker;
  });

  it('워커 파일을 상대경로 동적 import 로 찾을 수 없어도 쪽 수를 읽는다 — 서버 함수 번들 재현', async () => {
    // Vercel 함수 번들은 pdf.mjs 안의 `import(this.workerSrc)`(런타임 문자열, webpackIgnore)
    // 를 추적하지 못해 pdf.worker.mjs 가 빠진다. 그 상황을 workerSrc 를 없는 경로로 바꿔
    // 재현한다 — fake worker 설정이 실패하면 멀쩡한 PDF 가 null(= "암호/손상" 400) 이 된다.
    // (2026-09-01 프로덕션 장애. 이 테스트는 파일 안의 첫 케이스여야 한다 — pdfjs 가 fake
    // worker 설정을 프로세스당 1회 메모하므로 앞선 성공이 결함을 가린다.)
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    pdfjs.GlobalWorkerOptions.workerSrc = '/definitely/missing/pdf.worker.mjs';

    expect(await readPdfPageCount(minimalPdf(2))).toBe(2);
  });

  it('정상 PDF 는 쪽 수를 돌려준다', async () => {
    expect(await readPdfPageCount(minimalPdf(3))).toBe(3);
  });

  it('PDF 가 아닌 바이트는 null', async () => {
    expect(await readPdfPageCount(new TextEncoder().encode('not a pdf at all'))).toBeNull();
  });
});
