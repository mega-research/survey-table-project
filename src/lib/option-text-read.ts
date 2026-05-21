/**
 * 응답 데이터에서 옵션 텍스트 입력값을 읽는 공용 헬퍼.
 *
 * 저장 구조 (Task 16):
 *   questionResponses.__optTexts__[questionId][optionId]
 *
 * 마이그레이션 호환(레거시):
 *   questionResponses[questionId].optionTexts[optionId]
 */
export function getOptionText(
  qResponses: Record<string, unknown> | null | undefined,
  questionId: string,
  optionId: string,
): string | undefined {
  if (!qResponses) return undefined;
  const sidecar = (qResponses as { __optTexts__?: Record<string, Record<string, string>> }).__optTexts__;
  const fromSidecar = sidecar?.[questionId]?.[optionId];
  if (fromSidecar) return fromSidecar;
  const perQuestion = qResponses[questionId];
  if (typeof perQuestion === 'object' && perQuestion !== null && 'optionTexts' in perQuestion) {
    const legacyText = (perQuestion as { optionTexts?: Record<string, string> }).optionTexts?.[optionId];
    if (legacyText) return legacyText;
  }
  return undefined;
}
