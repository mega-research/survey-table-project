'use client';

import { OptionTextInput } from './option-text-input';

// 기존 소비자(ranking-dropdown-stack, question-test-card)의 import 경로를 보존한다.
export { OPTION_TEXT_BARE_INPUT_CLS, OptionTextRow } from './option-text-row';

export interface OptionTextStackEntry {
  /** OptionTextInput 저장 키(option.id) + placeholder 소스 */
  option: { id: string; textInputPlaceholder?: string | undefined };
  /** 라벨 칩 문구 (토큰 치환 완료본) */
  label: string;
}

interface OptionTextInputStackProps {
  questionId: string;
  entries: OptionTextStackEntry[];
  className?: string | undefined;
}

/**
 * allowTextInput 옵션의 상세 기재 입력란 스택.
 * 셀/질문의 옵션 그리드 아래에 OptionTextRow 가 선택 순서대로 쌓인다
 * (radio/checkbox 셀의 CellOptionsContainer footer 슬롯, 일반 radio/checkbox 질문 공용).
 * 입력값 저장은 인라인과 동일한 optionTexts 사이드카(OptionTextInput)라 데이터 영향 없음.
 */
export function OptionTextInputStack({ questionId, entries, className }: OptionTextInputStackProps) {
  if (entries.length === 0) return null;

  return (
    <div className={className ?? 'space-y-1.5'}>
      {entries.map(({ option, label }) => (
        <OptionTextInput
          key={option.id}
          questionId={questionId}
          option={option}
          ariaLabel={label}
          rowLabel={label}
        />
      ))}
    </div>
  );
}
