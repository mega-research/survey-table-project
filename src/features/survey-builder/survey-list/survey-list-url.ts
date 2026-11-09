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
  SURVEY_LIST_SEARCH_MAX_LENGTH,
  SURVEY_LIST_SEARCH_MAX_WORDS,
  SURVEY_LIST_TAG_FILTER_MAX,
  type SurveyListAdvancedFilters,
  type SurveyListPageQuery,
  isSurveyListDate,
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
  favorites: 'fav',
  /** 검색 칩 — 태그마다 한 번씩(`tag=a&tag=b`), 칩 순서대로. */
  tagIds: 'tag',
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
  /** 보는 자리 — `mine=1` 내 설문 · `mine=0` 팀 전체, 없으면 서버가 저장된 선택·역할 기본값으로 정한다. */
  whose: 'mine',
} as const;

const P = SURVEY_LIST_URL_PARAMS;

interface SearchParamsLike {
  get(name: string): string | null;
  getAll(name: string): string[];
}

function oneOf<T extends string>(values: readonly T[], raw: string | null): T | null {
  return raw !== null && (values as readonly string[]).includes(raw) ? (raw as T) : null;
}

function uuidOrNull(raw: string | null): string | null {
  return raw !== null && LOOSE_UUID_PATTERN.test(raw) ? raw : null;
}

/** 달력에 없는 날짜(`2026-02-30`)도 그 조건만 버린다 — 서버가 거부할 주소로 조회하지 않게. */
function dateOrNull(raw: string | null): string | null {
  return raw !== null && isSurveyListDate(raw) ? raw : null;
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

/** 주소의 검색 칩 — 꼴이 맞는 id 만, 중복 없이, 앞에서부터 상한까지(서버가 거부할 주소로 조회하지 않게). */
function tagIdsWithinLimits(raw: string[]): string[] {
  const ids = [...new Set(raw.filter((id) => LOOSE_UUID_PATTERN.test(id)))];
  return ids.slice(0, SURVEY_LIST_TAG_FILTER_MAX);
}

/** 주소 → 조건. */
export function parseSurveyListQuery(params: SearchParamsLike): SurveyListPageQuery {
  const teamId = uuidOrNull(params.get(P.teamId));
  const deleted = params.get(P.deleted) === '1';
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
    // 휴지통과 함께 와도 여기서는 접지 않는다 — 휴지통이 실제로 열리는지는 범위·권한을 아는 쪽이
    // 정한다(`applyTrashAccess`). 지워진 태그(다른 탭) 칩도 여기서 알 수 없다 — 화면이 내 태그 목록과
    // 대조해 푼다.
    favorites: params.get(P.favorites) === '1',
    tagIds: tagIdsWithinLimits(params.getAll(P.tagIds)),
    sort: oneOf(surveyListSortValues, params.get(P.sort)) ?? INITIAL_SURVEY_LIST_PAGE_QUERY.sort,
    page: page !== null && page >= 1 ? page : 1,
    deleted,
    whose: whoseOrNull(params.get(P.whose)),
  };
}

function whoseOrNull(raw: string | null): SurveyListPageQuery['whose'] {
  if (raw === '1') return 'mine';
  if (raw === '0') return 'team';
  return null;
}

/**
 * 휴지통 적용 — 휴지통은 슈퍼어드민의 시스템 전체 보기에만 있고(`canSeeDeleted`), 휴지통에는 즐겨찾기·
 * 태그 조건이 없다(서버가 그 조합을 거부한다).
 *
 * - 볼 수 있으면 휴지통을 열고 즐겨찾기·태그를 접는다.
 * - 볼 수 없으면 휴지통만 끄고 즐겨찾기·태그는 그대로 건다 — 주소를 읽을 때 먼저 접으면 휴지통이
 *   적용되지 않는 사람의 별·태그 조건이 조용히 사라진다.
 *
 * 바꿀 것이 없으면 같은 객체를 돌려준다(조회 키가 흔들리지 않게).
 */
export function applyTrashAccess(
  query: SurveyListPageQuery,
  canSeeDeleted: boolean,
): SurveyListPageQuery {
  if (!query.deleted) return query;
  if (!canSeeDeleted) return { ...query, deleted: false };
  if (!query.favorites && query.tagIds.length === 0) return query;
  return { ...query, favorites: false, tagIds: [] };
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
  if (query.favorites) out.set(P.favorites, '1');
  for (const tagId of query.tagIds) out.append(P.tagIds, tagId);
  if (query.sort !== d.sort) out.set(P.sort, query.sort);
  if (a.dateField !== INITIAL_ADVANCED_FILTERS.dateField) out.set(P.dateField, a.dateField);
  if (a.dateFrom) out.set(P.dateFrom, a.dateFrom);
  if (a.dateTo) out.set(P.dateTo, a.dateTo);
  if (a.ownerUserId) out.set(P.ownerUserId, a.ownerUserId);
  if (a.visibility) out.set(P.visibility, a.visibility);
  if (a.responsesMin !== null) out.set(P.responsesMin, String(a.responsesMin));
  if (a.responsesMax !== null) out.set(P.responsesMax, String(a.responsesMax));
  if (query.deleted) out.set(P.deleted, '1');
  if (query.whose !== null) out.set(P.whose, query.whose === 'mine' ? '1' : '0');
  if (query.page !== 1) out.set(P.page, String(query.page));
  return out.toString();
}

/** 조건 → 목록 주소(`/surveys?…`, 조건이 모두 기본값이면 `/surveys`). 화면이 주소를 올리는 유일한 조립. */
export function surveyListHref(query: SurveyListPageQuery): string {
  const search = serializeSurveyListQuery(query);
  return search ? `/surveys?${search}` : '/surveys';
}

function sameTagIds(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((id, i) => id === b[i]);
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
    if (key === 'tagIds') return !sameTagIds(query.tagIds, next.tagIds);
    return query[key] !== next[key];
  });
  if (conditionChanged) return { ...next, page: 1 };
  if (next.page === query.page) return query;
  return next;
}

/**
 * 검색 칩 더하기 (티켓 09) — 끝에 붙인다. 이미 걸렸거나 상한(10개)이면 그대로. 「# 태그」 목록의
 * 체크·카드 태그 누르기·자동완성의 태그 고르기(티켓 10)가 이 함수로 칩을 더한다.
 */
export function addTagFilter(query: SurveyListPageQuery, tagId: string): SurveyListPageQuery {
  if (query.tagIds.includes(tagId) || query.tagIds.length >= SURVEY_LIST_TAG_FILTER_MAX) {
    return query;
  }
  return changeSurveyListQuery(query, { tagIds: [...query.tagIds, tagId] });
}

/**
 * 자동완성 「내 태그」 후보 고르기(티켓 10) — 칩을 더하고 검색어를 그 태그에 맞던 단어를 뺀 나머지로
 * 바꾼다(남은 글자는 `dropWordsMatching` 이 정한다). 한 번의 이동이라 뒤로 가기 한 번에 둘 다 돌아간다.
 */
export function pickTagSuggestion(
  query: SurveyListPageQuery,
  tagId: string,
  remainingQuery: string,
): SurveyListPageQuery {
  return changeSurveyListQuery(addTagFilter(query, tagId), { q: remainingQuery });
}

/** 검색 칩 빼기 — 칩의 × 와 「# 태그」 목록의 체크 풀기. 걸려 있지 않으면 그대로. */
export function removeTagFilter(query: SurveyListPageQuery, tagId: string): SurveyListPageQuery {
  if (!query.tagIds.includes(tagId)) return query;
  return changeSurveyListQuery(query, { tagIds: query.tagIds.filter((id) => id !== tagId) });
}

/**
 * 검색창 「모두 지우기」 — 검색창 안의 칩과 글자만 지운다. 즐겨찾기·목록 상태·상세 검색은 각자
 * 자리에서 푼다(PRD 「모두 지우기는 검색창 안 칩·글자만」).
 */
export function clearSearchBox(query: SurveyListPageQuery): SurveyListPageQuery {
  return changeSurveyListQuery(query, { q: '', tagIds: [] });
}

/**
 * 걸러 내는 조건(검색·검색 칩·목록 상태·상세 검색·즐겨찾기)이 걸려 있는가. 결과 0개 화면이 「조건 풀기」 단추를
 * 낼지 정한다 — 그룹·팀 좁힘은 주소가 가리키는 화면이라 그 단추로 풀지 않는다.
 */
export function hasNarrowingFilters(query: SurveyListPageQuery): boolean {
  return (
    query.q.trim() !== '' ||
    query.tagIds.length > 0 ||
    query.lifecycle !== 'all' ||
    query.favorites ||
    !sameAdvanced(query.advanced, INITIAL_ADVANCED_FILTERS)
  );
}

/**
 * 「조건 풀기」(결과 0개 화면) — 검색·검색 칩·목록 상태·상세 검색·즐겨찾기를 되돌린다(그룹·팀·휴지통·정렬은
 * 그대로). 검색창의 「모두 지우기」(칩과 글자만)와는 다른 단추다.
 */
export function clearNarrowingFilters(query: SurveyListPageQuery): SurveyListPageQuery {
  return changeSurveyListQuery(query, {
    q: '',
    tagIds: [],
    lifecycle: 'all',
    advanced: INITIAL_ADVANCED_FILTERS,
    favorites: false,
  });
}
