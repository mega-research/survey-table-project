import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import { immer } from 'zustand/middleware/immer';

import { DEFAULT_CATEGORIES, QuestionCategory } from '@/types/survey';

/**
 * 질문 보관함 UI 상태 관리
 * 실제 보관함 데이터는 TanStack Query로 관리
 */
interface QuestionLibraryUIState {
  // UI 상태
  searchQuery: string;
  selectedCategory: string | null;
  selectedTag: string | null;
  selectedQuestionIds: string[];
  isLibraryPanelOpen: boolean;

  // 액션들
  setSearchQuery: (query: string) => void;
  setSelectedCategory: (category: string | null) => void;
  setSelectedTag: (tag: string | null) => void;
  selectQuestion: (questionId: string) => void;
  deselectQuestion: (questionId: string) => void;
  toggleQuestionSelection: (questionId: string) => void;
  clearSelection: () => void;
  toggleLibraryPanel: () => void;
  openLibraryPanel: () => void;
  closeLibraryPanel: () => void;
  resetFilters: () => void;
}

export const useQuestionLibraryStore = create<QuestionLibraryUIState>()(
  devtools(
    immer<QuestionLibraryUIState>((set) => ({
      searchQuery: '',
      selectedCategory: null,
      selectedTag: null,
      selectedQuestionIds: [],
      isLibraryPanelOpen: false,

      setSearchQuery: (query) =>
        set((state) => {
          state.searchQuery = query;
        }),

      setSelectedCategory: (category) =>
        set((state) => {
          state.selectedCategory = category;
          state.selectedTag = null;
        }),

      setSelectedTag: (tag) =>
        set((state) => {
          state.selectedTag = tag;
        }),

      selectQuestion: (questionId) =>
        set((state) => {
          if (!state.selectedQuestionIds.includes(questionId)) {
            state.selectedQuestionIds.push(questionId);
          }
        }),

      deselectQuestion: (questionId) =>
        set((state) => {
          state.selectedQuestionIds = state.selectedQuestionIds.filter((id) => id !== questionId);
        }),

      toggleQuestionSelection: (questionId) =>
        set((state) => {
          if (state.selectedQuestionIds.includes(questionId)) {
            state.selectedQuestionIds = state.selectedQuestionIds.filter((id) => id !== questionId);
          } else {
            state.selectedQuestionIds.push(questionId);
          }
        }),

      clearSelection: () =>
        set((state) => {
          state.selectedQuestionIds = [];
        }),

      toggleLibraryPanel: () =>
        set((state) => {
          state.isLibraryPanelOpen = !state.isLibraryPanelOpen;
        }),

      openLibraryPanel: () =>
        set((state) => {
          state.isLibraryPanelOpen = true;
        }),

      closeLibraryPanel: () =>
        set((state) => {
          state.isLibraryPanelOpen = false;
        }),

      resetFilters: () =>
        set((state) => {
          state.searchQuery = '';
          state.selectedCategory = null;
          state.selectedTag = null;
        }),
    })) as any,
    {
      name: 'question-library-ui-store',
    },
  ),
);

// 기본 카테고리 export (하위 호환성)
export { DEFAULT_CATEGORIES };
export type { QuestionCategory };
