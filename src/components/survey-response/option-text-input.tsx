'use client';

import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { useFormattedNumericInput } from '@/hooks/use-formatted-numeric-input';
import type { NumberFormat } from '@/types/survey';
import { optionTextTargetId } from '@/lib/survey/option-text-target';
import { useSurveyResponseStore } from '@/stores/survey-response-store';

// useSyncExternalStore 안정 참조 — selector 내부 `?? {}` 사용 시 무한 루프 경고 회피
const EMPTY_OPTION_TEXTS: Record<string, string> = {};

const DEFAULT_PLACEHOLDER = '상세 기재';

interface OptionTextInputProps {
  questionId: string;
  option: {
    id: string;
    textInputPlaceholder?: string | undefined;
    /** 'number' 면 입력 셀과 같은 숫자 타이핑 규칙 적용 */
    textInputType?: 'text' | 'number' | undefined;
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
}: OptionTextInputProps) {
  const optionTexts =
    useSurveyResponseStore((s) => s.optionTexts[questionId]) ?? EMPTY_OPTION_TEXTS;
  const setOptionText = useSurveyResponseStore((s) => s.setOptionText);
  const isNumberMode = option.textInputType === 'number';
  const rawValue = optionTexts[option.id] ?? '';
  // 숫자 모드 — 입력 셀과 같은 타이핑 규칙(숫자만·콤마 표시·max/소수/허용값 차단).
  // 단위 환산·min 미달은 입력칸 아래 한 줄로 보인다 (input-cell·단답형과 같은 모양).
  const numeric = useFormattedNumericInput({
    rawValue,
    onRawChange: (v) => setOptionText(questionId, option.id, v),
    numberFormat: option.textInputNumberFormat,
    enabled: isNumberMode,
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
    placeholder: option.textInputPlaceholder || DEFAULT_PLACEHOLDER,
    className,
    'data-option-text-target-id': optionTextTargetId(questionId, option.id),
  };

  // 아래 줄 — 값이 있을 때만 만든다. input-cell 과 같은 순서·색(환산은 회색, 위반은 빨강).
  // text-left 를 못 박는다 — 표 셀은 가운데/오른쪽 정렬이 흔해서 그냥 두면 안내 문구가
  // 입력값과 따로 놀며 오른쪽에 붙는다.
  const hint =
    isNumberMode && (numeric.unitReading || numeric.rangeViolation) ? (
      <div className="space-y-0.5 text-left leading-tight">
        {numeric.unitReading && (
          <p className="text-muted-foreground text-[11px]">{numeric.unitReading}</p>
        )}
        {numeric.rangeViolation && (
          <p className="text-[11px] text-red-500">* {numeric.rangeViolation}</p>
        )}
      </div>
    ) : null;

  // 래퍼는 **힌트 유무와 무관하게 항상** 렌더한다. 조건부로 감싸면 첫 글자에 힌트가 생기는
  // 순간 input 이 트리에서 자리를 옮겨 React 가 DOM 노드를 새로 만들고, 그때 포커스가 날아가
  // 뒤 글자가 입력되지 않는다 (실제로 겪었다).
  if (unstyled) {
    return (
      // OptionTextRow(가로 flex 셸) 안에 들어가므로 세로로 쌓되 flex-1·min-w-0 을 넘겨받는다.
      // 힌트가 붙으면 셸이 한 줄만큼 높아질 뿐 칩·입력 정렬은 그대로다.
      <div className={cn('flex min-w-0 flex-1 flex-col justify-center')}>
        <input type="text" {...sharedProps} />
        {hint}
      </div>
    );
  }
  return (
    <div className="space-y-1">
      <Input {...sharedProps} />
      {hint}
    </div>
  );
}
