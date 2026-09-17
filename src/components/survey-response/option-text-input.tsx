'use client';

import { useRef } from 'react';

import { Input } from '@/components/ui/input';
import { useAutoGrowTextarea } from '@/hooks/use-auto-grow-textarea';
import { useFieldFocus } from '@/hooks/use-field-focus';
import { useFormattedNumericInput } from '@/hooks/use-formatted-numeric-input';
import { useInputFormatField } from '@/hooks/use-input-format-field';
import { resolveCellTextQualityViolation } from '@/lib/survey/numeric-validation';
import { optionTextTargetId } from '@/lib/survey/option-text-target';
import {
  PRIOR_HIGHLIGHT_TEXT_CLS,
  isPriorOptionTextValue,
} from '@/lib/survey/prior-answer-highlight';
import { priorOptionText } from '@/lib/survey/prior-answers';
import { usePriorAnswers, usePriorHighlight } from '@/lib/survey/prior-answers-context';
import { cn } from '@/lib/utils';
import { useSurveyResponseStore } from '@/stores/survey-response-store';
import { isInputFormat } from '@/types/input-type';
import type { InputType, NumberFormat, TextValidation } from '@/types/survey';
import { formatSampleValue } from '@/utils/input-format';
import { getHorizontalItemsClass } from '@/utils/table-grid-utils';

import { OPTION_TEXT_BARE_INPUT_CLS, OptionTextRow } from './option-text-row';

// useSyncExternalStore 안정 참조 — selector 내부 `?? {}` 사용 시 무한 루프 경고 회피
const EMPTY_OPTION_TEXTS: Record<string, string> = {};

const DEFAULT_PLACEHOLDER = '상세 기재';

interface OptionTextInputProps {
  questionId: string;
  option: {
    id: string;
    textInputPlaceholder?: string | undefined;
    /** 'number' 면 입력 셀과 같은 숫자 타이핑 규칙 적용 */
    textInputType?: InputType | undefined;
    textInputNumberFormat?: NumberFormat | undefined;
    /** 표 input 셀의 응답 품질 검사 — 보기 상세기재에는 아직 없다 */
    textValidation?: TextValidation | null | undefined;
    defaultValueTemplate?: string | undefined;
    /**
     * 여러 줄 입력 — 표 input 셀의 inputRows·inputAutoGrow 를 그대로 받는다. 평문 모드의
     * 기본 렌더에서만 textarea 로 그리고, 숫자·형식·칩 셸·unstyled 모드는 한 줄 그대로다.
     */
    textInputRows?: number | undefined;
    textInputAutoGrow?: boolean | undefined;
  };
  className?: string;
  /** 시각 라벨이 별도 요소(라벨 칩 등)로 렌더될 때 입력란과의 접근성 연결용 */
  ariaLabel?: string | undefined;
  /**
   * ui Input 베이스 클래스 없이 맨몸 <input> 렌더. 스타일드 컨테이너(라벨 스택 등)
   * 안에 넣을 때 베이스 보더/포커스 링이 이중으로 겹치는 것을 원천 차단한다.
   */
  unstyled?: boolean | undefined;
  /**
   * 칩 셸(OptionTextRow)까지 이 컴포넌트가 그린다. 문구를 주면 그 모드다.
   *
   * 셸을 밖에서 두르면 숫자 안내(단위 환산·범위 위반)를 셸 **밖**에 놓을 방법이 없다.
   * 안내를 따로 계산하려면 useFormattedNumericInput 을 한 번 더 불러야 하는데, 그러면
   * 포커스 상태가 갈라져 "타이핑 중에는 범위 경고를 숨긴다" 규칙이 깨진다. 훅을 하나로
   * 두려면 셸과 안내가 같은 컴포넌트 안에 있어야 한다.
   */
  rowLabel?: string | undefined;
  /** rowLabel 모드에서 칩을 입력칸 위에 쌓는다(OptionTextRow stacked). */
  stackedLabel?: boolean | undefined;
  /**
   * 입력칸 너비 고정(px) — 레거시 보기 소스 표의 input 셀(TableCell.inputWidth)용. 기본 모드에서만
   * 쓰고, 지정하면 입력칸이 셀 폭을 채우지 않고 horizontalAlign 을 따라 놓인다.
   */
  fixedWidth?: number | undefined;
  horizontalAlign?: 'left' | 'center' | 'right' | undefined;
}

/**
 * allowTextInput 옵션의 사이드카 텍스트 입력칸.
 * useSurveyResponseStore.optionTexts[questionId][option.id] 에 저장.
 * 응답 페이지 / 빌더 테스트 모드 / 테이블 셀 공통 사용.
 */
export function OptionTextInput({
  questionId,
  option,
  className,
  ariaLabel,
  unstyled,
  rowLabel,
  stackedLabel,
  fixedWidth,
  horizontalAlign,
}: OptionTextInputProps) {
  const optionTexts =
    useSurveyResponseStore((s) => s.optionTexts[questionId]) ?? EMPTY_OPTION_TEXTS;
  const setOptionText = useSurveyResponseStore((s) => s.setOptionText);
  const isNumberMode = option.textInputType === 'number';
  const format = isInputFormat(option.textInputType) ? option.textInputType : null;
  const rawValue = optionTexts[option.id] ?? '';
  // 여러 줄 — input-cell 과 같은 규칙(숫자·형식과 배타, 높이 늘리기를 켜면 줄 수는 최소 높이)
  const isFreeText = !isNumberMode && !format;
  const textareaRows = isFreeText ? Math.max(1, Math.floor(option.textInputRows ?? 1)) : 1;
  const autoGrow = isFreeText && option.textInputAutoGrow === true;
  const isMultiline = rowLabel === undefined && !unstyled && (textareaRows >= 2 || autoGrow);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  useAutoGrowTextarea(textareaRef, rawValue, isMultiline && autoGrow);
  // 숫자 모드 — 입력 셀과 같은 타이핑 규칙(숫자만·콤마 표시·max/소수/허용값 차단).
  // 단위 환산·min 미달은 입력칸 아래 한 줄로 보인다 (input-cell·단답형과 같은 모양).
  const numeric = useFormattedNumericInput({
    rawValue,
    onRawChange: (v) => setOptionText(questionId, option.id, v),
    numberFormat: option.textInputNumberFormat,
    enabled: isNumberMode,
  });

  // 형식 모드 — blur 정돈·위반 문구. 숫자 모드와 배타이므로 훅 둘이 동시에 일하지 않는다.
  const { answers: priorAnswersForFormat } = usePriorAnswers();
  const priorHighlight = usePriorHighlight();
  // 상세기재도 값 조각이다 — 보기 선택은 그대로 두고 텍스트만 고친 칸을 가려내려면
  // 문항이 아니라 보기 단위로 판정해야 한다.
  const priorTextCls = isPriorOptionTextValue(priorHighlight, questionId, option.id, rawValue)
    ? PRIOR_HIGHLIGHT_TEXT_CLS
    : undefined;
  const formatField = useInputFormatField({
    format,
    rawValue,
    onRawChange: (v) => setOptionText(questionId, option.id, v),
    priorOriginal: priorOptionText(priorAnswersForFormat, questionId, option.id),
  });
  // 응답 품질 위반(표 input 셀 전용) — 평문 모드·이월 면제 판정은 검증 쪽 함수가 쥔다
  // 문구는 포커스가 빠진 뒤에만 — 한글 조합 중 첫 자모에 반응하지 않게(형식 검사와 같은 규칙)
  const focus = useFieldFocus();
  const qualityViolation = focus.focused
    ? null
    : resolveCellTextQualityViolation(
        {
          inputType: option.textInputType,
          defaultValueTemplate: option.defaultValueTemplate,
          textValidation: option.textValidation,
        },
        rawValue,
        priorOptionText(priorAnswersForFormat, questionId, option.id),
      );

  const sharedProps = {
    'aria-label': ariaLabel,
    // name: DevTools 폼 감사(id/name 필요) 대응. id 는 편집 미리보기+테스트 모드 동시
    // 마운트 시 중복될 수 있어 유일성 제약 없는 name 을 사용. 자유 기입란이라 자동완성 차단.
    name: `option-text-${option.id}`,
    autoComplete: 'off',
    value: isNumberMode ? numeric.displayValue : rawValue,
    onChange: isNumberMode
      ? numeric.handleChange
      : format
        ? formatField.handleChange
        : (e: React.ChangeEvent<HTMLInputElement>) =>
            setOptionText(questionId, option.id, e.target.value),
    ...(isNumberMode
      ? {
          inputMode: 'decimal' as const,
          'aria-invalid': numeric.rangeViolation != null || undefined,
        }
      : {}),
    ...(format
      ? {
          inputMode: formatField.inputMode,
          'aria-invalid': formatField.violation != null || undefined,
        }
      : {}),
    // 모드별 포커스 처리(숫자 힌트·형식 정돈)에 품질 문구용 포커스 추적을 얹는다
    onFocus: () => {
      if (isNumberMode) numeric.handleFocus();
      if (format) formatField.handleFocus();
      focus.onFocus();
    },
    onBlur: () => {
      if (isNumberMode) numeric.handleBlur();
      if (format) formatField.handleBlur();
      focus.onBlur();
    },
    placeholder:
      option.textInputPlaceholder || (format ? formatSampleValue(format) : DEFAULT_PLACEHOLDER),
    className: cn(className, priorTextCls),
    'data-option-text-target-id': optionTextTargetId(questionId, option.id),
  };

  // 아래 줄 — 값이 있을 때만 만든다. input-cell 과 같은 순서·색(환산은 회색, 위반은 빨강).
  // text-left 를 못 박는다 — 표 셀은 가운데/오른쪽 정렬이 흔해서 그냥 두면 안내 문구가
  // 입력값과 따로 놀며 오른쪽에 붙는다.
  const hint =
    (isNumberMode && (numeric.unitReading || numeric.rangeViolation)) ||
    formatField.violation ||
    qualityViolation ? (
      <div className="space-y-0.5 text-left">
        {isNumberMode && numeric.unitReading && (
          <p className="text-muted-foreground text-sm">{numeric.unitReading}</p>
        )}
        {isNumberMode && numeric.rangeViolation && (
          <p className="text-sm text-red-500">* {numeric.rangeViolation}</p>
        )}
        {formatField.violation && <p className="text-sm text-red-500">* {formatField.violation}</p>}
        {qualityViolation && (
          <p className="text-sm text-red-500" data-testid="cell-text-quality-violation">
            * {qualityViolation.message}
          </p>
        )}
      </div>
    ) : null;

  // 래퍼는 **힌트 유무와 무관하게 항상** 렌더한다. 조건부로 감싸면 첫 글자에 힌트가 생기는
  // 순간 input 이 트리에서 자리를 옮겨 React 가 DOM 노드를 새로 만들고, 그때 포커스가 날아가
  // 뒤 글자가 입력되지 않는다 (실제로 겪었다).
  // 셸을 직접 그리는 모드 — 안내는 셸 **밖**, 셀 안에 놓인다. 좁은 입력칸 안에 끼워 넣으면
  // 글자를 줄일 수밖에 없어 읽히지 않는다.
  if (rowLabel !== undefined) {
    return (
      <div className="w-full space-y-1">
        <OptionTextRow label={rowLabel} stacked={stackedLabel}>
          <input
            type="text"
            {...sharedProps}
            className={cn(
              OPTION_TEXT_BARE_INPUT_CLS,
              // 칩을 위에 쌓는 자리(모바일 카드 · 상세 기재 자리 셀)에서는 입력칸이 한 줄 높이라
              // 짚기 어렵고, 회색 배경만으로는 위의 회색 칩과 구분되지 않아 "칩이 둘"로 읽힌다 —
              // 흰 바탕에 테두리를 둘러 입력칸으로 보이게 하고 높이·글자 크기를 키운다.
              // flex-none 이 핵심이다 — 셸이 세로 flex 라 기본 클래스의 flex-1(basis 0)이
              // 세로 축에 걸리면 h-* 가 무시되고 입력칸이 한 줄 내용 높이로 쪼그라든다
              // (h-12 로 두고도 작아 보이던 원인). 높이는 h-10 — 실제 적용되면 그 정도가 알맞다.
              stackedLabel &&
                'h-10 flex-none rounded-md border border-gray-300 bg-white px-3 text-base focus:border-blue-400',
              priorTextCls,
            )}
          />
        </OptionTextRow>
        {hint}
      </div>
    );
  }
  if (unstyled) {
    return (
      // 밖에서 두른 셸 안에 들어가는 경우 — 안내를 셸 밖에 놓을 수 없어 아래에 붙인다.
      <div className={cn('flex min-w-0 flex-1 flex-col justify-center')}>
        <input type="text" {...sharedProps} />
        {hint}
      </div>
    );
  }
  // w-full 필수 — 표 셀은 `flex flex-col items-start` 라 래퍼가 내용 폭으로 쪼그라든다.
  // 래퍼가 생기기 전에는 Input 이 직접 자식이라 호출부의 className="w-full" 이 먹었다.
  const hasFixedWidth = typeof fixedWidth === 'number' && fixedWidth > 0;
  const fixedWidthStyle = hasFixedWidth
    ? { width: `${fixedWidth}px`, maxWidth: '100%' }
    : undefined;
  if (isMultiline) {
    return (
      <div
        className={cn(
          'w-full space-y-1',
          hasFixedWidth && cn('flex flex-col', getHorizontalItemsClass(horizontalAlign)),
        )}
      >
        <textarea
          ref={textareaRef}
          rows={textareaRows}
          aria-label={sharedProps['aria-label']}
          name={sharedProps.name}
          autoComplete="off"
          value={rawValue}
          onChange={(e) => setOptionText(questionId, option.id, e.target.value)}
          onFocus={focus.onFocus}
          onBlur={focus.onBlur}
          placeholder={sharedProps.placeholder}
          data-option-text-target-id={sharedProps['data-option-text-target-id']}
          style={fixedWidthStyle}
          className={cn(
            'w-full resize-none rounded-md border border-gray-300 bg-white p-2 text-base',
            'focus:border-blue-500 focus:ring-2 focus:ring-blue-500 focus:outline-none',
            // 높이를 내용에 맞추므로 안쪽 스크롤바가 생기지 않게 한다
            autoGrow && 'overflow-hidden',
            className,
            priorTextCls,
          )}
        />
        {hint}
      </div>
    );
  }
  return (
    <div
      className={cn(
        'w-full space-y-1',
        hasFixedWidth && cn('flex flex-col', getHorizontalItemsClass(horizontalAlign)),
      )}
    >
      <Input {...sharedProps} style={fixedWidthStyle} />
      {hint}
    </div>
  );
}
