'use client';

import { type ReactNode, createContext, useContext, useMemo } from 'react';

import {
  useAnswerQuotes,
  useContactAttrs,
} from '@/features/question-renderer/contact-attrs-context';
import { substituteTokens } from '@/lib/survey/substitute-tokens';
import type { HeaderCell, TableColumn, TableRow } from '@/types/survey';

import { buildCellPositionLabels } from './utils/column-axis-cards';

/**
 * 표 이미지 셀의 「이미지 크게 보기」 범위 — 응답 화면의 표(테이블 · 보기 · 순위 문항)만 이 공급자로
 * 감싼다. 빌더 편집 화면의 표(질문 편집 미리보기 · 합계 제약 · 수식 항 셀 선택)는 공급자 밖이라 크게
 * 보기가 붙지 않는다 — 셀 선택 화면에서 이미지 칸을 누르면 셀이 골라져야 한다.
 *
 * 머리 줄 「행 제목 · 열 제목」도 여기서 내려 준다. 이미지 셀은 제 칸만 알고 표 구조를 모른다.
 */
const TableImageEnlargeContext = createContext<ReadonlyMap<string, string> | null>(null);

export function TableImageEnlargeProvider({
  columns,
  headerGrid,
  rows,
  children,
}: {
  columns: readonly TableColumn[];
  headerGrid?: HeaderCell[][] | undefined;
  rows: TableRow[];
  children: ReactNode;
}) {
  const labels = useMemo(
    () => buildCellPositionLabels({ columns, headerGrid, displayRows: rows }),
    [columns, headerGrid, rows],
  );
  return (
    <TableImageEnlargeContext.Provider value={labels}>{children}</TableImageEnlargeContext.Provider>
  );
}

/**
 * 이 표 이미지 셀의 크게 보기 — 공급자 밖이면 null(크게 보기 없음), 안이면 머리 줄 제목(토큰 치환 후,
 * 비면 undefined).
 */
export function useTableImageEnlarge(cellId: string): { title: string | undefined } | null {
  const labels = useContext(TableImageEnlargeContext);
  const attrs = useContactAttrs();
  const quotes = useAnswerQuotes();
  if (!labels) return null;
  const label = labels.get(cellId);
  return { title: label ? substituteTokens(label, attrs, quotes) : undefined };
}
