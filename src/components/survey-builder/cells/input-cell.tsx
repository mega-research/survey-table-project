'use client';

import React, { useEffect } from 'react';

import { Input } from '@/components/ui/input';
import { useFormattedNumericInput } from '@/hooks/use-formatted-numeric-input';
import { useInputFormatField } from '@/hooks/use-input-format-field';
import { useAnswerQuotes, useContactAttrs } from '@/lib/survey/contact-attrs-context';
import { PRIOR_HIGHLIGHT_TEXT_CLS, isPriorText } from '@/lib/survey/prior-answer-highlight';
import { priorAnswerText } from '@/lib/survey/prior-answers';
import { usePriorAnswers, usePriorHighlight } from '@/lib/survey/prior-answers-context';
import { substituteTokens } from '@/lib/survey/substitute-tokens';
import { cn } from '@/lib/utils';
import { isInputFormat } from '@/types/input-type';
import { formatSampleValue } from '@/utils/input-format';
import { getInputTextAlignClass } from '@/utils/table-grid-utils';

import { CellContentLayout } from './cell-content-layout';
import type { InteractiveCellProps } from './types';

/** 텍스트 입력 셀 (인터랙티브) */
export const InputCell = React.memo(function InputCell({
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
  const template = cell.defaultValueTemplate ?? '';
  const isPrefilled = template.trim().length > 0;
  // prefill 은 attrs 만 치환한다(quotes 를 넘기지 않는다). 이 결과는 onUpdateValue 로 응답에
  // 저장되는데(questionResponses → response_answers → 엑셀/SPSS export), 응답 인용은
  // "저장되지 않는 파생값"이 불변식이다(lib/survey/answer-quote.ts).
  // 게다가 표 셀 답변은 셀에 piiEncrypted 를 켠 경우에만 암호화되므로, 인용을 허용하면
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
  const format = isInputFormat(cell.inputType) ? cell.inputType : null;

  const { displayValue, handleChange, handleFocus, handleBlur, unitReading, rangeViolation } =
    useFormattedNumericInput({
      rawValue: currentValue,
      onRawChange: onUpdateValue,
      numberFormat: cell.numberFormat,
      enabled: isNumberMode,
    });

  // 형식 칸의 blur 정돈·위반 문구. 프리필 잠금 칸은 응답자가 못 고치므로 대상이 아니다.
  const { answers: priorAnswersForFormat } = usePriorAnswers();
  const priorHighlight = usePriorHighlight();
  const formatField = useInputFormatField({
    format,
    rawValue: currentValue,
    onRawChange: onUpdateValue,
    enabled: !isPrefilled,
    priorOriginal: priorAnswerText(priorAnswersForFormat, questionId, cell.id),
  });

  // 숫자 모드 + emptyDefault 정의 + 응답값 아예 미존재(undefined) → 첫 진입 시 초기값 자동 채움.
  // 응답자가 backspace 로 빈 문자열로 만들면 cellResponse 가 '' 가 되어 재채움 되지 않음 (의도 보존).
  useEffect(() => {
    // 게이팅 비활성 셀은 컨테이너(interactive-cell.tsx)가 언마운트로 숨기므로
    // 이 effect 자체가 돌지 않는다 — 지움과의 무한 루프 없음. 활성화(재마운트) 시 재채움.
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
    // relative — 형식·범위 위반 안내문의 절대 위치 기준점.
    <div className="relative w-full">
      <CellContentLayout
        content={substituteTokens(cell.content, attrs, quotes)}
        position={cell.textPosition}
        bold={cell.textBold}
        boldFirstLine={cell.boldFirstLine}
        textColor={cell.textColor}
      >
        <div className="flex w-full flex-col space-y-1.5">
          <Input
            id={inputIdScope ? `${inputIdScope}-${cell.id}` : undefined}
            type="text"
            inputMode={isNumberMode ? 'decimal' : formatField.inputMode}
            value={isPrefilled ? prefilledValue : displayValue}
            onChange={handleChange}
            onFocus={() => {
              handleFocus();
              formatField.handleFocus();
            }}
            onBlur={() => {
              handleBlur();
              formatField.handleBlur();
            }}
            placeholder={
              cell.placeholder ||
              (format
                ? formatSampleValue(format)
                : isNumberMode
                  ? '숫자만 입력하세요...'
                  : '답변을 입력하세요...')
            }
            maxLength={cell.inputMaxLength}
            className={cn(
              'w-full text-base',
              getInputTextAlignClass(cell.inputTextAlign),
              !isPrefilled &&
                isPriorText(priorHighlight, questionId, currentValue, cell.id) &&
                PRIOR_HIGHLIGHT_TEXT_CLS,
            )}
            disabled={isPrefilled}
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

          {unitReading && !isPrefilled && (
            <p className="text-muted-foreground text-xs">{unitReading}</p>
          )}
        </div>
      </CellContentLayout>

      {/*
        위반 안내문은 흐름에서 빼서 셀 위에 띄운다.
        흐름에 두면 이 셀만 키가 커져, 같은 행의 다른 입력 칸과 세로가 어긋나고
        (셀은 justify-center) 옆 라벨도 입력칸 중앙에서 밀려난다 — "2011 년 / 11 월"
        처럼 한 행에 입력 칸이 둘 있으면 눈에 띈다. 띄우면 행 높이가 안 변해 어긋나지
        않는다. 대신 아래 행에 겹치므로 불투명 배경 + z-20 으로 읽히게 만든다.
        범위 위반과 형식 위반은 같은 blur 피드백이라 같은 셸로 그린다 — 흐름에 하나만
        남겨두면 그쪽만 다시 줄을 밀어 어긋남이 되살아난다.
        상시 표시인 단위 읽기는 아래 행에 영구히 겹치면 안 되므로 흐름에 그대로 둔다.
      */}
      {(rangeViolation || formatField.violation) && !isPrefilled && (
        <div className="absolute top-full left-0 z-20 mt-1 w-max space-y-0.5">
          {rangeViolation && (
            <p className="rounded-md border border-red-200 bg-white px-2 py-0.5 text-xs whitespace-nowrap text-red-500 shadow-sm">
              * {rangeViolation}
            </p>
          )}
          {formatField.violation && (
            <p className="rounded-md border border-red-200 bg-white px-2 py-0.5 text-xs whitespace-nowrap text-red-500 shadow-sm">
              * {formatField.violation}
            </p>
          )}
        </div>
      )}
    </div>
  );
});
