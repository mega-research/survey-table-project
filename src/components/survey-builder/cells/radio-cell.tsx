'use client';

/* eslint-disable jsx-a11y/role-supports-aria-props -- aria-invalid 전역 상태를 실제 검증 입력에 연결한다. */

import React, { useCallback } from 'react';
import { flushSync } from 'react-dom';

import { OptionTextInput } from '@/components/survey-response/option-text-input';
import { useAnswerQuotes, useContactAttrs } from '@/lib/survey/contact-attrs-context';
import { substituteTokens } from '@/lib/survey/substitute-tokens';

import { CellOptionsContainer } from './cell-options-container';
import type { InteractiveCellProps } from './types';

/** 라디오 셀 (인터랙티브) */
export const RadioCell = React.memo(function RadioCell({
  cell,
  cellResponse,
  onUpdateValue,
  questionId,
  groupName,
  inputIdScope,
  ariaInvalid,
  ariaDescribedBy,
}: InteractiveCellProps) {
  const attrs = useContactAttrs();
  const quotes = useAnswerQuotes();
  const handleRadioChange = useCallback(
    (optionId: string) => {
      const isCurrentlySelected = cellResponse === optionId;

      if (isCurrentlySelected) {
        flushSync(() => onUpdateValue(''));
        return;
      }

      flushSync(() => onUpdateValue(optionId));
    },
    [cellResponse, onUpdateValue],
  );

  if (!cell.radioOptions || cell.radioOptions.length === 0) {
    return (
      <div className="flex items-center gap-2 text-gray-500">
        <span className="text-sm">라디오 버튼 없음</span>
      </div>
    );
  }

  return (
    <CellOptionsContainer cell={cell}>
      {cell.radioOptions.map((option) => {
        const optionKey = option.value ?? option.id;
        const isSelected = cellResponse === optionKey;
        const inputId = `${inputIdScope ? `${inputIdScope}-${cell.id}` : cell.id}-${option.id}`;

        return (
          <div key={option.id} className="space-y-2">
            {/* items-start + mt-1: 라벨이 2줄로 감겨도 라디오가 첫 줄 중앙에 고정 (한 줄일 때 위치 동일) */}
            <div className="flex items-start gap-2">
              <input
                type="radio"
                id={inputId}
                name={groupName ?? `${cell.id}-radio`}
                aria-invalid={ariaInvalid || undefined}
                aria-describedby={ariaDescribedBy}
                checked={isSelected}
                onChange={() => {}}
                onClick={() => handleRadioChange(optionKey)}
                className="mt-1 h-4 w-4 shrink-0 cursor-pointer border-gray-300 text-blue-600 focus:ring-blue-500"
              />
              <label
                htmlFor={inputId}
                className="cursor-pointer text-base whitespace-pre-line select-none"
              >
                {substituteTokens(option.label, attrs, quotes)}
              </label>
            </div>
            {option.allowTextInput && isSelected && (
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
