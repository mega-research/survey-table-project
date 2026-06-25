import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import { immer } from 'zustand/middleware/immer';

/**
 * 설문 목록 UI 상태 관리
 * 실제 설문 데이터는 TanStack Query로 관리
 */
interface SurveyListUIState {
  // UI 상태
  searchQuery: string;
  selectedSurveyIds: string[];
  sortBy: 'createdAt' | 'updatedAt' | 'title';
  sortOrder: 'asc' | 'desc';
  filterByPublic: boolean | null; // null = 전체, true = 공개만, false = 비공개만

  // 액션들
  setSearchQuery: (query: string) => void;
  selectSurvey: (surveyId: string) => void;
  deselectSurvey: (surveyId: string) => void;
  toggleSurveySelection: (surveyId: string) => void;
  selectAllSurveys: (surveyIds: string[]) => void;
  clearSelection: () => void;
  setSortBy: (sortBy: 'createdAt' | 'updatedAt' | 'title') => void;
  setSortOrder: (order: 'asc' | 'desc') => void;
  toggleSortOrder: () => void;
  setFilterByPublic: (filter: boolean | null) => void;
  resetFilters: () => void;
}

export const useSurveyListStore = create<SurveyListUIState>()(
  devtools(
    immer<SurveyListUIState>((set) => ({
      searchQuery: '',
      selectedSurveyIds: [],
      sortBy: 'updatedAt',
      sortOrder: 'desc',
      filterByPublic: null,

      setSearchQuery: (query: string) =>
        set((state) => {
          state.searchQuery = query;
        }),

      selectSurvey: (surveyId: string) =>
        set((state) => {
          if (!state.selectedSurveyIds.includes(surveyId)) {
            state.selectedSurveyIds.push(surveyId);
          }
        }),

      deselectSurvey: (surveyId: string) =>
        set((state) => {
          state.selectedSurveyIds = state.selectedSurveyIds.filter((id) => id !== surveyId);
        }),

      toggleSurveySelection: (surveyId: string) =>
        set((state) => {
          if (state.selectedSurveyIds.includes(surveyId)) {
            state.selectedSurveyIds = state.selectedSurveyIds.filter((id) => id !== surveyId);
          } else {
            state.selectedSurveyIds.push(surveyId);
          }
        }),

      selectAllSurveys: (surveyIds: string[]) =>
        set((state) => {
          state.selectedSurveyIds = surveyIds;
        }),

      clearSelection: () =>
        set((state) => {
          state.selectedSurveyIds = [];
        }),

      setSortBy: (sortBy) =>
        set((state) => {
          state.sortBy = sortBy;
        }),

      setSortOrder: (order) =>
        set((state) => {
          state.sortOrder = order;
        }),

      toggleSortOrder: () =>
        set((state) => {
          state.sortOrder = state.sortOrder === 'asc' ? 'desc' : 'asc';
        }),

      setFilterByPublic: (filter) =>
        set((state) => {
          state.filterByPublic = filter;
        }),

      resetFilters: () =>
        set((state) => {
          state.searchQuery = '';
          state.sortBy = 'updatedAt';
          state.sortOrder = 'desc';
          state.filterByPublic = null;
        }),
    })) as any,
    {
      name: 'survey-list-ui-store',
    },
  ),
);

// 타입 export (하위 호환성)
export interface SurveyListItem {
  id: string;
  title: string;
  description?: string;
  slug?: string;
  privateToken?: string;
  responseCount: number;
  completedResponseCount: number;
  createdAt: Date;
  updatedAt: Date;
  isPublic: boolean;
}
