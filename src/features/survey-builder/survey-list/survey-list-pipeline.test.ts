import { describe, expect, it } from 'vitest';

import type { SurveyListItem } from '@/shared/contracts/survey-builder-io';

import {
  countByStatusChip,
  distinctOwners,
  filterSurveyList,
  INITIAL_ADVANCED_FILTERS,
  narrowToGroup,
  paginateSurveyList,
  sortSurveyList,
  SURVEY_LIST_PAGE_SIZE,
} from './survey-list-pipeline';

function item(over: Partial<SurveyListItem> = {}): SurveyListItem {
  return {
    id: 's-1',
    title: '고객 만족도 조사',
    description: null,
    slug: null,
    privateToken: null,
    responseCount: 0,
    completedResponseCount: 0,
    createdAt: new Date('2026-06-01T00:00:00.000Z'),
    updatedAt: new Date('2026-06-02T00:00:00.000Z'),
    endDate: null,
    isPublic: true,
    status: 'published',
    teamId: 'team-1',
    teamName: '연구1본부 - 1팀',
    visibility: 'team',
    assignmentStatus: 'assigned',
    ownerUserId: 'u-1',
    ownerName: '홍길동',
    surveyGroupId: null,
  deletedAt: null,
  isParticipant: false,
    ...over,
  };
}

const baseFilters = {
  searchQuery: '',
  statusChip: 'all' as const,
  advanced: { ...INITIAL_ADVANCED_FILTERS },
};

describe('countByStatusChip', () => {
  it('상태별 건수를 센다 — 전체는 모든 행', () => {
    const counts = countByStatusChip([
      item({ id: 'a', status: 'draft' }),
      item({ id: 'b', status: 'published' }),
      item({ id: 'c', status: 'published' }),
    ]);
    expect(counts).toEqual({ all: 3, draft: 1, published: 2, closed: 0 });
  });
});

describe('narrowToGroup', () => {
  it('groupId 가 없으면 원본을 그대로 돌려준다', () => {
    const rows = [item({ id: 'a' }), item({ id: 'b', surveyGroupId: 'g-1' })];
    expect(narrowToGroup(rows, null)).toBe(rows);
  });

  it('그 그룹의 설문만 남긴다 — 미분류는 빠진다', () => {
    const rows = [
      item({ id: 'a', surveyGroupId: 'g-1' }),
      item({ id: 'b', surveyGroupId: 'g-2' }),
      item({ id: 'c', surveyGroupId: null }),
    ];
    expect(narrowToGroup(rows, 'g-1').map((s) => s.id)).toEqual(['a']);
  });
});

describe('filterSurveyList', () => {
  it('그룹 좁힘은 다른 필터보다 먼저 적용된다', () => {
    const rows = [
      item({ id: 'a', surveyGroupId: 'g-1', status: 'draft' }),
      item({ id: 'b', surveyGroupId: 'g-2', status: 'draft' }),
    ];
    const out = filterSurveyList(rows, { ...baseFilters, statusChip: 'draft', groupId: 'g-1' });
    expect(out.map((s) => s.id)).toEqual(['a']);
  });


  it('상태 칩으로 좁힌다', () => {
    const rows = [item({ id: 'a', status: 'draft' }), item({ id: 'b', status: 'published' })];
    const out = filterSurveyList(rows, { ...baseFilters, statusChip: 'draft' });
    expect(out.map((s) => s.id)).toEqual(['a']);
  });

  it('검색은 제목 부분 일치 — 대소문자 무시', () => {
    const rows = [item({ id: 'a', title: 'Brand Tracker' }), item({ id: 'b' })];
    const out = filterSurveyList(rows, { ...baseFilters, searchQuery: 'brand' });
    expect(out.map((s) => s.id)).toEqual(['a']);
  });

  it('기간 필터는 선택한 날짜 기준 컬럼으로 판정하고 값이 없는 행을 떨군다', () => {
    const rows = [
      item({ id: 'a', endDate: new Date('2026-07-10T00:00:00.000Z') }),
      item({ id: 'b', endDate: null }),
    ];
    const out = filterSurveyList(rows, {
      ...baseFilters,
      advanced: {
        ...INITIAL_ADVANCED_FILTERS,
        dateField: 'endDate',
        dateFrom: '2026-07-01',
        dateTo: '2026-07-31',
      },
    });
    expect(out.map((s) => s.id)).toEqual(['a']);
  });

  it('기간 종료일은 그날의 끝까지 포함한다', () => {
    const rows = [item({ id: 'a', updatedAt: new Date('2026-07-31T23:00:00') })];
    const out = filterSurveyList(rows, {
      ...baseFilters,
      advanced: { ...INITIAL_ADVANCED_FILTERS, dateTo: '2026-07-31' },
    });
    expect(out).toHaveLength(1);
  });

  it('소유자·공개 범위·응답 수 범위를 함께 적용한다', () => {
    const rows = [
      item({ id: 'a', ownerUserId: 'u-1', visibility: 'team', responseCount: 10 }),
      item({ id: 'b', ownerUserId: 'u-2', visibility: 'team', responseCount: 10 }),
      item({ id: 'c', ownerUserId: 'u-1', visibility: 'invite_only', responseCount: 10 }),
      item({ id: 'd', ownerUserId: 'u-1', visibility: 'team', responseCount: 99 }),
    ];
    const out = filterSurveyList(rows, {
      ...baseFilters,
      advanced: {
        ...INITIAL_ADVANCED_FILTERS,
        ownerUserId: 'u-1',
        visibility: 'team',
        responsesMin: 5,
        responsesMax: 50,
      },
    });
    expect(out.map((s) => s.id)).toEqual(['a']);
  });
});

describe('sortSurveyList', () => {
  const rows = [
    item({
      id: 'a',
      title: '나 설문',
      responseCount: 5,
      createdAt: new Date('2026-01-01'),
      updatedAt: new Date('2026-03-01'),
    }),
    item({
      id: 'b',
      title: '가 설문',
      responseCount: 9,
      createdAt: new Date('2026-02-01'),
      updatedAt: new Date('2026-02-01'),
    }),
  ];

  it('최신 수정순', () => {
    expect(sortSurveyList(rows, 'updatedAt').map((s) => s.id)).toEqual(['a', 'b']);
  });
  it('생성일순', () => {
    expect(sortSurveyList(rows, 'createdAt').map((s) => s.id)).toEqual(['b', 'a']);
  });
  it('이름 가나다순', () => {
    expect(sortSurveyList(rows, 'title').map((s) => s.id)).toEqual(['b', 'a']);
  });
  it('응답 많은 순', () => {
    expect(sortSurveyList(rows, 'responses').map((s) => s.id)).toEqual(['b', 'a']);
  });
  it('원본 배열을 바꾸지 않는다', () => {
    const before = rows.map((s) => s.id);
    sortSurveyList(rows, 'responses');
    expect(rows.map((s) => s.id)).toEqual(before);
  });
});

describe('paginateSurveyList', () => {
  const many = Array.from({ length: SURVEY_LIST_PAGE_SIZE + 3 }, (_, i) => item({ id: `s-${i}` }));

  it('페이지 크기만큼 자른다', () => {
    const { pageItems, totalPages, page } = paginateSurveyList(many, 1);
    expect(pageItems).toHaveLength(SURVEY_LIST_PAGE_SIZE);
    expect(totalPages).toBe(2);
    expect(page).toBe(1);
  });

  it('범위 밖 page 는 클램프한다 — 필터로 총량이 줄어든 뒤에도 빈 화면이 되지 않게', () => {
    const { pageItems, page } = paginateSurveyList(many, 99);
    expect(page).toBe(2);
    expect(pageItems).toHaveLength(3);
  });

  it('빈 목록도 1페이지로 선다', () => {
    expect(paginateSurveyList([], 1)).toEqual({ pageItems: [], totalPages: 1, page: 1 });
  });
});

describe('distinctOwners', () => {
  it('소유자를 중복 없이 이름순으로 모으고 소유자 없는 행(옛 설문)은 건너뛴다', () => {
    const owners = distinctOwners([
      item({ ownerUserId: 'u-2', ownerName: '나윤희' }),
      item({ ownerUserId: 'u-1', ownerName: '강도현' }),
      item({ ownerUserId: 'u-2', ownerName: '나윤희' }),
      item({ ownerUserId: null, ownerName: null }),
    ]);
    expect(owners).toEqual([
      { id: 'u-1', name: '강도현' },
      { id: 'u-2', name: '나윤희' },
    ]);
  });
});
