/**
 * 응답한 질문 ID 집합과 snapshot position map 으로부터 진행률 % 계산.
 *
 * 정책 (drop-funnel.ts 와 동일):
 *   - max position / totalQuestions x 100 (반올림)
 *   - positionMap 에 없는 questionId (legacy / 다른 version) 는 무시
 *   - 응답 0개 또는 모두 legacy -> null
 *   - totalQuestions = 0 -> null
 *   - positionMap 값은 1-based 양수 가정 (0 이면 "매칭 없음" 으로 처리)
 *   - 결과는 0~100 범위로 clamp (fail-soft)
 */
export function calculateProgressPct(
  answeredQuestionIds: readonly string[],
  positionMap: ReadonlyMap<string, number>,
  totalQuestions: number,
): number | null {
  if (totalQuestions === 0) return null;
  let maxPos = 0;
  for (const qid of answeredQuestionIds) {
    const pos = positionMap.get(qid);
    if (pos != null && pos > maxPos) maxPos = pos;
  }
  if (maxPos === 0) return null;
  return Math.max(0, Math.min(100, Math.round((maxPos / totalQuestions) * 100)));
}
