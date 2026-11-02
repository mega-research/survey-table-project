import { describe, expect, it } from 'vitest';

import {
  INITIAL_ADVANCED_FILTERS,
  INITIAL_SURVEY_LIST_PAGE_QUERY,
  type SurveyListPageQuery,
} from '@/shared/contracts/survey-builder-io';

import {
  addTagFilter,
  applyTrashAccess,
  changeSurveyListQuery,
  clearNarrowingFilters,
  clearSearchBox,
  hasNarrowingFilters,
  parseSurveyListQuery,
  pickTagSuggestion,
  removeTagFilter,
  serializeSurveyListQuery,
  surveyListHref,
} from './survey-list-url';

const GROUP = '11111111-2222-4333-8444-555555555555';
const TEAM = '22222222-3333-4444-8555-666666666666';
const OWNER = '33333333-4444-4555-8666-777777777777';
const TAG_A = '44444444-5555-4666-8777-888888888888';
const TAG_B = '55555555-6666-4777-8888-999999999999';

function parse(search: string): SurveyListPageQuery {
  return parseSurveyListQuery(new URLSearchParams(search));
}

const FULL: SurveyListPageQuery = {
  groupId: null,
  teamId: TEAM,
  ungrouped: true,
  q: '2026 실태',
  lifecycle: 'closed',
  advanced: {
    dateField: 'endDate',
    dateFrom: '2026-01-01',
    dateTo: '2026-12-31',
    ownerUserId: OWNER,
    visibility: 'invite_only',
    responsesMin: 0,
    responsesMax: 300,
  },
  favorites: true,
  tagIds: [TAG_A, TAG_B],
  sort: 'responses',
  page: 3,
  deleted: false,
};

describe('주소 ↔ 목록 조건', () => {
  it('빈 주소는 기본 조건이고, 기본 조건은 빈 주소다', () => {
    expect(parse('')).toEqual(INITIAL_SURVEY_LIST_PAGE_QUERY);
    expect(serializeSurveyListQuery(INITIAL_SURVEY_LIST_PAGE_QUERY)).toBe('');
  });

  it('모든 조건을 담은 주소가 왕복해도 같다', () => {
    const search = serializeSurveyListQuery(FULL);
    expect(parse(search)).toEqual(FULL);
    expect(serializeSurveyListQuery(parse(search))).toBe(search);
  });

  it('주소 이름은 사람이 읽을 수 있는 짧은 이름이다', () => {
    expect(serializeSurveyListQuery(FULL)).toBe(
      `team=${TEAM}&ungrouped=1&q=2026+%EC%8B%A4%ED%83%9C&status=closed&fav=1&tag=${TAG_A}&tag=${TAG_B}&sort=responses` +
        `&date=endDate&from=2026-01-01&to=2026-12-31&owner=${OWNER}&vis=invite_only&rmin=0&rmax=300&page=3`,
    );
  });

  it('그룹 화면·휴지통 주소도 왕복한다', () => {
    const groupView = { ...INITIAL_SURVEY_LIST_PAGE_QUERY, groupId: GROUP };
    expect(serializeSurveyListQuery(groupView)).toBe(`group=${GROUP}`);
    expect(parse(`group=${GROUP}`)).toEqual(groupView);

    const trash = { ...INITIAL_SURVEY_LIST_PAGE_QUERY, deleted: true, q: '지운' };
    expect(parse(serializeSurveyListQuery(trash))).toEqual(trash);
  });

  it('기존 사이드바 주소 규칙(?team=…&ungrouped=1, ?group=…)을 그대로 읽는다', () => {
    expect(parse(`team=${TEAM}&ungrouped=1`)).toMatchObject({ teamId: TEAM, ungrouped: true });
    expect(parse(`group=${GROUP}`)).toMatchObject({ groupId: GROUP });
  });

  it('주소 읽기는 휴지통과 즐겨찾기·태그를 함께 둔다 — 접는 것은 휴지통이 실제로 열릴 때다', () => {
    expect(parse('fav=1')).toEqual({ ...INITIAL_SURVEY_LIST_PAGE_QUERY, favorites: true });
    expect(parse(`trash=1&fav=1&tag=${TAG_A}`)).toEqual({
      ...INITIAL_SURVEY_LIST_PAGE_QUERY,
      deleted: true,
      favorites: true,
      tagIds: [TAG_A],
    });
  });

  it('검색 칩은 tag 를 여러 번 남기고 그 순서로 읽는다 — 잘못된 꼴·중복은 빼고 10개까지', () => {
    expect(parse(`tag=${TAG_B}&tag=${TAG_A}`).tagIds).toEqual([TAG_B, TAG_A]);
    expect(parse(`tag=${TAG_A}&tag=abc&tag=${TAG_A}`).tagIds).toEqual([TAG_A]);
    const twelve = Array.from(
      { length: 12 },
      (_, i) => `${String(i).padStart(8, '0')}-0000-4000-8000-000000000000`,
    );
    const parsed = parse(twelve.map((id) => `tag=${id}`).join('&')).tagIds;
    expect(parsed).toEqual(twelve.slice(0, 10));
  });

  describe('applyTrashAccess — 휴지통을 실제로 열 때만 즐겨찾기·태그를 접는다', () => {
    const trashWithMarks = parse(`trash=1&fav=1&tag=${TAG_A}&q=지운`);

    it('휴지통을 볼 수 있으면 휴지통을 열고 즐겨찾기·태그를 접는다 — 글자 검색은 남는다', () => {
      expect(applyTrashAccess(trashWithMarks, true)).toEqual({
        ...INITIAL_SURVEY_LIST_PAGE_QUERY,
        deleted: true,
        q: '지운',
      });
    });

    it('휴지통을 볼 수 없으면 휴지통만 끄고 즐겨찾기·태그는 그대로 건다', () => {
      expect(applyTrashAccess(trashWithMarks, false)).toEqual({
        ...INITIAL_SURVEY_LIST_PAGE_QUERY,
        favorites: true,
        tagIds: [TAG_A],
        q: '지운',
      });
    });

    it('바꿀 것이 없으면 같은 객체다 — 조회 키가 흔들리지 않게', () => {
      const plain = parse(`fav=1&tag=${TAG_A}`);
      expect(applyTrashAccess(plain, false)).toBe(plain);
      const trash = parse('trash=1');
      expect(applyTrashAccess(trash, true)).toBe(trash);
    });
  });

  it('목록 주소 — 기본값뿐이면 물음표 없이 /surveys', () => {
    expect(surveyListHref(INITIAL_SURVEY_LIST_PAGE_QUERY)).toBe('/surveys');
    expect(surveyListHref({ ...INITIAL_SURVEY_LIST_PAGE_QUERY, q: '실태', page: 2 })).toBe(
      '/surveys?q=%EC%8B%A4%ED%83%9C&page=2',
    );
  });

  it('미분류는 팀 좁힘과 함께일 때만 뜻이 있다', () => {
    expect(parse('ungrouped=1').ungrouped).toBe(false);
  });

  it('모르는 값·잘못된 꼴은 기본값으로 접는다 — 주소를 손으로 고쳐도 조회가 깨지지 않는다', () => {
    expect(
      parse(
        'group=abc&team=1&owner=x&status=paused&sort=views&page=-2&date=deletedAt&from=2026-1-1' +
          '&vis=public&rmin=-1&rmax=abc&trash=yes&fav=true',
      ),
    ).toEqual(INITIAL_SURVEY_LIST_PAGE_QUERY);
    expect(parse('page=2.5').page).toBe(1);
  });

  it('달력에 없는 날짜는 오류 화면 대신 그 기간 조건만 버린다 — 나머지 조건은 그대로', () => {
    const query = parse('q=a&from=2026-02-29&to=2026-04-31&rmin=3');
    expect(query.advanced.dateFrom).toBeNull();
    expect(query.advanced.dateTo).toBeNull();
    expect(query.q).toBe('a');
    expect(query.advanced.responsesMin).toBe(3);
    expect(parse('from=2026-99-99&to=2026-13-01').advanced).toEqual(INITIAL_ADVANCED_FILTERS);
    const leap = parse('from=2028-02-29&to=2028-03-01').advanced;
    expect([leap.dateFrom, leap.dateTo]).toEqual(['2028-02-29', '2028-03-01']);
  });

  it('검색어는 상한 글자 수에서 자른다', () => {
    expect(parse(`q=${'가'.repeat(150)}`).q).toHaveLength(100);
  });

  it('검색어는 앞 8단어까지만 남긴다 — 서버가 거부할 주소로 조회하지 않게', () => {
    const nine = encodeURIComponent('가 나 다 라 마 바 사 아 자');
    expect(parse(`q=${nine}`).q).toBe('가 나 다 라 마 바 사 아');
    // 8단어 이하면 사람이 친 그대로(공백 포함) 둔다 — 검색창이 같은 글자를 보여 준다.
    expect(parse(`q=${encodeURIComponent(' 2026  실태 ')}`).q).toBe(' 2026  실태 ');
  });
});

describe('조건 바꾸기', () => {
  const onPage3 = { ...INITIAL_SURVEY_LIST_PAGE_QUERY, page: 3 };

  it('조건이 바뀌면 1페이지로 돌아간다', () => {
    expect(changeSurveyListQuery(onPage3, { lifecycle: 'running' }).page).toBe(1);
    expect(changeSurveyListQuery(onPage3, { q: '실태' }).page).toBe(1);
    expect(changeSurveyListQuery(onPage3, { sort: 'title' }).page).toBe(1);
    expect(changeSurveyListQuery(onPage3, { favorites: true }).page).toBe(1);
    expect(
      changeSurveyListQuery(onPage3, {
        advanced: { ...INITIAL_ADVANCED_FILTERS, responsesMin: 5 },
      }).page,
    ).toBe(1);
  });

  it('검색 칩이 바뀌면 1페이지, 같은 칩 목록이면 그대로다', () => {
    expect(changeSurveyListQuery(onPage3, { tagIds: [TAG_A] }).page).toBe(1);
    const tagged = { ...onPage3, tagIds: [TAG_A] };
    expect(changeSurveyListQuery(tagged, { tagIds: [TAG_A] })).toBe(tagged);
  });

  it('페이지만 바꾸면 그 페이지로 간다', () => {
    expect(changeSurveyListQuery(onPage3, { page: 5 })).toEqual({ ...onPage3, page: 5 });
  });

  it('같은 값으로 바꾸면 페이지를 지키고 같은 객체를 돌려준다', () => {
    expect(changeSurveyListQuery(onPage3, { sort: 'updatedAt' })).toBe(onPage3);
  });
});

describe('검색 칩 더하기·빼기', () => {
  const onPage2 = { ...INITIAL_SURVEY_LIST_PAGE_QUERY, page: 2, tagIds: [TAG_A] };

  it('더하면 끝에 붙고 1페이지로 간다 — 이미 걸린 태그면 그대로', () => {
    expect(addTagFilter(onPage2, TAG_B)).toEqual({ ...onPage2, tagIds: [TAG_A, TAG_B], page: 1 });
    expect(addTagFilter(onPage2, TAG_A)).toBe(onPage2);
  });

  it('10개가 걸려 있으면 더하지 않는다', () => {
    const ten = Array.from(
      { length: 10 },
      (_, i) => `${String(i).padStart(8, '0')}-0000-4000-8000-000000000000`,
    );
    const full = { ...INITIAL_SURVEY_LIST_PAGE_QUERY, tagIds: ten };
    expect(addTagFilter(full, TAG_A)).toBe(full);
  });

  it('빼면 그 칩만 빠지고 1페이지로 간다 — 걸려 있지 않으면 그대로', () => {
    expect(removeTagFilter({ ...onPage2, tagIds: [TAG_A, TAG_B] }, TAG_A)).toEqual({
      ...onPage2,
      tagIds: [TAG_B],
      page: 1,
    });
    expect(removeTagFilter(onPage2, TAG_B)).toBe(onPage2);
  });
});

describe('검색창 「모두 지우기」', () => {
  it('칩과 글자만 지우고 즐겨찾기·목록 상태·상세 검색·정렬은 남긴다', () => {
    expect(clearSearchBox(FULL)).toEqual({ ...FULL, q: '', tagIds: [], page: 1 });
  });
});

describe('걸린 조건이 있는가 — 결과 0개 화면의 「조건 풀기」 단추', () => {
  it('검색·검색 칩·목록 상태·상세 검색·즐겨찾기 중 하나라도 걸리면 참', () => {
    expect(hasNarrowingFilters({ ...INITIAL_SURVEY_LIST_PAGE_QUERY, favorites: true })).toBe(true);
    expect(hasNarrowingFilters({ ...INITIAL_SURVEY_LIST_PAGE_QUERY, tagIds: [TAG_A] })).toBe(true);
    expect(hasNarrowingFilters(INITIAL_SURVEY_LIST_PAGE_QUERY)).toBe(false);
    expect(hasNarrowingFilters({ ...INITIAL_SURVEY_LIST_PAGE_QUERY, q: '실태' })).toBe(true);
    expect(hasNarrowingFilters({ ...INITIAL_SURVEY_LIST_PAGE_QUERY, lifecycle: 'draft' })).toBe(
      true,
    );
    expect(
      hasNarrowingFilters({
        ...INITIAL_SURVEY_LIST_PAGE_QUERY,
        advanced: { ...INITIAL_ADVANCED_FILTERS, visibility: 'team' },
      }),
    ).toBe(true);
  });

  it('정렬·페이지·그룹·팀은 거르는 조건이 아니다', () => {
    expect(
      hasNarrowingFilters({
        ...INITIAL_SURVEY_LIST_PAGE_QUERY,
        sort: 'title',
        page: 2,
        groupId: GROUP,
        teamId: TEAM,
      }),
    ).toBe(false);
  });
});

describe('조건 풀기', () => {
  it('검색·검색 칩·목록 상태·상세 검색·즐겨찾기만 되돌리고 그룹·팀·휴지통·정렬은 남긴다', () => {
    expect(clearNarrowingFilters(FULL)).toEqual({
      ...INITIAL_SURVEY_LIST_PAGE_QUERY,
      teamId: TEAM,
      ungrouped: true,
      sort: 'responses',
    });
  });
});

describe('pickTagSuggestion — 자동완성에서 태그를 고르면 칩과 남은 검색어가 함께 바뀐다', () => {
  it('칩이 끝에 붙고 검색어는 남은 단어로, 1페이지로 — 주소에도 둘이 같이 실린다', () => {
    const before = { ...INITIAL_SURVEY_LIST_PAGE_QUERY, q: 'a사 실', page: 3, tagIds: [TAG_A] };
    const next = pickTagSuggestion(before, TAG_B, '실');
    expect(next).toEqual({ ...before, q: '실', tagIds: [TAG_A, TAG_B], page: 1 });
    expect(serializeSurveyListQuery(next)).toBe(`q=%EC%8B%A4&tag=${TAG_A}&tag=${TAG_B}`);
  });

  it('남은 단어가 없으면 검색어가 빈다', () => {
    const next = pickTagSuggestion({ ...INITIAL_SURVEY_LIST_PAGE_QUERY, q: 'a사' }, TAG_A, '');
    expect(next).toEqual({ ...INITIAL_SURVEY_LIST_PAGE_QUERY, tagIds: [TAG_A] });
  });
});
