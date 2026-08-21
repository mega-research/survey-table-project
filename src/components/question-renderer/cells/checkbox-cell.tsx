'use client';

import React, { useCallback, useMemo } from 'react';

import { OptionTextInputStack } from '@/components/question-renderer/option-text-input-stack';
import { useAnswerQuotes, useContactAttrs } from '@/lib/survey/contact-attrs-context';
import { substituteTokens } from '@/lib/survey/substitute-tokens';
import type { CheckboxOption } from '@/types/survey';

import { CellOptionsContainer } from './cell-options-container';
import type { InteractiveCellProps } from './types';

/** 체크박스 셀 (인터랙티브) */
export const CheckboxCell = React.memo(function CheckboxCell({
  cell,
  cellResponse,
  onUpdateValue,
  questionId,
  inputIdScope,
  ariaInvalid,
  ariaDescribedBy,
}: InteractiveCellProps) {
  const attrs = useContactAttrs();
  const quotes = useAnswerQuotes();
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

  const selectionCounter =
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

  // 기타 입력란(1d): 선택한 allowTextInput 옵션의 입력란을 옵션 그리드 아래
  // [옵션 라벨 칩 | 풀폭 입력란] 행으로 선택 순서(cellResponse 배열 순서)대로 쌓는다.
  // 셀 안(footer 슬롯)에 렌더하므로 테이블 그리드/폭에는 영향 없음.
  const textInputEntries = cellResponseArray
    .map((key) =>
      cell.checkboxOptions?.find(
        (option) => option.allowTextInput && (option.value ?? option.id) === key,
      ),
    )
    .filter((option): option is CheckboxOption => Boolean(option))
    .map((option) => ({
      option,
      label: substituteTokens(option.label, attrs, quotes).trim() || '(라벨 없음)',
    }));

  const footer =
    textInputEntries.length > 0 || selectionCounter ? (
      <>
        <OptionTextInputStack questionId={questionId} entries={textInputEntries} />
        {selectionCounter}
      </>
    ) : null;

  return (
    <CellOptionsContainer
      cell={cell}
      content={substituteTokens(cell.content, attrs, quotes)}
      footer={footer}
    >
      {cell.checkboxOptions.map((option) => {
        const optionKey = option.value ?? option.id;
        const isChecked = cellResponseArray.includes(optionKey);
        const disabled = !canSelect(optionKey);
        const inputId = `${inputIdScope ? `${inputIdScope}-${cell.id}` : cell.id}-${option.id}`;

        return (
          // items-start + mt-1: 라벨이 2줄로 감겨도 체크박스가 첫 줄 중앙에 고정 (한 줄일 때 위치 동일)
          <div key={option.id} className="flex items-start gap-2">
            <input
              type="checkbox"
              id={inputId}
              aria-invalid={ariaInvalid || undefined}
              aria-describedby={ariaDescribedBy}
              checked={isChecked}
              disabled={disabled}
              onChange={(e) => handleCheckboxChange(optionKey, e.target.checked)}
              className={`mt-1 h-4 w-4 shrink-0 rounded border-gray-300 text-blue-600 focus:ring-blue-500 ${
                disabled ? 'cursor-not-allowed opacity-50' : ''
              }`}
            />
            <label
              htmlFor={inputId}
              className={`text-base whitespace-pre-line select-none ${
                disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'
              }`}
            >
              {substituteTokens(option.label, attrs, quotes)}
            </label>
          </div>
        );
      })}
    </CellOptionsContainer>
  );
});
