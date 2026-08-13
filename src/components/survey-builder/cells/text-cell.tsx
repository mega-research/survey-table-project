'use client';

import React from 'react';

import { useAnswerQuotes, useContactAttrs } from '@/lib/survey/contact-attrs-context';
import { substituteTokens } from '@/lib/survey/substitute-tokens';
import { getCellTextClassName, getCellTextStyle } from '@/utils/cell-style';
import { cn } from '@/lib/utils';

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
        'text-base leading-relaxed whitespace-pre-wrap [overflow-wrap:anywhere]',
        getCellTextClassName(cell),
      )}
      style={getCellTextStyle(cell)}
    >
      {substituteTokens(cell.content, attrs, quotes)}
    </div>
  );
});
