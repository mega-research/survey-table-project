import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import { immer } from 'zustand/middleware/immer';

/**
 * 설문 응답 UI 상태 관리
 * 실제 응답 데이터는 TanStack Query로 관리
 */
interface SurveyResponseUIState {
  // 현재 응답 세션 상태
  currentResponseId: string | null;
  currentQuestionIndex: number;

  // 임시 응답 데이터 (아직 서버에 저장되지 않은 것)
  pendingResponses: Record<string, unknown>;

  // 옵션별 텍스트 입력 상태 (questionId -> optionId -> text)
  // 예: "기타" 입력, 순위형 텍스트 등 옵션 단위 텍스트 보관
  optionTexts: Record<string, Record<string, string>>;

  // UI 상태
  isSubmitting: boolean;
  showValidationErrors: boolean;
  validationErrors: Record<string, string>;

  // 액션들
  setCurrentResponseId: (responseId: string | null) => void;
  setCurrentQuestionIndex: (index: number) => void;
  goToNextQuestion: () => void;
  goToPreviousQuestion: () => void;

  // 임시 응답 관리
  setPendingResponse: (questionId: string, value: unknown) => void;
  clearPendingResponses: () => void;

  // 옵션 텍스트 관리
  setOptionText: (questionId: string, optionId: string, text: string) => void;
  getOptionText: (questionId: string, optionId: string) => string | undefined;
  clearOptionTexts: (questionId: string) => void;

  // 유효성 검사
  setValidationError: (questionId: string, error: string) => void;
  clearValidationError: (questionId: string) => void;
  clearAllValidationErrors: () => void;
  setShowValidationErrors: (show: boolean) => void;

  // 제출 상태
  setIsSubmitting: (isSubmitting: boolean) => void;

  // 초기화
  resetResponseState: () => void;
}

export const useSurveyResponseStore = create<SurveyResponseUIState>()(
  devtools(
    immer<SurveyResponseUIState>((set, get) => ({
      currentResponseId: null,
      currentQuestionIndex: 0,
      pendingResponses: {},
      optionTexts: {},
      isSubmitting: false,
      showValidationErrors: false,
      validationErrors: {},

      setCurrentResponseId: (responseId) =>
        set((state) => {
          state.currentResponseId = responseId;
        }),

      setCurrentQuestionIndex: (index) =>
        set((state) => {
          state.currentQuestionIndex = index;
        }),

      goToNextQuestion: () =>
        set((state) => {
          state.currentQuestionIndex += 1;
        }),

      goToPreviousQuestion: () =>
        set((state) => {
          state.currentQuestionIndex = Math.max(0, state.currentQuestionIndex - 1);
        }),

      setPendingResponse: (questionId, value) =>
        set((state) => {
          state.pendingResponses[questionId] = value;
        }),

      clearPendingResponses: () =>
        set((state) => {
          state.pendingResponses = {};
        }),

      setOptionText: (questionId, optionId, text) =>
        set((state) => {
          if (!state.optionTexts[questionId]) {
            state.optionTexts[questionId] = {};
          }
          state.optionTexts[questionId][optionId] = text;
        }),

      getOptionText: (questionId, optionId) => {
        return get().optionTexts[questionId]?.[optionId];
      },

      clearOptionTexts: (questionId) =>
        set((state) => {
          delete state.optionTexts[questionId];
        }),

      setValidationError: (questionId, error) =>
        set((state) => {
          state.validationErrors[questionId] = error;
        }),

      clearValidationError: (questionId) =>
        set((state) => {
          delete state.validationErrors[questionId];
        }),

      clearAllValidationErrors: () =>
        set((state) => {
          state.validationErrors = {};
        }),

      setShowValidationErrors: (show) =>
        set((state) => {
          state.showValidationErrors = show;
        }),

      setIsSubmitting: (isSubmitting) =>
        set((state) => {
          state.isSubmitting = isSubmitting;
        }),

      resetResponseState: () =>
        set((state) => {
          state.currentResponseId = null;
          state.currentQuestionIndex = 0;
          state.pendingResponses = {};
          state.optionTexts = {};
          state.isSubmitting = false;
          state.showValidationErrors = false;
          state.validationErrors = {};
        }),
    })) as any,
    {
      name: 'survey-response-ui-store',
    },
  ),
);

// 타입 export (하위 호환성)
export interface SurveyResponse {
  id: string;
  surveyId: string;
  questionResponses: Record<string, unknown>;
  completedAt: Date;
  startedAt: Date;
  isCompleted: boolean;
  metadata?: {
    userAgent?: string;
    sessionId?: string;
  };
}

export interface SurveyResponseSummary {
  surveyId: string;
  totalResponses: number;
  completedResponses: number;
  averageCompletionTime: number;
  lastResponseAt?: Date;
  responseRate: number;
}
