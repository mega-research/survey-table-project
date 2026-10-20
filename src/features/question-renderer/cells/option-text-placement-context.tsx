'use client';

import { type ReactNode, createContext, useContext } from 'react';

import { movesOptionTextBelowTable } from '@/features/question-renderer/utils/option-text-below-table';
import type { TableCell } from '@/types/survey';

/**
 * 이 표를 그리는 호스트가 「표 아래 상세 기재」 줄을 그리는가.
 *
 * 칸 옵션(`TableCell.optionTextBelowTable`)만 보고 칸이 입력칸을 감추면, 표 아래 줄을 그리지 않는
 * 호스트(모바일 카드·드릴다운·빌더 행 카드)에서는 입력칸이 어디에도 없게 된다. 그래서 격자 표가
 * "내가 아래에 그린다"고 공급할 때만 칸이 제 입력칸을 접는다 — 공급이 없으면 종전대로 칸 안이다.
 */
const OptionTextBelowTableHostContext = createContext(false);

export function OptionTextBelowTableHost({ children }: { children: ReactNode }) {
  return (
    <OptionTextBelowTableHostContext.Provider value={true}>
      {children}
    </OptionTextBelowTableHostContext.Provider>
  );
}

/** 이 칸의 상세 기재 입력칸이 표 아래로 나갔는가 — 참이면 칸 안에는 그리지 않는다 */
export function useOptionTextMovedBelowTable(cell: TableCell): boolean {
  const hostDrawsBelow = useContext(OptionTextBelowTableHostContext);
  return hostDrawsBelow && movesOptionTextBelowTable(cell);
}
