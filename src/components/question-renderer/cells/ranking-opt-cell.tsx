'use client';

import React from 'react';

import { cn } from '@/lib/utils';
import { getCellTextClassName, getCellTextStyle } from '@/utils/cell-style';
import type { InteractiveCellProps, PreviewCellProps } from './types';

/**
 * 순위형 옵션 소스 셀 (Case 2).
 * 이 셀 자체는 응답을 받지 않고, 다른 랭킹 질문의 옵션 소스로만 사용됨.
 * 내용(텍스트/이미지/비디오) 을 읽기 전용으로 렌더.
 */
export const RankingOptCell = React.memo(function RankingOptCell({
  cell,
}: InteractiveCellProps | PreviewCellProps) {
  return (
    <div className="flex w-full flex-col gap-1">
      {cell.imageUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={cell.imageUrl}
          alt={cell.content || cell.rankingLabel || '순위 옵션 이미지'}
          className="h-20 w-full rounded object-cover"
        />
      )}

      {cell.videoUrl && !cell.imageUrl && (
        <div className="truncate text-xs text-gray-500">🎬 {cell.videoUrl}</div>
      )}

      {cell.content && (
        <div
          className={cn(
            'text-base whitespace-pre-wrap text-gray-800 [overflow-wrap:anywhere]',
            getCellTextClassName(cell),
          )}
          style={getCellTextStyle(cell)}
        >
          {cell.content}
        </div>
      )}
    </div>
  );
});
