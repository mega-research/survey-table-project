import { describe, expect, it } from 'vitest';

import {
  branchRuleOptionPatch,
  createUpdateOption,
} from '@/components/survey-builder/question-option-helpers';
import type { Question, QuestionOption } from '@/types/survey';

/**
 * 질문 레벨 옵션의 조건부 분기 끄기.
 *
 * BranchRuleEditor 는 토글을 끄면 `onChange(undefined)` 를 보낸다. 이때 옵션에서
 * `branchRule` **키가 사라져야** 한다. 남으면 모달을 다시 열 때 "옵션 중 하나라도
 * branchRule 이 있으면 켬" 파생이 토글을 되살려, 사용자에게는 토글이 안 꺼지는 것으로 보인다.
 *
 * 표 셀 편집기(cell-choice-editor)는 구조분해로 키를 빼서 이미 맞다 — 질문 레벨만 틀렸다.
 */
function optionWithBranch(): QuestionOption {
  return {
    id: 'o1',
    label: '② 동의하지 않음',
    value: '2',
    branchRule: { action: 'goto', targetQuestionId: 'q9', value: '2' },
  } as QuestionOption;
}

/** createUpdateOption 은 setFormData 를 받아 동작한다 — 최소 하네스로 상태를 잡는다. */
function harness(initial: QuestionOption[]) {
  let state: Partial<Question> = { options: initial };
  const setFormData = (updater: unknown) => {
    state = typeof updater === 'function' ? (updater as (p: Partial<Question>) => Partial<Question>)(state) : (updater as Partial<Question>);
  };
  return {
    updateOption: createUpdateOption(setFormData as never),
    get options() {
      return state.options ?? [];
    },
  };
}

describe('branchRuleOptionPatch', () => {
  it('규칙을 주면 패치에 싣고 지울 키는 없다', () => {
    const rule = { action: 'goto', targetQuestionId: 'q9', value: '2' } as never;
    expect(branchRuleOptionPatch(rule)).toEqual({ updates: { branchRule: rule }, clear: [] });
  });

  it('undefined 를 주면 빈 패치와 함께 branchRule 을 지울 키로 낸다', () => {
    expect(branchRuleOptionPatch(undefined)).toEqual({ updates: {}, clear: ['branchRule'] });
  });
});

describe('질문 레벨 옵션의 조건부 분기 해제', () => {
  it('해제 패치를 태우면 branchRule 키가 사라진다', () => {
    const h = harness([optionWithBranch()]);
    const { updates, clear } = branchRuleOptionPatch(undefined);

    h.updateOption('o1', updates, clear);

    expect('branchRule' in h.options[0]!).toBe(false);
  });

  it('빈 패치만 보내면 기존 분기가 남는다 — 이것이 버그였다', () => {
    const h = harness([optionWithBranch()]);

    h.updateOption('o1', {});

    expect('branchRule' in h.options[0]!).toBe(true);
  });

  it('켜기 패치를 태우면 규칙이 실린다', () => {
    const h = harness([{ id: 'o1', label: '① 동의', value: '1' } as QuestionOption]);
    const rule = { action: 'end', endOutcome: 'screened_out', value: '1' } as never;
    const { updates, clear } = branchRuleOptionPatch(rule);

    h.updateOption('o1', updates, clear);

    expect(h.options[0]?.branchRule?.action).toBe('end');
  });
});
