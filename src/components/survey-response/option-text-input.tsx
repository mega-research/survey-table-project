'use client';

import { Input } from '@/components/ui/input';
import { useSurveyResponseStore } from '@/stores/survey-response-store';

// useSyncExternalStore 안정 참조 — selector 내부 `?? {}` 사용 시 무한 루프 경고 회피
const EMPTY_OPTION_TEXTS: Record<string, string> = {};

const DEFAULT_PLACEHOLDER = '상세 기재';

interface OptionTextInputProps {
  questionId: string;
  option: {
    id: string;
    textInputPlaceholder?: string;
  };
  className?: string;
}

/**
 * allowTextInput 옵션의 사이드카 텍스트 입력칸.
 * useSurveyResponseStore.optionTexts[questionId][option.id] 에 저장.
 * 응답 페이지 / 빌더 테스트 모드 / 테이블 셀 공통 사용.
 */
export function OptionTextInput({ questionId, option, className }: OptionTextInputProps) {
  const optionTexts =
    useSurveyResponseStore((s) => s.optionTexts[questionId]) ?? EMPTY_OPTION_TEXTS;
  const setOptionText = useSurveyResponseStore((s) => s.setOptionText);

  return (
    <Input
      value={optionTexts[option.id] ?? ''}
      onChange={(e) => setOptionText(questionId, option.id, e.target.value)}
      placeholder={option.textInputPlaceholder || DEFAULT_PLACEHOLDER}
      className={className}
    />
  );
}
