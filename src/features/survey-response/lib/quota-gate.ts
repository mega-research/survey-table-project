import type { QuotaGate } from '@/shared/contracts/quota';

function hasValue(v: unknown): boolean {
  if (v == null) return false;
  if (typeof v === 'string') return v.trim().length > 0;
  if (Array.isArray(v)) return v.length > 0;
  return true;
}

/**
 * 게이트 문항이 전부 답변됐는지. 빈 게이트는 false(발동 안 함).
 * 빈 문자열/빈 배열은 미답변으로 본다. `cellIdsByQuestion` 에 오른 문항(텍스트형 차원의 표)은
 * 대상 칸 중 하나라도 값이 있어야 답변이다 — 표 응답은 다른 칸만 채워도 객체가 생긴다.
 */
export function allQuotaQuestionsAnswered(
  questionIds: string[],
  answers: Record<string, unknown>,
  cellIdsByQuestion: Record<string, string[]> = {},
): boolean {
  if (questionIds.length === 0) return false;
  return questionIds.every((id) => {
    const v = answers[id];
    const cellIds = cellIdsByQuestion[id];
    if (!cellIds?.length) return hasValue(v);
    if (v === null || typeof v !== 'object' || Array.isArray(v)) return false;
    const cells = v as Record<string, unknown>;
    return cellIds.some((cellId) => hasValue(cells[cellId]));
  });
}

/** 이번 「다음」에서 쿼터 확인을 발동할 것인가 — 문항 없는 플랜(속성형만)은 첫 전환에서 바로. */
export function shouldCheckQuota(
  gate: QuotaGate | null | undefined,
  answers: Record<string, unknown>,
): boolean {
  if (!gate) return false;
  if (gate.checkWithoutQuestions) return true;
  return allQuotaQuestionsAnswered(gate.questionIds, answers, gate.cellIdsByQuestion);
}
