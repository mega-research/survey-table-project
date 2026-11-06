'use client';

import React, { useCallback } from 'react';

import { ChevronDown } from 'lucide-react';

import { resolveCellTextHtml } from '@/features/question-renderer/cell-text';
import {
  useAnswerQuotes,
  useContactAttrs,
} from '@/features/question-renderer/contact-attrs-context';
import { OptionTextInput } from '@/features/question-renderer/option-text-input';
import { usePriorHighlight } from '@/features/question-renderer/prior-answers-context';
import {
  PRIOR_HIGHLIGHT_TEXT_CLS,
  isPriorChoice,
  matchesPriorChoice,
} from '@/features/question-renderer/utils/prior-answer-highlight';
import { useInlineSurveyLocale } from '@/features/question-renderer/survey-locale-context';
import { substituteTokens } from '@/lib/survey/substitute-tokens';
import { systemText } from '@/utils/system-strings';

import { CellContentLayout } from './cell-content-layout';
import { useOptionTextMovedBelowTable } from './option-text-placement-context';
import type { InteractiveCellProps } from './types';

/** 드롭다운 셀 (인터랙티브) */
export const SelectCell = React.memo(function SelectCell({
  cell,
  cellResponse,
  onUpdateValue,
  questionId,
  inputIdScope,
  ariaInvalid,
  ariaDescribedBy,
  priorChoiceValue,
  disabledOptionValues,
  hiddenOptionValues,
}: InteractiveCellProps) {
  const attrs = useContactAttrs();
  const quotes = useAnswerQuotes();
  const priorHighlight = usePriorHighlight();
  const textInputBelowTable = useOptionTextMovedBelowTable(cell);
  const locale = useInlineSurveyLocale();
  const handleSelectChange = useCallback(
    (optionId: string) => {
      onUpdateValue(optionId);
    },
    [onUpdateValue],
  );

  if (!cell.selectOptions || cell.selectOptions.length === 0) {
    return (
      <div className="flex items-center gap-2 text-gray-500">
        <span className="text-sm">선택 옵션 없음</span>
      </div>
    );
  }

  const selectedValue = (cellResponse as string) || '';
  // 보기 표시 조건으로 숨은 보기는 목록에서 뺀다 — 고른 보기가 숨으면 셀 컨테이너가 값을 지운다.
  const visibleOptions = hiddenOptionValues?.size
    ? cell.selectOptions.filter((opt) => !hiddenOptionValues.has(opt.value ?? opt.id))
    : cell.selectOptions;
  const selectedOption = cell.selectOptions.find((opt) => (opt.value ?? opt.id) === selectedValue);

  return (
    <CellContentLayout
      content={substituteTokens(cell.content, attrs, quotes)}
      contentHtml={resolveCellTextHtml(cell, attrs, quotes)}
      position={cell.textPosition}
      bold={cell.textBold}
      boldFirstLine={cell.boldFirstLine}
      textColor={cell.textColor}
    >
      <div className="flex w-full flex-col space-y-2">
        <div className="relative w-full">
          <select
            id={inputIdScope ? `${inputIdScope}-${cell.id}` : undefined}
            value={selectedValue}
            aria-invalid={ariaInvalid || undefined}
            aria-describedby={ariaDescribedBy}
            onChange={(e) => handleSelectChange(e.target.value)}
            className={`w-full appearance-none truncate rounded border border-gray-300 bg-white py-2 pr-7 pl-2 text-base focus:ring-2 focus:ring-blue-500 focus:outline-none ${
              (
                priorChoiceValue !== undefined
                  ? matchesPriorChoice(priorChoiceValue, selectedValue)
                  : isPriorChoice(priorHighlight, questionId, selectedValue, cell.id)
              )
                ? PRIOR_HIGHLIGHT_TEXT_CLS
                : ''
            }`}
          >
            <option value="">{systemText('input.selectShort', locale)}</option>
            {visibleOptions.map((option) => (
              <option
                key={option.id}
                value={option.value ?? option.id}
                // 같은 묶음의 다른 칸이 고른 보기 — 목록에 남기고 고를 수만 없게 한다
                disabled={disabledOptionValues?.has(option.value ?? option.id)}
              >
                {substituteTokens(option.label, attrs, quotes)}
              </option>
            ))}
          </select>
          <ChevronDown className="pointer-events-none absolute top-1/2 right-2 h-4 w-4 -translate-y-1/2 text-gray-400" />
        </div>

        {/* 「표 아래에」를 켠 칸은 격자 표가 표 아래 줄로 그린다 */}
        {selectedOption?.allowTextInput && !textInputBelowTable && (
          <OptionTextInput questionId={questionId} option={selectedOption} className="w-full" />
        )}
      </div>
    </CellContentLayout>
  );
});
