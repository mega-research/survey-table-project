import { create } from 'zustand';
import { devtools } from 'zustand/middleware';

import {
  INITIAL_ADVANCED_FILTERS,
  type SurveyListAdvancedFilters,
  type SurveyListSortBy,
  type SurveyListStatusChip,
} from '../survey-list/survey-list-pipeline';

/**
 * 설문 목록 UI 상태 (역할 모델 v2 티켓 08 — 상태 칩·검색·정렬·상세 검색·페이지네이션).
 *
 * 실 설문 데이터는 TanStack Query(useSurveys)가 갖고, 이 store 는 그 위의 필터/정렬/페이지
 * UI 상태만 갖는다. 목록 총량이 바뀌는 필터 변경은 항상 page 를 1로 되돌린다.
 * 팀 전환 시의 전체 초기화는 화면(survey-list-view)이 resetAll 로 한다 — 이전 팀의
 * 필터·페이지가 새 팀 목록을 조용히 0건으로 만들지 않게.
 */
interface SurveyListUIState {
  searchQuery: string;
  statusChip: SurveyListStatusChip;
  sortBy: SurveyListSortBy;
  advancedOpen: boolean;
  advanced: SurveyListAdvancedFilters;
  page: number;

  setSearchQuery: (query: string) => void;
  setStatusChip: (chip: SurveyListStatusChip) => void;
  setSortBy: (sortBy: SurveyListSortBy) => void;
  setAdvancedOpen: (open: boolean) => void;
  setAdvanced: (patch: Partial<SurveyListAdvancedFilters>) => void;
  setPage: (page: number) => void;
  /** 상세 검색 패널의 「초기화」 — advanced 필드만 되돌린다(검색어·상태 칩은 유지). */
  resetAdvanced: () => void;
  /** 전체 초기화 — 팀 전환·「결과 없음」 초기화 버튼. */
  resetAll: () => void;
}

export const useSurveyListStore = create<SurveyListUIState>()(
  devtools(
    (set) => ({
      searchQuery: '',
      statusChip: 'all',
      sortBy: 'updatedAt',
      advancedOpen: false,
      advanced: { ...INITIAL_ADVANCED_FILTERS },
      page: 1,

      setSearchQuery: (query) => set({ searchQuery: query, page: 1 }),
      setStatusChip: (chip) => set({ statusChip: chip, page: 1 }),
      setSortBy: (sortBy) => set({ sortBy }),
      setAdvancedOpen: (open) => set({ advancedOpen: open }),
      setAdvanced: (patch) =>
        set((state) => ({ advanced: { ...state.advanced, ...patch }, page: 1 })),
      setPage: (page) => set({ page }),
      resetAdvanced: () => set({ advanced: { ...INITIAL_ADVANCED_FILTERS }, page: 1 }),
      resetAll: () =>
        set({
          searchQuery: '',
          statusChip: 'all',
          sortBy: 'updatedAt',
          advancedOpen: false,
          advanced: { ...INITIAL_ADVANCED_FILTERS },
          page: 1,
        }),
    }),
    {
      name: 'survey-list-ui-store',
    },
  ),
);
