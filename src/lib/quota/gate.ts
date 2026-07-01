/**
 * 게이트 문항이 전부 답변됐는지. 빈 게이트는 false(발동 안 함).
 * 빈 문자열/빈 배열은 미답변으로 본다.
 */
export function allQuotaQuestionsAnswered(
  questionIds: string[],
  answers: Record<string, unknown>,
): boolean {
  if (questionIds.length === 0) return false;
  return questionIds.every((id) => {
    const v = answers[id];
    if (v == null) return false;
    if (typeof v === 'string') return v.trim().length > 0;
    if (Array.isArray(v)) return v.length > 0;
    return true;
  });
}
