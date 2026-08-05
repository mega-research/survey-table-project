'use client';

import React, { useEffect } from 'react';

import { Input } from '@/components/ui/input';
import { useAnswerQuotes, useContactAttrs } from '@/lib/survey/contact-attrs-context';
import { substituteTokens } from '@/lib/survey/substitute-tokens';
import { useFormattedNumericInput } from '@/hooks/use-formatted-numeric-input';
import { cn } from '@/lib/utils';
import { getInputTextAlignClass } from '@/utils/table-grid-utils';

import { CellContentLayout } from './cell-content-layout';
import type { InteractiveCellProps } from './types';

/** 텍스트 입력 셀 (인터랙티브) */
export const InputCell = React.memo(function InputCell({
  cell,
  cellResponse,
  onUpdateValue,
  inputIdScope,
  ariaInvalid,
  ariaDescribedBy,
  gatingDisabled,
}: InteractiveCellProps) {
  const attrs = useContactAttrs();
  const quotes = useAnswerQuotes();
  const template = cell.defaultValueTemplate ?? '';
  const isPrefilled = template.trim().length > 0;
  // prefill 은 attrs 만 치환한다(quotes 를 넘기지 않는다). 이 결과는 onUpdateValue 로 응답에
  // 저장되는데(questionResponses → response_answers → 엑셀/SPSS export), 응답 인용은
  // "저장되지 않는 파생값"이 불변식이다(lib/survey/answer-quote.ts).
  // 게다가 piiEncrypted 는 질문 단위라 표 셀 답변은 암호화 대상이 아니므로, 인용을 허용하면
  // 암호화 단답형의 원문이 인용값을 타고 평문 셀 답변으로 새는 경로가 열린다.
  // 질문 레벨 prefill(question-input.tsx)·서버 재검증(response.service.ts)도 attrs 기준이다.
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
      !gatingDisabled && // 게이팅 비활성이면 채우지 않는다 — 지움과의 무한 루프 방지
      isNumberMode &&
      typeof cell.emptyDefault === 'number' &&
      cellResponse === undefined
    ) {
      onUpdateValue(String(cell.emptyDefault));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cellResponse, isPrefilled, gatingDisabled, isNumberMode, cell.emptyDefault]);

  return (
    <CellContentLayout
      content={substituteTokens(cell.content, attrs, quotes)}
      position={cell.textPosition}
      bold={cell.textBold}
      textColor={cell.textColor}
    >
      <div className="flex w-full flex-col space-y-1.5">
        <Input
          id={inputIdScope ? `${inputIdScope}-${cell.id}` : undefined}
          type="text"
          inputMode={isNumberMode ? 'decimal' : undefined}
          value={isPrefilled ? prefilledValue : displayValue}
          onChange={handleChange}
          onFocus={handleFocus}
          onBlur={handleBlur}
          placeholder={
            gatingDisabled
              ? '' // 비활성 셀은 안내 문구를 비워 입력 유도로 오독되지 않게 한다
              : cell.placeholder || (isNumberMode ? '숫자만 입력하세요...' : '답변을 입력하세요...')
          }
          maxLength={cell.inputMaxLength}
          className={cn('w-full text-base', getInputTextAlignClass(cell.inputTextAlign))}
          disabled={isPrefilled || gatingDisabled}
          data-prefilled={isPrefilled || undefined}
          aria-invalid={ariaInvalid || undefined}
          aria-describedby={ariaDescribedBy}
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
