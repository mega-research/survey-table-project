'use client';

import React, { useCallback, useEffect } from 'react';

import { Input } from '@/components/ui/input';
import { useContactAttrs } from '@/lib/survey/contact-attrs-context';
import { substituteTokens } from '@/lib/survey/substitute-tokens';

import type { InteractiveCellProps } from './types';

/** 텍스트 입력 셀 (인터랙티브) */
export const InputCell = React.memo(function InputCell({
  cell,
  cellResponse,
  onUpdateValue,
}: InteractiveCellProps) {
  const attrs = useContactAttrs();
  const template = cell.defaultValueTemplate ?? '';
  const isPrefilled = template.trim().length > 0;
  const prefilledValue = isPrefilled ? substituteTokens(template, attrs) : '';
  const currentValue = (cellResponse as string) || '';
  const textValue = isPrefilled ? prefilledValue : currentValue;

  useEffect(() => {
    if (isPrefilled && currentValue !== prefilledValue) {
      onUpdateValue(prefilledValue);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPrefilled, prefilledValue]);

  const handleChange = useCallback(
    (value: string) => onUpdateValue(value),
    [onUpdateValue],
  );

  return (
    <div className="flex w-full flex-col space-y-1.5">
      {cell.content && cell.content.trim() && (
        <div className="mb-2 text-sm font-medium whitespace-pre-wrap [overflow-wrap:anywhere] text-gray-700">
          {cell.content}
        </div>
      )}

      <Input
        type="text"
        value={textValue}
        onChange={(e) => handleChange(e.target.value)}
        placeholder={cell.placeholder || '답변을 입력하세요...'}
        maxLength={cell.inputMaxLength}
        className="w-full text-base"
        disabled={isPrefilled}
        data-prefilled={isPrefilled || undefined}
      />

      {cell.inputMaxLength && !isPrefilled && (
        <div className="flex justify-end">
          <p className="text-xs text-gray-500">
            <span
              className={
                textValue.length >= cell.inputMaxLength ? 'font-medium text-red-500' : ''
              }
            >
              {textValue.length}
            </span>
            {' / '}
            {cell.inputMaxLength}자
          </p>
        </div>
      )}
    </div>
  );
});
