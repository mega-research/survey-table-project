import { create } from 'zustand';
import { devtools } from 'zustand/middleware';

import type { VariableDef } from '@/components/operations/mail-template/variable-catalog';

interface SurveyUIState {
  // UI 상태
  selectedQuestionId: string | null;

  // 현재 편집 중인 질문 ID (모달 open/close 시 설정)
  editingQuestionId: string | null;

  // 설문 변수 카탈로그 (prefill {{attrs_key}} 토큰용)
  variableCatalog: VariableDef[];

  // 액션들
  selectQuestion: (questionId: string | null) => void;
  setEditingQuestionId: (id: string | null) => void;
  setVariableCatalog: (catalog: VariableDef[]) => void;
}

export const useSurveyUIStore = create<SurveyUIState>()(
  devtools(
    (set) => ({
      selectedQuestionId: null,
      editingQuestionId: null,
      variableCatalog: [],

      selectQuestion: (questionId) => set({ selectedQuestionId: questionId }),
      setEditingQuestionId: (id) => set({ editingQuestionId: id }),
      setVariableCatalog: (catalog) => set({ variableCatalog: catalog }),
    }),
    {
      name: 'survey-ui-store',
    },
  ),
);
