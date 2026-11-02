import { describe, expect, it } from 'vitest';

import {
  INITIAL_ADVANCED_FILTERS,
  INITIAL_SURVEY_LIST_PAGE_QUERY,
  type SurveyListPageQuery,
} from '@/shared/contracts/survey-builder-io';

import {
  changeSurveyListQuery,
  clearNarrowingFilters,
  hasNarrowingFilters,
  parseSurveyListQuery,
  serializeSurveyListQuery,
} from './survey-list-url';

const GROUP = '11111111-2222-4333-8444-555555555555';
const TEAM = '22222222-3333-4444-8555-666666666666';
const OWNER = '33333333-4444-4555-8666-777777777777';

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
      `team=${TEAM}&ungrouped=1&q=2026+%EC%8B%A4%ED%83%9C&status=closed&fav=1&sort=responses` +
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

  it('휴지통에는 즐겨찾기 조건이 없다 — 함께 오면 즐겨찾기를 접는다', () => {
    expect(parse('fav=1')).toEqual({ ...INITIAL_SURVEY_LIST_PAGE_QUERY, favorites: true });
    expect(parse('trash=1&fav=1')).toEqual({ ...INITIAL_SURVEY_LIST_PAGE_QUERY, deleted: true });
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

  it('페이지만 바꾸면 그 페이지로 간다', () => {
    expect(changeSurveyListQuery(onPage3, { page: 5 })).toEqual({ ...onPage3, page: 5 });
  });

  it('같은 값으로 바꾸면 페이지를 지키고 같은 객체를 돌려준다', () => {
    expect(changeSurveyListQuery(onPage3, { sort: 'updatedAt' })).toBe(onPage3);
  });
});

describe('걸린 조건이 있는가 — 결과 0개 화면의 「조건 풀기」 단추', () => {
  it('검색·목록 상태·상세 검색·즐겨찾기 중 하나라도 걸리면 참', () => {
    expect(hasNarrowingFilters({ ...INITIAL_SURVEY_LIST_PAGE_QUERY, favorites: true })).toBe(true);
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
  it('검색·목록 상태·상세 검색·즐겨찾기만 되돌리고 그룹·팀·휴지통·정렬은 남긴다', () => {
    expect(clearNarrowingFilters(FULL)).toEqual({
      ...INITIAL_SURVEY_LIST_PAGE_QUERY,
      teamId: TEAM,
      ungrouped: true,
      sort: 'responses',
    });
  });
});
