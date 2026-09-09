export const DYNAMIC_ROW_SELECTIONS_KEY = '__dynamicRowSelections__';

type DynamicRowSelections = Record<string, string[]>;

function asSelections(value: unknown): DynamicRowSelections {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const result: DynamicRowSelections = {};
  for (const [questionId, rowIds] of Object.entries(value)) {
    if (Array.isArray(rowIds)) {
      result[questionId] = rowIds.filter((rowId): rowId is string => typeof rowId === 'string');
    }
  }
  return result;
}

/**
 * 저장 경계용 정제 — 형태 검증 + (주어지면) 실존 문항만 남긴다.
 *
 * 이 키는 응답 루트에 실려 서버로 간다. 사이드카 등록부에 올리지 않으면 저장 경계가
 * 문항 id 로 오해해 초안 저장이 통째로 거부된다(`해당 설문에 존재하지 않는 질문입니다`).
 */
export function sanitizeDynamicRowSelections(
  raw: unknown,
  isKnownQuestionId?: (questionId: string) => boolean,
): DynamicRowSelections {
  const shaped = asSelections(raw);
  if (!isKnownQuestionId) return shaped;
  return Object.fromEntries(
    Object.entries(shaped).filter(([questionId]) => isKnownQuestionId(questionId)),
  );
}

export function getDynamicRowSelections(
  responses: Record<string, unknown>,
  questionId: string,
): string[] {
  return asSelections(responses[DYNAMIC_ROW_SELECTIONS_KEY])[questionId] ?? [];
}

export function updateDynamicRowSelections(
  currentSidecar: unknown,
  questionId: string,
  rowIds: readonly string[],
): DynamicRowSelections {
  const next = { ...asSelections(currentSidecar) };
  if (rowIds.length === 0) {
    delete next[questionId];
  } else {
    next[questionId] = [...new Set(rowIds)];
  }
  return next;
}
