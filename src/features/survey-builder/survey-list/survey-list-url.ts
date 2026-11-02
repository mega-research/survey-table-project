// 설문 목록 조건 ↔ 주소 쿼리 — 순수 변환 (설문 즐겨찾기·태그 티켓 03).
//
// 서버 페이지네이션에서는 조건이 곧 조회 키라, 새로고침·뒤로 가기·링크 공유에서 살아 있도록
// 주소가 조건의 정본이다(운영 콘솔 `UrlFilterBar` 와 같은 관례). 그룹 화면(`?group=`)·실사팀
// 팀 좁힘(`?team=…&ungrouped=1`)의 기존 주소 규칙도 이 변환 안에 함께 있다.
//
// 읽기는 관대하다 — 모르는 값·잘못된 꼴은 기본값으로 접어 손으로 고친 주소가 조회를 깨지 않게
// 한다. 쓰기는 기본값을 생략해 주소를 짧게 둔다. 서버 페이지(RSC)도 같은 함수로 첫 조회 키를
// 만든다 — 갈리면 미리 받은 목록이 쓰이지 않는다.
import {
  INITIAL_ADVANCED_FILTERS,
  INITIAL_SURVEY_LIST_PAGE_QUERY,
  LOOSE_UUID_PATTERN,
  SURVEY_LIST_DATE_PATTERN,
  SURVEY_LIST_SEARCH_MAX_LENGTH,
  SURVEY_LIST_SEARCH_MAX_WORDS,
  type SurveyListAdvancedFilters,
  type SurveyListPageQuery,
  splitSurveyListSearchWords,
  surveyListDateFieldValues,
  surveyListLifecycleFilterValues,
  surveyListSortValues,
  surveyListVisibilityFilterValues,
} from '@/shared/contracts/survey-builder-io';

/** 주소 쿼리 이름 — 기존 `group`·`team`·`ungrouped` 에 이어 붙인다. */
export const SURVEY_LIST_URL_PARAMS = {
  groupId: 'group',
  teamId: 'team',
  ungrouped: 'ungrouped',
  q: 'q',
  lifecycle: 'status',
  sort: 'sort',
  dateField: 'date',
  dateFrom: 'from',
  dateTo: 'to',
  ownerUserId: 'owner',
  visibility: 'vis',
  responsesMin: 'rmin',
  responsesMax: 'rmax',
  deleted: 'trash',
  page: 'page',
} as const;

const P = SURVEY_LIST_URL_PARAMS;

interface SearchParamsLike {
  get(name: string): string | null;
}

function oneOf<T extends string>(values: readonly T[], raw: string | null): T | null {
  return raw !== null && (values as readonly string[]).includes(raw) ? (raw as T) : null;
}

function uuidOrNull(raw: string | null): string | null {
  return raw !== null && LOOSE_UUID_PATTERN.test(raw) ? raw : null;
}

function dateOrNull(raw: string | null): string | null {
  return raw !== null && SURVEY_LIST_DATE_PATTERN.test(raw) ? raw : null;
}

function nonNegativeIntOrNull(raw: string | null): number | null {
  return raw !== null && /^\d{1,9}$/.test(raw) ? Number(raw) : null;
}

/**
 * 주소의 검색어를 상한 안으로 — 글자 수에서 자르고, 단어가 넘치면 앞 단어들만 한 칸씩 띄워 남긴다.
 * 상한 안이면 친 그대로 둔다(검색창이 같은 글자를 보여 준다).
 */
function searchWithinLimits(raw: string | null): string {
  const q = (raw ?? '').slice(0, SURVEY_LIST_SEARCH_MAX_LENGTH);
  const words = splitSurveyListSearchWords(q);
  return words.length > SURVEY_LIST_SEARCH_MAX_WORDS
    ? words.slice(0, SURVEY_LIST_SEARCH_MAX_WORDS).join(' ')
    : q;
}

/** 주소 → 조건. */
export function parseSurveyListQuery(params: SearchParamsLike): SurveyListPageQuery {
  const teamId = uuidOrNull(params.get(P.teamId));
  const page = nonNegativeIntOrNull(params.get(P.page));
  const advanced: SurveyListAdvancedFilters = {
    dateField:
      oneOf(surveyListDateFieldValues, params.get(P.dateField)) ??
      INITIAL_ADVANCED_FILTERS.dateField,
    dateFrom: dateOrNull(params.get(P.dateFrom)),
    dateTo: dateOrNull(params.get(P.dateTo)),
    ownerUserId: uuidOrNull(params.get(P.ownerUserId)),
    visibility: oneOf(surveyListVisibilityFilterValues, params.get(P.visibility)),
    responsesMin: nonNegativeIntOrNull(params.get(P.responsesMin)),
    responsesMax: nonNegativeIntOrNull(params.get(P.responsesMax)),
  };
  return {
    groupId: uuidOrNull(params.get(P.groupId)),
    teamId,
    // 미분류는 그 팀의 그룹 밖 설문이라 팀 좁힘과 함께일 때만 뜻이 있다.
    ungrouped: teamId !== null && params.get(P.ungrouped) === '1',
    q: searchWithinLimits(params.get(P.q)),
    lifecycle:
      oneOf(surveyListLifecycleFilterValues, params.get(P.lifecycle)) ??
      INITIAL_SURVEY_LIST_PAGE_QUERY.lifecycle,
    advanced,
    sort: oneOf(surveyListSortValues, params.get(P.sort)) ?? INITIAL_SURVEY_LIST_PAGE_QUERY.sort,
    page: page !== null && page >= 1 ? page : 1,
    deleted: params.get(P.deleted) === '1',
  };
}

/** 조건 → 주소 쿼리 문자열(앞의 `?` 없이). 기본값은 생략하고 순서는 고정이다. */
export function serializeSurveyListQuery(query: SurveyListPageQuery): string {
  const out = new URLSearchParams();
  const d = INITIAL_SURVEY_LIST_PAGE_QUERY;
  const a = query.advanced;
  if (query.groupId) out.set(P.groupId, query.groupId);
  if (query.teamId) {
    out.set(P.teamId, query.teamId);
    if (query.ungrouped) out.set(P.ungrouped, '1');
  }
  if (query.q !== '') out.set(P.q, query.q);
  if (query.lifecycle !== d.lifecycle) out.set(P.lifecycle, query.lifecycle);
  if (query.sort !== d.sort) out.set(P.sort, query.sort);
  if (a.dateField !== INITIAL_ADVANCED_FILTERS.dateField) out.set(P.dateField, a.dateField);
  if (a.dateFrom) out.set(P.dateFrom, a.dateFrom);
  if (a.dateTo) out.set(P.dateTo, a.dateTo);
  if (a.ownerUserId) out.set(P.ownerUserId, a.ownerUserId);
  if (a.visibility) out.set(P.visibility, a.visibility);
  if (a.responsesMin !== null) out.set(P.responsesMin, String(a.responsesMin));
  if (a.responsesMax !== null) out.set(P.responsesMax, String(a.responsesMax));
  if (query.deleted) out.set(P.deleted, '1');
  if (query.page !== 1) out.set(P.page, String(query.page));
  return out.toString();
}

function sameAdvanced(a: SurveyListAdvancedFilters, b: SurveyListAdvancedFilters): boolean {
  return (Object.keys(a) as (keyof SurveyListAdvancedFilters)[]).every((k) => a[k] === b[k]);
}

/**
 * 조건 바꾸기 — 페이지가 아닌 무엇이든 바뀌면 1페이지로 돌아간다(빈 페이지에 떨어지지 않게).
 * 아무것도 바뀌지 않으면 같은 객체를 돌려준다.
 */
export function changeSurveyListQuery(
  query: SurveyListPageQuery,
  patch: Partial<SurveyListPageQuery>,
): SurveyListPageQuery {
  const next = { ...query, ...patch };
  const conditionChanged = (Object.keys(patch) as (keyof SurveyListPageQuery)[]).some((key) => {
    if (key === 'page') return false;
    if (key === 'advanced') return !sameAdvanced(query.advanced, next.advanced);
    return query[key] !== next[key];
  });
  if (conditionChanged) return { ...next, page: 1 };
  if (next.page === query.page) return query;
  return next;
}

/**
 * 걸러 내는 조건(검색·목록 상태·상세 검색)이 걸려 있는가. 결과 0개 화면이 「조건 풀기」 단추를
 * 낼지 정한다 — 그룹·팀 좁힘은 주소가 가리키는 화면이라 그 단추로 풀지 않는다.
 */
export function hasNarrowingFilters(query: SurveyListPageQuery): boolean {
  return (
    query.q.trim() !== '' ||
    query.lifecycle !== 'all' ||
    !sameAdvanced(query.advanced, INITIAL_ADVANCED_FILTERS)
  );
}

/** 「조건 풀기」 — 검색·목록 상태·상세 검색만 되돌린다(그룹·팀·휴지통·정렬은 그대로). */
export function clearNarrowingFilters(query: SurveyListPageQuery): SurveyListPageQuery {
  return changeSurveyListQuery(query, {
    q: '',
    lifecycle: 'all',
    advanced: INITIAL_ADVANCED_FILTERS,
  });
}
