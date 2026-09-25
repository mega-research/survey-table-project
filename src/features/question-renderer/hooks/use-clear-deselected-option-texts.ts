import { useResponseSources } from '@/features/question-renderer/response-sources';
import { collectSelectedChoiceCellIds } from '@/lib/survey/choice-selection';
import type { Question } from '@/types/survey';
import { resolveChoiceOptions } from '@/utils/choice-source';

/**
 * 선택형 문항의 답을 바꿀 때, 선택이 풀린 「기타·상세 기재」 보기의 입력값을 비운다.
 *
 * 순위형은 상세 기재가 순위 답 안에 같이 저장돼 순위를 빼면 함께 사라지는데, 단일·복수·드롭다운과
 * 보기 표는 입력값이 `__optTexts__` 사이드카에 따로 산다. 그래서 다른 보기로 바꾸면 입력칸만
 * 숨고 값은 남아, 기타를 다시 고르면 예전 글이 되살아났다(제출 때는 걸러지지만 화면·초안에는 남는다).
 * 같은 동작으로 맞추려고 답이 바뀌는 순간 선택되지 않은 보기의 입력값을 지운다.
 *
 * 응답자의 변경 이벤트에서만 돈다(effect 가 아니다) — 재진입 복원 순서에 따라 선택보다 입력값이
 * 먼저 들어오는 구간에 effect 가 돌면 멀쩡한 값을 지운다.
 */
export function useClearDeselectedOptionTexts<T>(
  question: Question,
  onChange: (next: T) => void,
): (next: T) => void {
  const { optionTexts } = useResponseSources();
  return (next: T) => {
    if (question.type === 'radio' || question.type === 'checkbox' || question.type === 'select') {
      const textOptions = resolveChoiceOptions(question).filter((o) => o.allowTextInput);
      if (textOptions.length > 0) {
        const selected = collectSelectedChoiceCellIds(question, next);
        const texts = optionTexts.read(question.id) ?? {};
        for (const option of textOptions) {
          if (!selected.has(option.value) && (texts[option.id] ?? '') !== '') {
            optionTexts.write(question.id, option.id, '');
          }
        }
      }
    }
    onChange(next);
  };
}
