'use client';

import React from 'react';

import { CellText } from '@/components/survey/cell-text';
import { useAnswerQuotes, useContactAttrs } from '@/lib/survey/contact-attrs-context';
import { substituteTokens } from '@/lib/survey/substitute-tokens';
import { cn } from '@/lib/utils';
import { getCellTextClassName, getCellTextStyle } from '@/utils/cell-style';

import type { InteractiveCellProps, PreviewCellProps } from './types';

/** 텍스트 표시 셀 (인터랙티브 / 미리보기 동일) */
export const TextCell = React.memo(function TextCell({
  cell,
}: InteractiveCellProps | PreviewCellProps) {
  const attrs = useContactAttrs();
  const quotes = useAnswerQuotes();

  if (!cell.content) {
    return <span className="text-sm text-gray-400" />;
  }

  return (
    <div
      className={cn(
        'text-base leading-relaxed [overflow-wrap:anywhere] whitespace-pre-wrap',
        getCellTextClassName(cell),
      )}
      style={getCellTextStyle(cell)}
    >
      <CellText
        text={substituteTokens(cell.content, attrs, quotes)}
        boldFirstLine={cell.boldFirstLine}
      />
    </div>
  );
});
