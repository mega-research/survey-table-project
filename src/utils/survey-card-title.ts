/**
 * 설문 목록의 카드 제목 (CONTEXT.md 「카드 제목」).
 *
 * 카드 제목은 설문 관리·설문 분석 목록의 카드에만 쓰는 담당자용 이름이고, 설문 제목(응답자가 보는 제목)과
 * 따로 저장한다(`surveys.list_title`). 비어 있으면 설문 제목을 그대로 보인다 — 설문 제목을 바꾸면 카드도 따라 바뀐다.
 *
 * ── 배선과 규칙 ──
 * - (2026-11-11, 0167): `surveys.list_title`(NULL = 설문 제목을 따라감).
 * - 규칙은 `utils/survey-card-title`(`surveyCardTitle` · `normalizeSurveyListTitle` — 빈 값 · 설문 제목과 같은
 *   값은 NULL 로 지운다 · `matchesSurveyListSearch` · `compareSurveyCardTitle`), 쓰기는
 *   `surveyBuilder.surveys.setListTitle`(`setSurveyListTitle`) 하나다.
 * - **빌더의 설문 저장은 이 열을 쓰지 않는다**(저장이 필드를 명시해 쓰므로 지워지지 않는다).
 * - 묶음 안의 카드는 카드 제목순(숫자를 수로 읽는다)이다.
 * - 바꾸는 자리는 설문 관리 목록 카드 메뉴의 「카드 제목 바꾸기」.
 * - 잘린 제목은 마우스를 올리면 전체가 뜬다(`components/ui/truncated-text`).
 */

/** 카드 제목 길이 상한(글자 수) */
export const SURVEY_LIST_TITLE_MAX_LENGTH = 200;

interface TitledSurvey {
  title: string;
  listTitle?: string | null;
}

/** 카드에 보일 제목 — 카드 제목이 있으면 그것, 없으면 설문 제목. */
export function surveyCardTitle(survey: TitledSurvey): string {
  const own = survey.listTitle?.trim();
  return own ? own : survey.title;
}

/** 카드 제목을 따로 지었는가 — 지었으면 카드에 설문 제목을 한 줄 더 보인다. */
export function hasOwnCardTitle(survey: TitledSurvey): boolean {
  const own = survey.listTitle?.trim();
  return Boolean(own) && own !== survey.title.trim();
}

/**
 * 저장할 카드 제목. 비었거나 설문 제목과 같으면 null — 「따로 짓지 않음」으로 두어 설문 제목을 따라가게 한다.
 * 줄바꿈·연속 공백은 한 칸으로 접는다(카드는 한 줄이다).
 */
export function normalizeSurveyListTitle(
  input: string | null | undefined,
  surveyTitle: string,
): string | null {
  const collapsed = (input ?? '').replace(/\s+/g, ' ').trim();
  if (collapsed === '' || collapsed === surveyTitle.replace(/\s+/g, ' ').trim()) return null;
  return collapsed;
}

/** 목록 검색 — 카드 제목과 설문 제목 어느 쪽에 걸려도 찾는다. */
export function matchesSurveyListSearch(survey: TitledSurvey, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (needle === '') return true;
  return (
    surveyCardTitle(survey).toLowerCase().includes(needle) ||
    survey.title.toLowerCase().includes(needle)
  );
}

/** 묶음 안 카드의 순서 — 카드 제목순(「2.」가 「10.」 앞에 오게 숫자를 수로 읽는다). */
export function compareSurveyCardTitle(a: TitledSurvey, b: TitledSurvey): number {
  return surveyCardTitle(a).localeCompare(surveyCardTitle(b), 'ko', { numeric: true });
}
