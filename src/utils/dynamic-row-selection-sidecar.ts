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
