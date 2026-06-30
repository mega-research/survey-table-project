import { describe, expect, it } from 'vitest';

import {
  findStepIndexOfQuestion,
  resolveStepBranch,
  type RenderStep,
} from '@/lib/group-ordering';
import type { BranchRule } from '@/types/survey';

// resolveStepBranch 는 question.id 만 읽으므로 최소 형태로 page step 을 구성한다.
// 신모델: kind: 'page' + items: StepItem[]
function pageStep(...questionIds: string[]): RenderStep {
  return {
    kind: 'page',
    items: questionIds.map((id) => ({
      question: { id } as never,
      rootGroupId: null,
      rootGroupName: null,
      rootGroupNameDesign: undefined,
      subgroupName: null,
    })),
  };
}

function gotoRule(targetQuestionId: string): BranchRule {
  return { id: 'r', value: '', action: 'goto', targetQuestionId };
}

const endRule: BranchRule = { id: 'r', value: '', action: 'end' };

describe('findStepIndexOfQuestion', () => {
  it('질문이 속한 step 의 인덱스를 반환한다', () => {
    const steps = [pageStep('a', 'b'), pageStep('c', 'd')];
    expect(findStepIndexOfQuestion(steps, 'c')).toBe(1);
  });

  it('없는 질문이면 -1', () => {
    const steps = [pageStep('a')];
    expect(findStepIndexOfQuestion(steps, 'zzz')).toBe(-1);
  });
});

describe('resolveStepBranch', () => {
  it('goto 타깃이 같은 step 안에 있으면 제자리 점프가 아니라 fallthrough 한다 (트랩 방지)', () => {
    // Q13, Q13-1 이 한 페이지(step 5)에 있고, Q13 의 분기가 같은 페이지의 Q13-1 을 가리키는 케이스
    const steps = [
      pageStep('x'),
      pageStep('x2'),
      pageStep('x3'),
      pageStep('x4'),
      pageStep('x5'),
      pageStep('q12-2', 'q13', 'q13-1', 'q14'),
      pageStep('later'),
    ];
    const rules = [null, gotoRule('q13-1'), null, null];
    expect(resolveStepBranch(steps, 5, rules)).toEqual({ kind: 'fallthrough' });
  });

  it('goto 타깃이 뒤쪽(전진) step 이면 그 인덱스로 점프한다', () => {
    const steps = [pageStep('q13'), pageStep('mid'), pageStep('target')];
    const rules = [gotoRule('target')];
    expect(resolveStepBranch(steps, 0, rules)).toEqual({ kind: 'goto', stepIndex: 2 });
  });

  it('goto 타깃이 이전 step 이면 비-전진이므로 fallthrough 한다', () => {
    const steps = [pageStep('back'), pageStep('q13')];
    const rules = [gotoRule('back')];
    expect(resolveStepBranch(steps, 1, rules)).toEqual({ kind: 'fallthrough' });
  });

  it('end 규칙은 비-전진 여부와 무관하게 종료를 반환한다', () => {
    const steps = [pageStep('q13'), pageStep('next')];
    expect(resolveStepBranch(steps, 0, [endRule])).toEqual({ kind: 'end' });
  });

  it('첫 actionable 전진 goto 가 우선한다', () => {
    const steps = [pageStep('q'), pageStep('a'), pageStep('b')];
    const rules = [null, gotoRule('a'), gotoRule('b')];
    expect(resolveStepBranch(steps, 0, rules)).toEqual({ kind: 'goto', stepIndex: 1 });
  });

  it('적용할 분기 규칙이 없으면 fallthrough', () => {
    const steps = [pageStep('q'), pageStep('n')];
    expect(resolveStepBranch(steps, 0, [null, null])).toEqual({ kind: 'fallthrough' });
  });
});
