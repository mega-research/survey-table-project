'use client';

import React, { useEffect, useEffectEvent, useRef } from 'react';

import { Input } from '@/components/ui/input';
import { resolveCellTextHtml } from '@/features/question-renderer/cell-text';
import {
  useAnswerQuotes,
  useContactAttrs,
} from '@/features/question-renderer/contact-attrs-context';
import { useFieldFocus } from '@/features/question-renderer/hooks/use-field-focus';
import { useInputFormatField } from '@/features/question-renderer/hooks/use-input-format-field';
import { useResponseSources } from '@/features/question-renderer/response-sources';
import {
  getHorizontalItemsClass,
  getInputTextAlignClass,
} from '@/features/question-renderer/utils/table-grid-utils';
import { useFormattedNumericInput } from '@/hooks/use-formatted-numeric-input';
import { resolveCellTextQualityViolation } from '@/features/question-renderer/utils/cell-text-quality';
import { PRIOR_HIGHLIGHT_TEXT_CLS, isPriorText } from '@/lib/survey/prior-answer-highlight';
import { priorAnswerText } from '@/lib/survey/prior-answers';
import { usePriorAnswers, usePriorHighlight } from '@/lib/survey/prior-answers-context';
import { substituteTokens } from '@/lib/survey/substitute-tokens';
import { cn } from '@/lib/utils';
import { isInputFormat } from '@/types/input-type';
import { formatSampleValue } from '@/features/question-renderer/utils/input-format';

import { CellContentLayout } from './cell-content-layout';
import { FloatingHint } from './floating-hint';
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
  hintInFlow,
  ignoreInputWidth,
}: InteractiveCellProps) {
  const attrs = useContactAttrs();
  const quotes = useAnswerQuotes();
  // prefill·빈값 기본치는 응답자의 입력이 아니다 — 쓰기 직전에 호스트에게 알린다.
  const { markSeedWrite } = useResponseSources();
  const template = cell.defaultValueTemplate ?? '';
  const isPrefilled = template.trim().length > 0;
  // prefill 은 attrs 만 치환한다(quotes 를 넘기지 않는다). 이 결과는 onUpdateValue 로 응답에
  // 저장되는데(questionResponses → response_answers → 엑셀/SPSS export), 응답 인용은
  // "저장되지 않는 파생값"이 불변식이다(utils/answer-quote.ts).
  // 게다가 표 셀 답변은 셀에 piiEncrypted 를 켠 경우에만 암호화되므로, 인용을 허용하면
  // 암호화 단답형의 원문이 인용값을 타고 평문 셀 답변으로 새는 경로가 열린다.
  // 질문 레벨 prefill(question-input.tsx)·서버 재검증(response.service.ts)도 attrs 기준이다.
  const prefilledValue = isPrefilled ? substituteTokens(template, attrs) : '';
  const currentValue = (cellResponse as string) || '';
  const textValue = isPrefilled ? prefilledValue : currentValue;

  // prefill 결과가 바뀔 때만 저장값을 덮어쓴다. currentValue/onUpdateValue 는 effect event 로
  // 실행 시점의 최신값을 읽는다 — deps 에 넣으면 스토어 정규화로 값이 어긋나는 경우 매 렌더
  // 재기록 루프가 생기고, onUpdateValue 는 셀별로 생성되어 identity 가 불안정하다.
  const applyPrefill = useEffectEvent(() => {
    if (isPrefilled && currentValue !== prefilledValue) {
      markSeedWrite?.(questionId);
      onUpdateValue(prefilledValue);
    }
  });
  useEffect(() => {
    applyPrefill();
  }, [isPrefilled, prefilledValue]);

  // 숫자 모드 여부: inputType이 'number'일 때만 활성화
  const isNumberMode = cell.inputType === 'number';
  const format = isInputFormat(cell.inputType) ? cell.inputType : null;
  /**
   * 여러 줄 입력. 숫자·형식과는 배타다 — 전화번호나 계산 대상 숫자에 줄바꿈이 들어갈
   * 자리가 없고, 숫자 서식·형식 정돈 훅이 한 줄 값을 전제로 서 있다.
   */
  const rows = !isNumberMode && !format ? Math.floor(cell.inputRows ?? 1) : 1;
  const isMultiline = rows >= 2;

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
  const applyEmptyDefault = useEffectEvent(() => {
    // 게이팅 비활성 셀은 컨테이너(interactive-cell.tsx)가 언마운트로 숨기므로
    // 이 effect 자체가 돌지 않는다 — 지움과의 무한 루프 없음. 활성화(재마운트) 시 재채움.
    if (
      !isPrefilled &&
      isNumberMode &&
      typeof cell.emptyDefault === 'number' &&
      cellResponse === undefined
    ) {
      markSeedWrite?.(questionId);
      onUpdateValue(String(cell.emptyDefault));
    }
  });
  useEffect(() => {
    applyEmptyDefault();
  }, [cellResponse, isPrefilled, isNumberMode, cell.emptyDefault]);

  // 응답 품질 위반 — 평문 모드·prefill·이월 면제 판정은 검증 쪽 함수가 쥔다(표·보기 표 공용)
  // 문구는 포커스가 빠진 뒤에만 — 한글 조합 중 첫 자모에 반응하지 않게(형식 검사와 같은 규칙)
  const focus = useFieldFocus();
  const qualityViolation = focus.focused
    ? null
    : resolveCellTextQualityViolation(
        cell,
        currentValue,
        priorAnswerText(priorAnswersForFormat, questionId, cell.id),
      );
  const hasViolation =
    Boolean(rangeViolation || formatField.violation || qualityViolation) && !isPrefilled;
  // 띄우는 안내의 앵커 — 입력칸 자체. 셀이 아니라 입력칸 아래에 붙어야 단위 글자 옆에서도 맞는다.
  const anchorRef = useRef<HTMLElement | null>(null);

  // 입력칸 너비 고정 — 세로 카드(ignoreInputWidth)는 무시한다. 좁은 화면에서 60px 입력칸은 불편하다.
  const fixedWidth =
    !ignoreInputWidth && typeof cell.inputWidth === 'number' && cell.inputWidth > 0
      ? cell.inputWidth
      : undefined;
  const fixedWidthStyle =
    fixedWidth !== undefined ? { width: `${fixedWidth}px`, maxWidth: '100%' } : undefined;

  return (
    // 위반 안내는 body 포털이라 여기에 위치 기준점은 없다 — relative 는 다른 오버레이용으로 남긴다.
    <div className="relative w-full">
      <CellContentLayout
        content={substituteTokens(cell.content, attrs, quotes)}
        contentHtml={resolveCellTextHtml(cell, attrs, quotes)}
        position={cell.textPosition}
        bold={cell.textBold}
        boldFirstLine={cell.boldFirstLine}
        textColor={cell.textColor}
        fillWidth={fixedWidth === undefined}
        horizontalAlign={cell.horizontalAlign}
      >
        <div
          className={cn(
            'flex w-full flex-col space-y-1.5',
            // 너비를 고정한 입력칸은 셀의 가로 정렬을 따른다(기본 왼쪽)
            fixedWidth !== undefined && getHorizontalItemsClass(cell.horizontalAlign),
          )}
        >
          {isMultiline ? (
            <textarea
              ref={anchorRef as React.RefObject<HTMLTextAreaElement>}
              id={inputIdScope ? `${inputIdScope}-${cell.id}` : undefined}
              rows={rows}
              value={textValue}
              onChange={(e) => onUpdateValue(e.target.value)}
              onFocus={focus.onFocus}
              onBlur={focus.onBlur}
              placeholder={cell.placeholder || '답변을 입력하세요...'}
              maxLength={cell.inputMaxLength}
              disabled={isPrefilled}
              data-prefilled={isPrefilled || undefined}
              aria-invalid={ariaInvalid || undefined}
              aria-describedby={ariaDescribedBy}
              style={fixedWidthStyle}
              className={cn(
                'w-full resize-none rounded-md border border-gray-300 p-2 text-base',
                'focus:border-blue-500 focus:ring-2 focus:ring-blue-500 focus:outline-none',
                getInputTextAlignClass(cell.inputTextAlign),
                !isPrefilled &&
                  isPriorText(priorHighlight, questionId, currentValue, cell.id) &&
                  PRIOR_HIGHLIGHT_TEXT_CLS,
              )}
            />
          ) : (
            <Input
              ref={anchorRef as React.RefObject<HTMLInputElement>}
              id={inputIdScope ? `${inputIdScope}-${cell.id}` : undefined}
              type="text"
              inputMode={isNumberMode ? 'decimal' : formatField.inputMode}
              value={isPrefilled ? prefilledValue : displayValue}
              onChange={format ? formatField.handleChange : handleChange}
              onFocus={() => {
                handleFocus();
                formatField.handleFocus();
                focus.onFocus();
              }}
              onBlur={() => {
                handleBlur();
                formatField.handleBlur();
                focus.onBlur();
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
              style={fixedWidthStyle}
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
          )}

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

          {/* 카드 모드 — 위반 안내를 흐름에 둔다. 카드는 셀이 세로로 쌓여 옆 칸이 없고
              overflow-hidden 이라 아래 띄우면 잘리거나(마지막 셀) 다음 셀 라벨을 덮는다. */}
          {hintInFlow && hasViolation && (
            <div className="space-y-0.5 text-left">
              {rangeViolation && <p className="text-xs text-red-500">* {rangeViolation}</p>}
              {formatField.violation && (
                <p className="text-xs text-red-500">* {formatField.violation}</p>
              )}
              {qualityViolation && (
                <p className="text-xs text-red-500" data-testid="cell-text-quality-violation">
                  * {qualityViolation.message}
                </p>
              )}
            </div>
          )}
        </div>
      </CellContentLayout>

      {/*
        위반 안내문은 흐름에서 빼서 입력칸 아래에 띄운다.
        흐름에 두면 이 셀만 키가 커져, 같은 행의 다른 입력 칸과 세로가 어긋나고
        (셀은 justify-center) 옆 라벨도 입력칸 중앙에서 밀려난다 — "2011 년 / 11 월"
        처럼 한 행에 입력 칸이 둘 있으면 눈에 띈다. 띄우면 행 높이가 안 변해 어긋나지
        않는다. 셀 안 absolute 가 아니라 body 포털(FloatingHint)인 이유는 그 파일에 —
        표 스크롤 컨테이너가 마지막 행의 안내를 잘라 스크롤바를 만들었다.
        범위 위반과 형식 위반은 같은 blur 피드백이라 같은 셸로 그린다 — 흐름에 하나만
        남겨두면 그쪽만 다시 줄을 밀어 어긋남이 되살아난다.
        상시 표시인 단위 읽기는 아래 행에 영구히 겹치면 안 되므로 흐름에 그대로 둔다.
      */}
      {!hintInFlow && hasViolation && (
        <FloatingHint anchorRef={anchorRef}>
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
          {qualityViolation && (
            <p
              className="rounded-md border border-red-200 bg-white px-2 py-0.5 text-xs whitespace-nowrap text-red-500 shadow-sm"
              data-testid="cell-text-quality-violation"
            >
              * {qualityViolation.message}
            </p>
          )}
        </FloatingHint>
      )}
    </div>
  );
});
