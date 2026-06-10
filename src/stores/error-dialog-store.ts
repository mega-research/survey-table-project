import { create } from 'zustand';

import type { VarNameIssue } from '@/lib/spss/variable-name-guard';

interface ErrorDialogPayload {
  title: string;
  description?: string;
  issues?: VarNameIssue[];
}

interface ErrorDialogState {
  open: boolean;
  title: string;
  // zustand set은 부분 머지라 show()마다 반드시 덮어써야 이전 호출 값이 잔류하지 않는다.
  // 그래서 optional(?)이 아니라 명시적 | undefined 유니온으로 선언한다.
  description: string | undefined;
  issues: VarNameIssue[] | undefined;
  show: (payload: ErrorDialogPayload) => void;
  close: () => void;
}

/**
 * 전역 구조화 에러 다이얼로그 상태.
 * 목록이 있는 에러(SPSS 변수명 issues 등)는 토스트 대신 이 다이얼로그로 표시한다.
 */
export const useErrorDialogStore = create<ErrorDialogState>((set) => ({
  open: false,
  title: '',
  description: undefined,
  issues: undefined,
  show: (payload) =>
    set({
      open: true,
      title: payload.title,
      description: payload.description,
      issues: payload.issues,
    }),
  close: () => set({ open: false }),
}));
