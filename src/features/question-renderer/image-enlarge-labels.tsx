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
 * 표 안 이미지의 크게 보기 머리 줄 — 「행 제목 · 열 제목」. 이미지 셀은 제 칸만 알고 표 구조를 모르므로
 * 표를 그리는 쪽이 셀 id → 자리 라벨을 한 번 계산해 내려 준다. 공급자가 없는 자리(표 밖)는 라벨 없음.
 */
const ImageEnlargeLabelsContext = createContext<ReadonlyMap<string, string> | null>(null);

export function ImageEnlargeLabelsProvider({
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
    <ImageEnlargeLabelsContext.Provider value={labels}>
      {children}
    </ImageEnlargeLabelsContext.Provider>
  );
}

/** 이 셀의 자리 라벨(토큰 치환 후). 표 밖이거나 라벨이 비면 undefined */
export function useImageEnlargeTitle(cellId: string): string | undefined {
  const labels = useContext(ImageEnlargeLabelsContext);
  const attrs = useContactAttrs();
  const quotes = useAnswerQuotes();
  const label = labels?.get(cellId);
  return label ? substituteTokens(label, attrs, quotes) : undefined;
}
