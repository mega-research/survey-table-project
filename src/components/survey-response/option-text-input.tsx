'use client';

import { Input } from '@/components/ui/input';
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

  const sharedProps = {
    'aria-label': ariaLabel,
    // name: DevTools 폼 감사(id/name 필요) 대응. id 는 편집 미리보기+테스트 모드 동시
    // 마운트 시 중복될 수 있어 유일성 제약 없는 name 을 사용. 자유 기입란이라 자동완성 차단.
    name: `option-text-${option.id}`,
    autoComplete: 'off',
    value: optionTexts[option.id] ?? '',
    onChange: (e: React.ChangeEvent<HTMLInputElement>) =>
      setOptionText(questionId, option.id, e.target.value),
    placeholder: option.textInputPlaceholder || DEFAULT_PLACEHOLDER,
    className,
    'data-option-text-target-id': optionTextTargetId(questionId, option.id),
  };

  if (unstyled) return <input type="text" {...sharedProps} />;
  return <Input {...sharedProps} />;
}
