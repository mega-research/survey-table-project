/**
 * 응답 내역 응답값 열 — 보기 문항(단일·복수·드롭다운·표의 선택 칸)의 저장값 ↔ 보기 글자.
 * 표시(profile-answer-values)와 검색·깔때기(profiles-filters)가 같은 보기 목록으로 판단한다.
 * 보기 목록은 지금 빌더 구조에서 만든다(read-models/profile-column-scheme).
 */

/** 보기 하나 — 저장값(value)·글자(label)·상세 기재 사이드카 키(id, `__optTexts__[문항][id]`) */
export interface AnswerChoice {
  id: string;
  value: string;
  label: string;
}

/** 응답값 열 키(`answer.<문항>[.<칸>]`) → 그 열의 보기 목록. 보기 문항이 아닌 열은 없다. */
export type AnswerChoiceMap = ReadonlyMap<string, readonly AnswerChoice[]>;

/**
 * 저장된 응답에서 고른 값들을 편다 — 단일(문자열) · 복수(배열) · 보기 그룹 맵(`{ default: 칸 id }`) 모두.
 * 빈 글자는 뺀다. SQL 쪽(`jsonb_path_query(…, 'lax $.**')` 의 문자열 값)과 같은 규칙이다.
 */
export function collectAnswerStrings(value: unknown): string[] {
  if (typeof value === 'string') return value.trim() === '' ? [] : [value];
  if (typeof value === 'number') return [String(value)];
  if (Array.isArray(value)) return value.flatMap(collectAnswerStrings);
  if (value !== null && typeof value === 'object') {
    return Object.values(value as Record<string, unknown>).flatMap(collectAnswerStrings);
  }
  return [];
}

/**
 * 응답값을 보기 글자로 — 여럿이면 「, 」로 잇고, 상세 기재가 있으면 「⑧ 기타(적은 글)」.
 * 지금 구조에 없는 저장값(옛 버전의 보기 등)은 값 그대로 보인다.
 */
export function formatChoiceAnswer(
  value: unknown,
  choices: readonly AnswerChoice[],
  otherTexts?: Readonly<Record<string, string>>,
): string {
  const byValue = new Map(choices.map((c) => [c.value, c]));
  return collectAnswerStrings(value)
    .map((v) => {
      const choice = byValue.get(v);
      if (!choice) return v;
      const text = otherTexts?.[choice.id]?.trim();
      return text ? `${choice.label}(${text})` : choice.label;
    })
    .join(', ');
}

/** 검색어가 글자에 든 보기들의 저장값 — 대소문자·앞뒤 공백 무시. 저장값(번호)으로는 맞추지 않는다. */
export function matchChoiceValues(choices: readonly AnswerChoice[], text: string): string[] {
  const needle = text.trim().toLowerCase();
  if (needle === '') return [];
  return choices.filter((c) => c.label.toLowerCase().includes(needle)).map((c) => c.value);
}
