type OptionTextsByQuestion = Record<string, Record<string, string>>;

function readOptionTextsRecord(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string',
    ),
  );
}

/**
 * 저장된 루트 __optTexts__와 현재 Zustand 편집값을 합친 검증용 뷰.
 * 현재 편집값은 빈 문자열도 명시적인 삭제 의사이므로 저장값보다 우선한다.
 *
 * 응답 페이지와 빌더 미리보기가 같은 병합 규칙을 봐야 해서 두 기능의 아래인
 * 렌더러가 소유한다.
 */
export function resolveEffectiveOptionTextsByQuestion(
  responses: Record<string, unknown>,
  currentOptionTexts: OptionTextsByQuestion,
): OptionTextsByQuestion {
  const persistedRoot =
    responses['__optTexts__'] &&
    typeof responses['__optTexts__'] === 'object' &&
    !Array.isArray(responses['__optTexts__'])
      ? (responses['__optTexts__'] as Record<string, unknown>)
      : {};
  const questionIds = new Set([...Object.keys(persistedRoot), ...Object.keys(currentOptionTexts)]);
  const effective: OptionTextsByQuestion = {};

  for (const questionId of questionIds) {
    const merged = {
      ...readOptionTextsRecord(persistedRoot[questionId]),
      ...readOptionTextsRecord(currentOptionTexts[questionId]),
    };
    if (Object.keys(merged).length > 0) effective[questionId] = merged;
  }

  return effective;
}
