import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import { immer } from 'zustand/middleware/immer';

interface TestResponseState {
  // 테스트용 임시 응답 데이터
  testResponses: Record<string, string | string[] | Record<string, string | string[] | object>>;

  // 액션들
  updateTestResponse: (
    questionId: string,
    value: string | string[] | Record<string, string | string[] | object>,
  ) => void;
  clearTestResponses: () => void;
}

export const useTestResponseStore = create<TestResponseState>()(
  devtools(
    immer((set) => ({
      testResponses: {},

      updateTestResponse: (questionId, value) =>
        set((state) => {
          state.testResponses[questionId] = value;
        }),

      clearTestResponses: () =>
        set((state) => {
          state.testResponses = {};
        }),
    })),
    {
      name: 'test-response-store',
    },
  ),
);
