// 설문 목록 렌더링 파이프라인 — 순수 계산 (역할 모델 v2 티켓 08, .pen FLOW 6 목록 툴바).
//
// 서버는 범위로 좁힌 전체 목록을 주고(read.list), 칩·검색·상세 검색·정렬·페이지는 화면이
// 이 함수들로 접는다. 문의 칩·미답변 문의 필터는 Plan 3 게이트로 어휘에서 뺐다.
//
// 그룹 필터(티켓 12)는 여기 상태가 아니라 **URL 이 정한다**(`?group=<id>`) — 그룹 화면은
// 브레드크럼과 제목을 가진 별개의 화면이라 뒤로 가기·새로고침·링크 공유가 살아 있어야 한다.

import type { SurveyListItem } from '@/shared/contracts/survey-builder-io';

export type SurveyListStatusChip = 'all' | 'draft' | 'published' | 'closed';
export type SurveyListSortBy = 'updatedAt' | 'createdAt' | 'title' | 'responses';
export type SurveyListDateField = 'updatedAt' | 'createdAt' | 'endDate';
export type SurveyListVisibilityFilter = 'team' | 'invite_only' | null;

export interface SurveyListAdvancedFilters {
  dateField: SurveyListDateField;
  /** ISO date(YYYY-MM-DD). null 이면 미적용. */
  dateFrom: string | null;
  dateTo: string | null;
  ownerUserId: string | null;
  visibility: SurveyListVisibilityFilter;
  responsesMin: number | null;
  responsesMax: number | null;
}

export const INITIAL_ADVANCED_FILTERS: SurveyListAdvancedFilters = {
  dateField: 'updatedAt',
  dateFrom: null,
  dateTo: null,
  ownerUserId: null,
  visibility: null,
  responsesMin: null,
  responsesMax: null,
};

export interface SurveyListFilterState {
  searchQuery: string;
  statusChip: SurveyListStatusChip;
  advanced: SurveyListAdvancedFilters;
  /** 그룹 화면(`?group=<id>`)의 좁힘. null 이면 그룹과 무관하게 전부 본다. */
  groupId?: string | null;
}

/**
 * 그룹 좁힘 — 그룹 화면(`?group=<id>`)이 보는 부분집합.
 *
 * 칩 카운트·소유자 목록도 이 결과를 받아야 한다. 그룹 화면의 「전체 N」이 팀 전체를 세면
 * 화면에 3장 있는데 칩은 14 라고 말한다. 소속 팀이 다른 그룹 id 는 서버가 이미 null 로
 * 접어 보내므로 여기서 팀을 다시 보지 않는다.
 */
export function narrowToGroup(
  items: readonly SurveyListItem[],
  groupId: string | null,
): readonly SurveyListItem[] {
  if (!groupId) return items;
  return items.filter((s) => s.surveyGroupId === groupId);
}

/** 상태 칩별 목록 건수 — 툴바 칩에 "전체 N" 형태로 표시. */
export function countByStatusChip(items: readonly SurveyListItem[]) {
  return {
    all: items.length,
    draft: items.filter((s) => s.status === 'draft').length,
    published: items.filter((s) => s.status === 'published').length,
    closed: items.filter((s) => s.status === 'closed').length,
  };
}

function withinDateRange(raw: Date | null, from: string | null, to: string | null): boolean {
  if (!raw) return false;
  const d = new Date(raw);
  if (from && d < new Date(from)) return false;
  if (to) {
    const end = new Date(to);
    end.setHours(23, 59, 59, 999);
    if (d > end) return false;
  }
  return true;
}

function dateFieldValue(item: SurveyListItem, field: SurveyListDateField): Date | null {
  if (field === 'updatedAt') return item.updatedAt;
  if (field === 'createdAt') return item.createdAt;
  return item.endDate;
}

/** 상태 칩 → 검색(제목) → 상세 검색 필터를 순서대로 적용한다(정렬은 별도, sortSurveyList). */
export function filterSurveyList(
  items: readonly SurveyListItem[],
  filters: SurveyListFilterState,
): readonly SurveyListItem[] {
  let result: readonly SurveyListItem[] = items;

  // 그룹 좁힘이 먼저다 — 칩 카운트와 같은 부분집합에서 출발해야 화면과 숫자가 어긋나지 않는다.
  result = narrowToGroup(result, filters.groupId ?? null);

  if (filters.statusChip !== 'all') {
    result = result.filter((s) => s.status === filters.statusChip);
  }

  const q = filters.searchQuery.trim().toLowerCase();
  if (q) {
    result = result.filter((s) => s.title.toLowerCase().includes(q));
  }

  const { advanced } = filters;
  if (advanced.dateFrom || advanced.dateTo) {
    result = result.filter((s) =>
      withinDateRange(dateFieldValue(s, advanced.dateField), advanced.dateFrom, advanced.dateTo),
    );
  }
  if (advanced.ownerUserId) {
    result = result.filter((s) => s.ownerUserId === advanced.ownerUserId);
  }
  if (advanced.visibility) {
    result = result.filter((s) => s.visibility === advanced.visibility);
  }
  if (advanced.responsesMin !== null) {
    const min = advanced.responsesMin;
    result = result.filter((s) => s.responseCount >= min);
  }
  if (advanced.responsesMax !== null) {
    const max = advanced.responsesMax;
    result = result.filter((s) => s.responseCount <= max);
  }

  return result;
}

/** 정렬 방향은 sortBy 값마다 고정 — 사용자 토글 없음(.pen 정렬 드롭 어휘 그대로). */
export function sortSurveyList(
  items: readonly SurveyListItem[],
  sortBy: SurveyListSortBy,
): SurveyListItem[] {
  const sorted = [...items];
  switch (sortBy) {
    case 'updatedAt':
      sorted.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
      break;
    case 'createdAt':
      sorted.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      break;
    case 'title':
      sorted.sort((a, b) => a.title.localeCompare(b.title, 'ko'));
      break;
    case 'responses':
      sorted.sort((a, b) => b.responseCount - a.responseCount);
      break;
  }
  return sorted;
}

export const SURVEY_LIST_PAGE_SIZE = 24;

export interface SurveyListPage<T> {
  pageItems: T[];
  totalPages: number;
  /** 요청한 page 가 범위를 벗어나면 클램프된 값. */
  page: number;
}

export function paginateSurveyList<T>(
  items: readonly T[],
  page: number,
  pageSize: number = SURVEY_LIST_PAGE_SIZE,
): SurveyListPage<T> {
  const totalPages = Math.max(1, Math.ceil(items.length / pageSize));
  const clampedPage = Math.min(Math.max(1, page), totalPages);
  const start = (clampedPage - 1) * pageSize;
  return { pageItems: items.slice(start, start + pageSize), totalPages, page: clampedPage };
}

/**
 * 목록 내 소유자 distinct(상세 검색 「소유자」 드롭다운용) — 이름순 정렬.
 * 소유자 없는 행(0116 2단계 배포 이전의 옛 설문)은 후보가 될 수 없어 건너뛴다.
 */
export function distinctOwners(
  items: readonly SurveyListItem[],
): { id: string; name: string }[] {
  const map = new Map<string, string>();
  for (const s of items) {
    if (s.ownerUserId && !map.has(s.ownerUserId)) map.set(s.ownerUserId, s.ownerName ?? '');
  }
  return Array.from(map, ([id, name]) => ({ id, name })).sort((a, b) =>
    a.name.localeCompare(b.name, 'ko'),
  );
}
