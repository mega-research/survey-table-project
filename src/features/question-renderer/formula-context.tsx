'use client';

import { createContext, useContext } from 'react';
import type { FormulaEvalCtx } from '@/lib/survey/cell-formula';

// calc 셀이 표 밖의 응답·LUT·attrs 를 실시간으로 읽기 위한 채널.
// ContactAttrsProvider(quotes)와 같은 "저장 전 파생값" 전달 패턴이다.
const FormulaEvalContext = createContext<FormulaEvalCtx | null>(null);

export function FormulaEvalProvider({
  value,
  children,
}: {
  value: FormulaEvalCtx;
  children: React.ReactNode;
}) {
  return <FormulaEvalContext.Provider value={value}>{children}</FormulaEvalContext.Provider>;
}

export function useFormulaEvalCtx(): FormulaEvalCtx | null {
  return useContext(FormulaEvalContext);
}
