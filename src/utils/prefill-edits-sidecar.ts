/**
 * 고친 프리필 사이드카 — 응답 루트 `__prefillEdits__` = `{ [문항 id]: 고친 칸 id[] }`.
 *
 * 「고친 경우만 따로 내보내기」(`TableCell.exportPrefillEdit`)를 켠 고칠 수 있는 프리필 칸에서, 응답자가 낸 값이
 * 응답 화면에 깔렸던 명단 값과 다르면 응답 확정(`answer-finalization`)이 그 칸 id 를 여기에 적는다. 내보내기는
 * 그 칸 변수 옆 `<변수>_upd` 열을 이 표식이 있을 때만 채운다(웹 버전의 「수정 전화번호」).
 *
 * **판정 시점이 저장 때인 이유** — 내보낼 때 명단과 비교하면, 담당자가 나중에 명단 값을 응답자가 알려 준 값으로
 * 고치는 순간 「응답자가 고쳤다」가 사라진다. 값은 싣지 않는다(칸 id 만) — 개인정보 칸이어도 사본이 생기지 않는다.
 *
 * import 0 인 잎 모듈이다 — 키 상수를 등록부(`lib/survey/response-sidecars`)가 읽으므로 이 모듈이 등록부를 되부르면
 * 순환이 닫혀 키가 초기화 전에 읽힌다(루트 AGENTS.md 주의사항 13).
 */
export const PREFILL_EDITS_KEY = '__prefillEdits__';

export type PrefillEdits = Record<string, string[]>;

/** 형태 정제 — `{ 문항 id: 칸 id 문자열 배열 }` 만 남긴다. 실존 문항 판정이 오면 그 문항만. 빈 배열은 뺀다. */
export function sanitizePrefillEdits(
  raw: unknown,
  isKnownQuestionId?: (questionId: string) => boolean,
): PrefillEdits {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: PrefillEdits = {};
  for (const [questionId, cells] of Object.entries(raw as Record<string, unknown>)) {
    if (isKnownQuestionId && !isKnownQuestionId(questionId)) continue;
    if (!Array.isArray(cells)) continue;
    const ids = [...new Set(cells.filter((id): id is string => typeof id === 'string' && id.length > 0))];
    if (ids.length > 0) out[questionId] = ids;
  }
  return out;
}

/** 이 응답에서 그 칸을 고쳤는가 — 응답 객체 루트의 사이드카를 읽는다 */
export function isPrefillEdited(
  responses: Record<string, unknown>,
  questionId: string,
  cellId: string,
): boolean {
  const edits = sanitizePrefillEdits(responses[PREFILL_EDITS_KEY]);
  return edits[questionId]?.includes(cellId) === true;
}
