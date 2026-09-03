import { describe, expect, it } from 'vitest';
import { createAddLevelOption, createUpdateOption } from '@/features/survey-builder/question-option-helpers';
import type { Question, QuestionOption } from '@/types/survey';

// createUpdateOption(setFormData) 가 반환하는 updater 를 직접 호출하기 위한 헬퍼.
// setFormData 모킹: 현재 formData 를 받아 reducer 를 적용하고 결과를 보관한다.
function runUpdate(
  initial: Partial<Question>,
  invoke: (
    update: (
      optionId: string,
      updates: Partial<QuestionOption>,
      clear?: Parameters<ReturnType<typeof createUpdateOption>>[2],
    ) => void,
  ) => void,
): Partial<Question> {
  let state = initial;
  const setFormData = (
    updater: Partial<Question> | ((prev: Partial<Question>) => Partial<Question>),
  ) => {
    state = typeof updater === 'function' ? updater(state) : updater;
  };
  const update = createUpdateOption(setFormData as never);
  invoke(update);
  return state;
}

const baseOption: QuestionOption = {
  id: 'opt-1',
  label: '선택지 1',
  value: '선택지1',
  spssNumericCode: 5,
};

function firstOption(state: Partial<Question>): QuestionOption {
  const option = state.options?.[0];
  if (!option) throw new Error('option[0] 없음');
  return option;
}

describe('createUpdateOption', () => {
  it('updates 로 전달한 키를 머지한다', () => {
    const result = runUpdate({ options: [baseOption] }, (update) => {
      update('opt-1', { spssNumericCode: 9 });
    });
    expect(firstOption(result).spssNumericCode).toBe(9);
  });

  it('빈 updates 만 넘기면 기존 값을 유지한다 (응답값 입력을 비우는 버그 재현)', () => {
    // 회귀 가드: clear 없이 {} 만 머지하면 기존 spssNumericCode 가 그대로 남는다.
    // 따라서 입력을 비울 때는 반드시 clear 를 써야 한다.
    const result = runUpdate({ options: [baseOption] }, (update) => {
      update('opt-1', {});
    });
    expect(firstOption(result).spssNumericCode).toBe(5);
  });

  it('clear 로 키를 지정하면 해당 키를 제거한다 (응답값 비우기 정상 동작)', () => {
    const result = runUpdate({ options: [baseOption] }, (update) => {
      update('opt-1', {}, ['spssNumericCode']);
    });
    expect('spssNumericCode' in firstOption(result)).toBe(false);
    expect(firstOption(result).spssNumericCode).toBeUndefined();
  });

  it('대상 외 옵션은 건드리지 않는다', () => {
    const other: QuestionOption = { id: 'opt-2', label: '선택지 2', value: '선택지2', spssNumericCode: 7 };
    const result = runUpdate({ options: [baseOption, other] }, (update) => {
      update('opt-1', {}, ['spssNumericCode']);
    });
    const second = result.options?.[1];
    if (!second) throw new Error('option[1] 없음');
    expect(second.spssNumericCode).toBe(7);
  });
});

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
