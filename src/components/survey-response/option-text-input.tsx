'use client';

import { Input } from '@/components/ui/input';
import { useFormattedNumericInput } from '@/hooks/use-formatted-numeric-input';
import { useInputFormatField } from '@/hooks/use-input-format-field';
import { optionTextTargetId } from '@/lib/survey/option-text-target';
import { cn } from '@/lib/utils';
import { useSurveyResponseStore } from '@/stores/survey-response-store';
import { isInputFormat } from '@/types/input-type';
import type { InputType, NumberFormat } from '@/types/survey';
import { formatSampleValue } from '@/utils/input-format';

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
}: OptionTextInputProps) {
  const optionTexts =
    useSurveyResponseStore((s) => s.optionTexts[questionId]) ?? EMPTY_OPTION_TEXTS;
  const setOptionText = useSurveyResponseStore((s) => s.setOptionText);
  const isNumberMode = option.textInputType === 'number';
  const format = isInputFormat(option.textInputType) ? option.textInputType : null;
  const rawValue = optionTexts[option.id] ?? '';
  // 숫자 모드 — 입력 셀과 같은 타이핑 규칙(숫자만·콤마 표시·max/소수/허용값 차단).
  // 단위 환산·min 미달은 입력칸 아래 한 줄로 보인다 (input-cell·단답형과 같은 모양).
  const numeric = useFormattedNumericInput({
    rawValue,
    onRawChange: (v) => setOptionText(questionId, option.id, v),
    numberFormat: option.textInputNumberFormat,
    enabled: isNumberMode,
  });

  // 형식 모드 — blur 정돈·위반 문구. 숫자 모드와 배타이므로 훅 둘이 동시에 일하지 않는다.
  const formatField = useInputFormatField({
    format,
    rawValue,
    onRawChange: (v) => setOptionText(questionId, option.id, v),
  });

  const sharedProps = {
    'aria-label': ariaLabel,
    // name: DevTools 폼 감사(id/name 필요) 대응. id 는 편집 미리보기+테스트 모드 동시
    // 마운트 시 중복될 수 있어 유일성 제약 없는 name 을 사용. 자유 기입란이라 자동완성 차단.
    name: `option-text-${option.id}`,
    autoComplete: 'off',
    value: isNumberMode ? numeric.displayValue : rawValue,
    onChange: isNumberMode
      ? numeric.handleChange
      : (e: React.ChangeEvent<HTMLInputElement>) =>
          setOptionText(questionId, option.id, e.target.value),
    ...(isNumberMode
      ? {
          inputMode: 'decimal' as const,
          onFocus: numeric.handleFocus,
          onBlur: numeric.handleBlur,
          'aria-invalid': numeric.rangeViolation != null || undefined,
        }
      : {}),
    ...(format
      ? {
          inputMode: formatField.inputMode,
          onFocus: formatField.handleFocus,
          onBlur: formatField.handleBlur,
          'aria-invalid': formatField.violation != null || undefined,
        }
      : {}),
    placeholder:
      option.textInputPlaceholder || (format ? formatSampleValue(format) : DEFAULT_PLACEHOLDER),
    className,
    'data-option-text-target-id': optionTextTargetId(questionId, option.id),
  };

  // 아래 줄 — 값이 있을 때만 만든다. input-cell 과 같은 순서·색(환산은 회색, 위반은 빨강).
  // text-left 를 못 박는다 — 표 셀은 가운데/오른쪽 정렬이 흔해서 그냥 두면 안내 문구가
  // 입력값과 따로 놀며 오른쪽에 붙는다.
  const hint =
    (isNumberMode && (numeric.unitReading || numeric.rangeViolation)) || formatField.violation ? (
      <div className="space-y-0.5 text-left">
        {isNumberMode && numeric.unitReading && (
          <p className="text-muted-foreground text-sm">{numeric.unitReading}</p>
        )}
        {isNumberMode && numeric.rangeViolation && (
          <p className="text-sm text-red-500">* {numeric.rangeViolation}</p>
        )}
        {formatField.violation && <p className="text-sm text-red-500">* {formatField.violation}</p>}
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
        <OptionTextRow label={rowLabel}>
          <input type="text" {...sharedProps} className={OPTION_TEXT_BARE_INPUT_CLS} />
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
  return (
    <div className="w-full space-y-1">
      <Input {...sharedProps} />
      {hint}
    </div>
  );
}
