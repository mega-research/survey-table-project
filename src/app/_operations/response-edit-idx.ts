/**
 * 응답 수정 주소의 `?idx=` — 응답 내역의 순번(배너 표시용). 양의 정수가 아니면 null.
 *
 * 두 라우트(내부·외주 링크)가 같은 해석을 하도록 한 곳에 둔다.
 */
export function parseResponseIdx(raw: string | undefined): number | null {
  const idxNum = raw ? parseInt(raw, 10) : NaN;
  return Number.isFinite(idxNum) && idxNum > 0 ? idxNum : null;
}
