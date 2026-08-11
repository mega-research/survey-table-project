import { describe, expect, it } from 'vitest';

import { createAddLevelOption } from '@/components/survey-builder/question-option-helpers';
import type { Question, QuestionOption } from '@/types/survey';

/** setFormData(updater) 를 흉내내 상태를 캡처하는 하네스 */
function applyWith(initial: Partial<Question>, run: (setFormData: (u: unknown) => void) => void): Partial<Question> {
  let state = initial;
  const setFormData = (updater: unknown): void => {
    state = typeof updater === 'function'
      ? (updater as (prev: Partial<Question>) => Partial<Question>)(state)
      : (updater as Partial<Question>);
  };
  run(setFormData);
  return state;
}

describe('createAddLevelOption', () => {
  it('중간 삭제 이력이 있어도 기존 value 와 중복되지 않게 발번한다', () => {
    // 옵션2 삭제 후 추가 시 count+1 발번이면 옵션3 이 재탕되어 같은 응답 키를 공유한다
    const initial: Partial<Question> = {
      selectLevels: [
        {
          id: 'lv1',
          label: '1단계',
          order: 0,
          options: [
            { id: 'a', label: '옵션 1', value: '옵션1' },
            { id: 'c', label: '옵션 3', value: '옵션3' },
          ],
        },
      ],
    };

    const state = applyWith(initial, (setFormData) => {
      createAddLevelOption(setFormData as never)('lv1');
    });

    const options = state.selectLevels?.[0]?.options as QuestionOption[];
    expect(options).toHaveLength(3);
    expect(new Set(options.map((o) => o.value)).size).toBe(3);
    expect(options[2]!.value).toBe('옵션4');
  });
});
