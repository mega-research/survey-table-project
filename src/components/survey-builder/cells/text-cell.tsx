'use client';

import React from 'react';

import { useContactAttrs } from '@/lib/survey/contact-attrs-context';
import { substituteTokens } from '@/lib/survey/substitute-tokens';

import type { InteractiveCellProps, PreviewCellProps } from './types';

/** 텍스트 표시 셀 (인터랙티브 / 미리보기 동일) */
export const TextCell = React.memo(function TextCell({
  cell,
}: InteractiveCellProps | PreviewCellProps) {
  const attrs = useContactAttrs();

  if (!cell.content) {
    return <span className="text-sm text-gray-400" />;
  }

  return (
    <div className="text-base leading-relaxed whitespace-pre-wrap [overflow-wrap:anywhere]">
      {substituteTokens(cell.content, attrs)}
    </div>
  );
});
