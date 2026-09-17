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
  /**
   * 휴지통을 보고 있는가 (티켓 17).
   *
   * 상태 칩의 다섯 번째 값이 아니라 **별개의 모드**다. 칩은 이미 받아온 목록을 접는 순수
   * 필터인데 이 값은 **서버 조회 자체**를 바꾼다(쿼리 키가 갈린다) — 같은 어휘에 섞으면
   * "칩을 눌렀는데 왕복이 일어나는 것 하나" 가 생겨 다음 사람이 파이프라인에서 그것을 찾는다.
   * 모드 안에서는 칩이 종전대로 동작한다.
   */
  showDeleted: boolean;
  sortBy: SurveyListSortBy;
  advancedOpen: boolean;
  advanced: SurveyListAdvancedFilters;
  page: number;

  setSearchQuery: (query: string) => void;
  setStatusChip: (chip: SurveyListStatusChip) => void;
  setShowDeleted: (showDeleted: boolean) => void;
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
      showDeleted: false,
      sortBy: 'updatedAt',
      advancedOpen: false,
      advanced: { ...INITIAL_ADVANCED_FILTERS },
      page: 1,

      setSearchQuery: (query) => set({ searchQuery: query, page: 1 }),
      setStatusChip: (chip) => set({ statusChip: chip, page: 1 }),
      // 모드를 바꾸면 목록이 통째로 갈리므로 칩·검색어·페이지를 함께 되돌린다 — 남겨두면
      // 휴지통이 「진행중 + 검색어」로 좁혀진 채 열려 비어 보인다.
      setShowDeleted: (showDeleted) =>
        set({ showDeleted, statusChip: 'all', searchQuery: '', page: 1 }),
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
          showDeleted: false,
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
