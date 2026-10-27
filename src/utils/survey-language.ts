import type { Question, QuestionGroup, QuestionOption } from '@/types/survey';
import { DEFAULT_SURVEY_LOCALE, type SurveyLocale, isSurveyLocale } from '@/types/survey-locale';
import { buildRenderSteps } from '@/utils/group-ordering';

/**
 * 다국어 설문의 언어 판정 (CONTEXT.md 「언어 문항」·「언어 묶음」, ADR 0034).
 *
 * 응답 화면(현재 언어)·빌더(경고)·내보내기(공유 변수명 합치기)가 같은 판정을 써야 해서
 * 공용 구역에 둔다. 전부 순수 함수다.
 */

/**
 * 보기에 어휘 안 언어(`SURVEY_LOCALES`)가 붙은 radio 문항인가. 보기는 JSONB 라 `null`·없는 언어가
 * 들어올 수 있어 값까지 본다 — 어휘 밖 값은 언어 보기가 아니다.
 */
export function isLanguageQuestion(question: Question): boolean {
  return (
    question.type === 'radio' && (question.options ?? []).some((o) => isSurveyLocale(o.locale))
  );
}

/** 응답값·조건값이 가리키는 보기 — `checkValueMatch` 와 같이 value 와 id 를 다 본다. */
function findOption(question: Question, valueOrId: string): QuestionOption | undefined {
  return (question.options ?? []).find((o) => o.value === valueOrId || o.id === valueOrId);
}

/** 보기의 언어 — 어휘 밖 값은 없는 것으로 친다. */
function optionLocale(option: QuestionOption | undefined): SurveyLocale | null {
  return option && isSurveyLocale(option.locale) ? option.locale : null;
}

/**
 * 설문의 언어 문항 — 보기에 언어가 붙은 radio 문항. 설문당 하나가 규칙이고, 둘 이상이면
 * 응답 화면에 나오는 순서(`buildRenderSteps` — 그룹 순서가 먼저)로 맨 앞 것만 쓴다(빌더가 경고한다).
 * 없으면 다국어 설문이 아니다.
 */
export function findLanguageQuestion(
  questions: readonly Question[],
  groups: readonly QuestionGroup[],
): Question | null {
  if (!questions.some(isLanguageQuestion)) return null;
  for (const step of buildRenderSteps([...questions], [...groups])) {
    const found = step.items.find((item) => isLanguageQuestion(item.question));
    if (found) return found.question;
  }
  return null;
}

/** radio 응답에서 고른 값 — 문자열, 또는 기타 상세기재가 붙은 `{ selectedValue }` 래핑. */
function readSelectedValue(response: unknown): string | null {
  if (typeof response === 'string') return response === '' ? null : response;
  if (typeof response === 'object' && response !== null && 'selectedValue' in response) {
    const v = (response as { selectedValue: unknown }).selectedValue;
    return typeof v === 'string' && v !== '' ? v : null;
  }
  return null;
}

/**
 * 현재 언어 — 언어 문항의 지금 응답이 가리키는 보기의 locale. 저장하지 않고 답에서 파생한다.
 *
 * - 다국어 설문이 아니면 늘 `'ko'` (기존 설문의 화면 글자가 바뀌지 않는다)
 * - 다국어 설문인데 아직 고르지 않았거나 언어가 없는 보기를 골랐으면 `null`(미정)
 */
export function resolveCurrentLocale(
  questions: readonly Question[],
  groups: readonly QuestionGroup[],
  responses: Readonly<Record<string, unknown>>,
): SurveyLocale | null {
  const languageQuestion = findLanguageQuestion(questions, groups);
  if (!languageQuestion) return DEFAULT_SURVEY_LOCALE;
  const selected = readSelectedValue(responses[languageQuestion.id]);
  if (selected === null) return null;
  return optionLocale(findOption(languageQuestion, selected));
}

/**
 * 그룹 자체가 언어 묶음이면 그 언어 — 켜진 표시 조건이 「언어 문항 value-match」 하나뿐이고
 * (NOT 으로 뒤집히지 않고), 그 조건이 받는 보기가 모두 같은 언어일 때만. 조건이 섞이거나 두 언어를
 * 함께 받으면 묶음이 아니다
 * (내보내기가 공유 변수명을 합치지 않는 쪽으로 떨어진다 — 그러면 기존 중복 검사가 막는다).
 */
function ownLanguageSetLocale(
  group: QuestionGroup,
  languageQuestion: Question,
): SurveyLocale | null {
  if (group.displayCondition?.logicType === 'NOT') return null;
  const conditions = (group.displayCondition?.conditions ?? []).filter((c) => c.enabled !== false);
  const [condition] = conditions;
  if (conditions.length !== 1 || !condition) return null;
  if (condition.conditionType !== 'value-match') return null;
  if (condition.sourceQuestionId !== languageQuestion.id) return null;
  const values = condition.requiredValues ?? [];
  if (values.length === 0) return null;
  const locales = new Set(values.map((v) => optionLocale(findOption(languageQuestion, v))));
  if (locales.size !== 1) return null;
  const [locale] = locales;
  return locale ?? null;
}

/**
 * 언어 묶음 판정 — 문항 id → 그 문항이 속한 언어 묶음의 언어. 묶음 밖 문항은 결과에 없다.
 * 하위 그룹은 가장 가까운 언어 묶음 조상의 언어를 물려받는다. 부모 사슬이 손상돼 순환해도
 * 이미 본 그룹에서 끊는다(`shouldDisplayGroup` 과 같은 가드).
 */
export function resolveLanguageSetLocales(
  questions: readonly Question[],
  groups: readonly QuestionGroup[],
): Map<string, SurveyLocale> {
  const result = new Map<string, SurveyLocale>();
  const languageQuestion = findLanguageQuestion(questions, groups);
  if (!languageQuestion) return result;

  const groupById = new Map(groups.map((g) => [g.id, g]));
  const localeByGroup = new Map<string, SurveyLocale | null>();
  const groupLocale = (groupId: string): SurveyLocale | null => {
    if (localeByGroup.has(groupId)) return localeByGroup.get(groupId) ?? null;
    const seen = new Set<string>();
    let current = groupById.get(groupId);
    let locale: SurveyLocale | null = null;
    while (current && !seen.has(current.id)) {
      seen.add(current.id);
      locale = ownLanguageSetLocale(current, languageQuestion);
      if (locale) break;
      current = current.parentGroupId ? groupById.get(current.parentGroupId) : undefined;
    }
    localeByGroup.set(groupId, locale);
    return locale;
  };

  for (const q of questions) {
    if (!q.groupId) continue;
    const locale = groupLocale(q.groupId);
    if (locale) result.set(q.id, locale);
  }
  return result;
}
