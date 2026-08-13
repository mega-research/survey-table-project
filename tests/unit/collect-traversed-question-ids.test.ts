import { describe, expect, it } from 'vitest';
import { buildRenderSteps } from '@/lib/group-ordering';
import { collectTraversedQuestionIds } from '@/utils/branch-logic';
import type { BranchRule, Question, QuestionOption } from '@/types/survey';

// 분기 시뮬레이션 경로 산출 — 제출 검증이 "실제 도달 가능한 질문"만 보게 하는 핵심.
// end/전진 goto 로 건너뛴 스텝의 필수 질문이 검증에 포함되면 조기 종료 설문이
// "필수 질문 남음"으로 제출 불가가 된다 (해운물류 멘토링 조사 재현 케이스).

const OPT = (value: string, branchRule?: BranchRule): QuestionOption => ({
  id: `opt-${value}`,
  label: value,
  value,
  ...(branchRule ? { branchRule } : {}),
});

const Q = (id: string, order: number, extra: Partial<Question> = {}): Question =>
  ({ id, type: 'radio', title: id.toUpperCase(), required: true, order, ...extra }) as Question;

const END: BranchRule = { id: 'r-end', value: '재학생', action: 'end' };

describe('collectTraversedQuestionIds — 분기 경로 시뮬레이션', () => {
  it('end 분기 선택 시 이후 스텝 질문은 경로에서 제외된다', () => {
    const questions = [
      Q('q1', 0, { options: [OPT('재학생', END), OPT('졸업자')] }),
      Q('q2', 1, { pageBreakBefore: true }),
      Q('q3', 2),
    ];
    const steps = buildRenderSteps(questions, []);

    const ended = collectTraversedQuestionIds(steps, { q1: '재학생' }, questions, []);
    expect([...ended].sort()).toEqual(['q1']);

    const through = collectTraversedQuestionIds(steps, { q1: '졸업자' }, questions, []);
    expect([...through].sort()).toEqual(['q1', 'q2', 'q3']);
  });

  it('미응답 상태에서는 분기가 발동하지 않고 전체 스텝을 경로로 본다', () => {
    const questions = [
      Q('q1', 0, { options: [OPT('재학생', END), OPT('졸업자')] }),
      Q('q2', 1, { pageBreakBefore: true }),
    ];
    const steps = buildRenderSteps(questions, []);
    const ids = collectTraversedQuestionIds(steps, {}, questions, []);
    expect([...ids].sort()).toEqual(['q1', 'q2']);
  });

  it('전진 goto 분기는 중간 스텝을 건너뛴다', () => {
    const goto: BranchRule = {
      id: 'r-goto',
      value: 'skip',
      action: 'goto',
      targetQuestionId: 'q3',
    };
    const questions = [
      Q('q1', 0, { options: [OPT('skip', goto), OPT('stay')] }),
      Q('q2', 1, { pageBreakBefore: true }),
      Q('q3', 2, { pageBreakBefore: true }),
    ];
    const steps = buildRenderSteps(questions, []);

    const skipped = collectTraversedQuestionIds(steps, { q1: 'skip' }, questions, []);
    expect([...skipped].sort()).toEqual(['q1', 'q3']);

    const stayed = collectTraversedQuestionIds(steps, { q1: 'stay' }, questions, []);
    expect([...stayed].sort()).toEqual(['q1', 'q2', 'q3']);
  });

  it('displayCondition 으로 숨은 질문은 경로에 포함되지 않는다', () => {
    const questions = [
      Q('q1', 0, { options: [OPT('a'), OPT('b')] }),
      Q('q2', 1, {
        pageBreakBefore: true,
        displayCondition: {
          logicType: 'AND',
          conditions: [
            {
              id: 'c1',
              logicType: 'AND',
              sourceQuestionId: 'q1',
              conditionType: 'value-match',
              requiredValues: ['b'],
            },
          ],
        },
      }),
      Q('q3', 2, { pageBreakBefore: true }),
    ];
    const steps = buildRenderSteps(questions, []);
    const ids = collectTraversedQuestionIds(steps, { q1: 'a' }, questions, []);
    expect([...ids].sort()).toEqual(['q1', 'q3']);
  });
});
