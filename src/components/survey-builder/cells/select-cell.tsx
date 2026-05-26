'use client';

import React, { useCallback } from 'react';

import { ChevronDown } from 'lucide-react';

import { OptionTextInput } from '@/components/survey-response/option-text-input';

import { CellContentLayout } from './cell-content-layout';
import type { InteractiveCellProps } from './types';

/** 드롭다운 셀 (인터랙티브) */
export const SelectCell = React.memo(function SelectCell({
  cell,
  cellResponse,
  onUpdateValue,
  questionId,
}: InteractiveCellProps) {
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
  const selectedOption = cell.selectOptions.find(
    (opt) => (opt.value ?? opt.id) === selectedValue,
  );

  return (
    <CellContentLayout content={cell.content} position={cell.textPosition}>
      <div className="flex w-full flex-col space-y-2">
        <div className="relative w-full">
          <select
            value={selectedValue}
            onChange={(e) => handleSelectChange(e.target.value)}
            className="w-full appearance-none truncate rounded border border-gray-300 bg-white py-2 pr-7 pl-2 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none"
          >
            <option value="">선택하세요</option>
            {cell.selectOptions.map((option) => (
              <option key={option.id} value={option.value ?? option.id}>
                {option.label}
              </option>
            ))}
          </select>
          <ChevronDown className="pointer-events-none absolute top-1/2 right-2 h-4 w-4 -translate-y-1/2 text-gray-400" />
        </div>

        {selectedOption?.allowTextInput && (
          <OptionTextInput
            questionId={questionId}
            option={selectedOption}
            className="w-full"
          />
        )}
      </div>
    </CellContentLayout>
  );
});
