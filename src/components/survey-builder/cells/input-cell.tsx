'use client';

import React, { useEffect } from 'react';

import { Input } from '@/components/ui/input';
import { useContactAttrs } from '@/lib/survey/contact-attrs-context';
import { substituteTokens } from '@/lib/survey/substitute-tokens';
import { useFormattedNumericInput } from '@/hooks/use-formatted-numeric-input';

import { CellContentLayout } from './cell-content-layout';
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

  // 숫자 모드 여부: inputType이 'number'일 때만 활성화
  const isNumberMode = cell.inputType === 'number';

  const { displayValue, handleChange, handleFocus, handleBlur, unitReading, rangeViolation } =
    useFormattedNumericInput({
      rawValue: currentValue,
      onRawChange: onUpdateValue,
      numberFormat: cell.numberFormat,
      enabled: isNumberMode,
    });

  // 숫자 모드 + emptyDefault 정의 + 응답값 아예 미존재(undefined) → 첫 진입 시 초기값 자동 채움.
  // 응답자가 backspace 로 빈 문자열로 만들면 cellResponse 가 '' 가 되어 재채움 되지 않음 (의도 보존).
  useEffect(() => {
    if (
      !isPrefilled &&
      isNumberMode &&
      typeof cell.emptyDefault === 'number' &&
      cellResponse === undefined
    ) {
      onUpdateValue(String(cell.emptyDefault));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cellResponse, isPrefilled, isNumberMode, cell.emptyDefault]);

  return (
    <CellContentLayout content={cell.content} position={cell.textPosition}>
      <div className="flex w-full flex-col space-y-1.5">
        <Input
          type="text"
          inputMode={isNumberMode ? 'decimal' : undefined}
          value={isPrefilled ? prefilledValue : displayValue}
          onChange={handleChange}
          onFocus={handleFocus}
          onBlur={handleBlur}
          placeholder={cell.placeholder || (isNumberMode ? '숫자만 입력하세요...' : '답변을 입력하세요...')}
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

        {(unitReading || rangeViolation) && !isPrefilled && (
          <div className="space-y-0.5">
            {unitReading && <p className="text-xs text-muted-foreground">{unitReading}</p>}
            {rangeViolation && <p className="text-xs text-red-500">* {rangeViolation}</p>}
          </div>
        )}
      </div>
    </CellContentLayout>
  );
});
