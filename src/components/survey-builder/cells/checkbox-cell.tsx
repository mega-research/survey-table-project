'use client';

import React, { useCallback, useMemo } from 'react';

import { OptionTextInput } from '@/components/survey-response/option-text-input';

import { CellOptionsContainer } from './cell-options-container';
import type { InteractiveCellProps } from './types';

/** 체크박스 셀 (인터랙티브) */
export const CheckboxCell = React.memo(function CheckboxCell({
  cell,
  cellResponse,
  onUpdateValue,
  questionId,
}: InteractiveCellProps) {
  const cellResponseArray = useMemo(
    () => (Array.isArray(cellResponse) ? cellResponse : []),
    [cellResponse],
  );
  const currentCount = cellResponseArray.length;
  const { maxSelections, minSelections } = cell;
  const isMaxReached =
    maxSelections !== undefined && maxSelections > 0 && currentCount >= maxSelections;
  const isMinNotMet =
    minSelections !== undefined && minSelections > 0 && currentCount < minSelections;

  const canSelect = useCallback(
    (optionKey: string) => {
      const isChecked = cellResponseArray.includes(optionKey);
      return isChecked || !isMaxReached;
    },
    [cellResponseArray, isMaxReached],
  );

  const handleCheckboxChange = useCallback(
    (optionId: string, checked: boolean) => {
      const current = (Array.isArray(cellResponse) ? cellResponse : []) as string[];
      let updated: string[];

      if (checked) {
        if (maxSelections !== undefined && maxSelections > 0 && current.length >= maxSelections) return;
        updated = [...current, optionId];
      } else {
        updated = current.filter((item) => item !== optionId);
      }
      onUpdateValue(updated);
    },
    [cellResponse, maxSelections, onUpdateValue],
  );

  if (!cell.checkboxOptions || cell.checkboxOptions.length === 0) {
    return (
      <div className="flex items-center gap-2 text-gray-500">
        <span className="text-sm">체크박스 없음</span>
      </div>
    );
  }

  const footer =
    maxSelections !== undefined || minSelections !== undefined ? (
      <div className="mt-2 border-t border-gray-200 pt-2">
        <div className="flex items-center justify-between text-xs">
          <span className="text-gray-600">
            {maxSelections !== undefined && maxSelections > 0
              ? `${currentCount}/${maxSelections}개 선택됨`
              : `${currentCount}개 선택됨`}
          </span>
          {isMinNotMet && <span className="text-orange-600">최소 {minSelections}개 이상</span>}
          {isMaxReached && <span className="text-blue-600">최대 도달</span>}
        </div>
      </div>
    ) : null;

  return (
    <CellOptionsContainer cell={cell} footer={footer}>
      {cell.checkboxOptions.map((option) => {
        const optionKey = option.value ?? option.id;
        const isChecked = cellResponseArray.includes(optionKey);
        const disabled = !canSelect(optionKey);

        return (
          <div key={option.id} className="space-y-2">
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id={`${cell.id}-${option.id}`}
                checked={isChecked}
                disabled={disabled}
                onChange={(e) => handleCheckboxChange(optionKey, e.target.checked)}
                className={`rounded border-gray-300 text-blue-600 focus:ring-blue-500 ${
                  disabled ? 'cursor-not-allowed opacity-50' : ''
                }`}
              />
              <label
                htmlFor={`${cell.id}-${option.id}`}
                className={`text-base select-none ${
                  disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'
                }`}
              >
                {option.label}
              </label>
            </div>
            {option.allowTextInput && isChecked && (
              <div className="pl-6">
                <OptionTextInput
                  questionId={questionId}
                  option={option}
                />
              </div>
            )}
          </div>
        );
      })}
    </CellOptionsContainer>
  );
});
