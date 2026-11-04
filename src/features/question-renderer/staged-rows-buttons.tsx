'use client';

import React from 'react';

import { ArrowRight, Minus, Plus } from 'lucide-react';

import { useInlineSurveyLocale } from '@/features/question-renderer/survey-locale-context';
import { cn } from '@/lib/utils';
import { systemText } from '@/utils/system-strings';

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
  /** `−` 버튼 문구 — 미지정이면 「마지막 줄 삭제」(열 차례로 열기는 「마지막 열 삭제」) */
  removeLabel?: string | undefined;
  /** `+` 버튼 아이콘 — 열 차례로 열기는 오른쪽으로 늘어나는 방향(`arrow-right`)으로 행 추가와 가른다 */
  addIcon?: 'plus' | 'arrow-right' | undefined;
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
  removeLabel,
  addIcon = 'plus',
  className,
}: StagedRowsButtonsProps) {
  const AddIcon = addIcon === 'arrow-right' ? ArrowRight : Plus;
  const locale = useInlineSurveyLocale();
  return (
    <div className={cn('flex flex-wrap items-center gap-2', className)}>
      <button
        type="button"
        onClick={onAdd}
        disabled={!canAdd}
        className="inline-flex items-center gap-1 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
      >
        <AddIcon className="h-4 w-4" aria-hidden="true" />
        {addLabel}
      </button>
      {canRemove && (
        <button
          type="button"
          onClick={onRemove}
          className="inline-flex items-center gap-1 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-600 transition-colors hover:bg-gray-50"
        >
          <Minus className="h-4 w-4" />
          {removeLabel ?? systemText('table.removeLastRow', locale)}
        </button>
      )}
      <span className="text-xs text-gray-500 tabular-nums">
        {openCount}/{maxCount}
      </span>
    </div>
  );
});
