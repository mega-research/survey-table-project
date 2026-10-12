'use client';

import React from 'react';

import { Minus, Plus } from 'lucide-react';

import { cn } from '@/lib/utils';

export interface StagedRowsButtonsProps {
  addLabel: string;
  canAdd: boolean;
  canRemove: boolean;
  /** 지금 보이는 묶음 행 수 */
  openCount: number;
  /** 묶음 행 수 (열 수 있는 최대) */
  maxCount: number;
  onAdd: () => void;
  onRemove: () => void;
  className?: string | undefined;
}

/**
 * 「행 차례로 열기」의 `+` · `−` · 열린 수 표시 — 데스크톱 표의 버튼 줄과 모바일 항목 카드가
 * 같은 얼굴을 쓴다. `−` 는 처음 보이는 행 수에서는 아예 그리지 않는다(누를 수 없는 버튼을
 * 남기지 않는다).
 */
export const StagedRowsButtons = React.memo(function StagedRowsButtons({
  addLabel,
  canAdd,
  canRemove,
  openCount,
  maxCount,
  onAdd,
  onRemove,
  className,
}: StagedRowsButtonsProps) {
  return (
    <div className={cn('flex flex-wrap items-center gap-2', className)}>
      <button
        type="button"
        onClick={onAdd}
        disabled={!canAdd}
        className="inline-flex items-center gap-1 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
      >
        <Plus className="h-4 w-4" />
        {addLabel}
      </button>
      {canRemove && (
        <button
          type="button"
          onClick={onRemove}
          className="inline-flex items-center gap-1 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-600 transition-colors hover:bg-gray-50"
        >
          <Minus className="h-4 w-4" />
          마지막 줄 삭제
        </button>
      )}
      <span className="text-xs text-gray-500 tabular-nums">
        {openCount}/{maxCount}
      </span>
    </div>
  );
});
