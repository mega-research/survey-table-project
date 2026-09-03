/**
 * pdfjs-dist 는 legacy 워커 모듈(pdf.worker.mjs)의 타입 선언을 싣지 않는다.
 * 서버 쪽 수 판독(lib/survey-document/pdf-page-count.server.ts)이 이 모듈을 리터럴 지정자로
 * import 해 함수 번들에 실리게 하려고 최소 선언만 둔다. 실제 형상은 pdfjs 가 정한다.
 */
declare module 'pdfjs-dist/legacy/build/pdf.worker.mjs' {
  export const WorkerMessageHandler: unknown;
}
