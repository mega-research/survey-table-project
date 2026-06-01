'use client';

import React, { useMemo } from 'react';

import { TablePreview } from '@/components/survey-builder/table-preview';
import type { Question, TableCell } from '@/types/survey';
import { resolveChoiceOptions } from '@/utils/choice-source';

import { OptionTextInput } from './option-text-input';

interface ChoiceTableResponseProps {
  question: Question;
  /** radio: string | null, checkbox: string[] */
  value: unknown;
  onChange: (value: string | string[] | null) => void;
}

/**
 * 테이블 내장 radio/checkbox(Case A) 응답 렌더.
 * tableRowsData 의 choice_opt 셀만 인터랙티브 input 으로 바꾸고, 응답은
 * 일반 radio/checkbox shape(radio=cell.id | null, checkbox=cell.id[])로 저장한다.
 */
export function ChoiceTableResponse({ question, value, onChange }: ChoiceTableResponseProps) {
  const isCheckbox = question.type === 'checkbox';
  const options = useMemo(() => resolveChoiceOptions(question), [question]);

  const selectedIds: string[] = useMemo(() => {
    if (isCheckbox) return Array.isArray(value) ? (value as string[]) : [];
    return typeof value === 'string' && value ? [value] : [];
  }, [isCheckbox, value]);

  const maxSelections = question.maxSelections;

  const toggle = (cellId: string, checked: boolean) => {
    if (!isCheckbox) {
      onChange(checked ? cellId : null);
      return;
    }
    let next = selectedIds.slice();
    if (checked) {
      if (maxSelections !== undefined && maxSelections > 0 && next.length >= maxSelections) return;
      next.push(cellId);
    } else {
      next = next.filter((id) => id !== cellId);
    }
    onChange(next);
  };

  const renderCell = (cell: TableCell): React.ReactNode => {
    if (cell.type !== 'choice_opt' || cell.isHidden) return undefined;
    const checked = selectedIds.includes(cell.id);
    const opt = options.find((o) => o.value === cell.id);
    const disabled =
      isCheckbox
      && !checked
      && maxSelections !== undefined
      && maxSelections > 0
      && selectedIds.length >= maxSelections;

    return (
      <div className="flex flex-col items-center gap-2">
        <input
          type={isCheckbox ? 'checkbox' : 'radio'}
          name={question.id}
          aria-label={opt?.label ?? '선택'}
          checked={checked}
          disabled={disabled}
          onChange={(e) => toggle(cell.id, e.target.checked)}
          className="h-4 w-4"
        />
        {opt?.allowTextInput && checked && (
          <OptionTextInput questionId={question.id} option={opt} className="w-full" />
        )}
      </div>
    );
  };

  const minSel = question.minSelections;
  const maxSel = question.maxSelections;
  const showCounter = isCheckbox && (minSel !== undefined || maxSel !== undefined);

  return (
    <div className="space-y-2">
      <TablePreview
        tableTitle={question.tableTitle}
        columns={question.tableColumns}
        rows={question.tableRowsData}
        tableHeaderGrid={question.tableHeaderGrid}
        hideColumnLabels={question.hideColumnLabels}
        renderCell={renderCell}
      />
      {showCounter && (
        <div className="flex items-center justify-end gap-2 text-sm">
          <span className="text-gray-600">
            {maxSel !== undefined && maxSel > 0
              ? `${selectedIds.length}/${maxSel}개 선택됨`
              : `${selectedIds.length}개 선택됨`}
          </span>
          {minSel !== undefined && minSel > 0 && selectedIds.length < minSel && (
            <span className="text-orange-600">최소 {minSel}개 이상 선택해주세요</span>
          )}
        </div>
      )}
    </div>
  );
}
