import { describe, expect, it } from 'vitest';
import { buildRenderSteps } from '@/utils/group-ordering';
import { collectTraversedStepPath } from '@/utils/branch-logic';
import type { BranchRule, Question, QuestionOption } from '@/types/survey';

// 임시저장 복원 시 stepHistory 재구성 — 이전 버튼/브라우저 뒤로가기가 실제 밟은
// 경로만 되짚게 한다. 복원은 currentStepIndex 만 되돌리고 히스토리는 비어 있어
// 이전 버튼이 영구 비활성이 되는 버그의 회귀 테스트.

const OPT = (value: string, branchRule?: BranchRule): QuestionOption => ({
  id: `opt-${value}`,
  label: value,
  value,
  ...(branchRule ? { branchRule } : {}),
});

const Q = (id: string, order: number, extra: Partial<Question> = {}): Question =>
  ({ id, type: 'radio', title: id.toUpperCase(), required: true, order, ...extra }) as Question;

describe('collectTraversedStepPath — 복원 시 스텝 히스토리 재구성', () => {
  it('직선 경로에서 목표 스텝 이전의 방문 스텝 인덱스를 순서대로 반환한다', () => {
    const questions = [
      Q('q1', 0),
      Q('q2', 1, { pageBreakBefore: true }),
      Q('q3', 2, { pageBreakBefore: true }),
    ];
    const steps = buildRenderSteps(questions, []);

    expect(collectTraversedStepPath(steps, 2, { q1: 'a', q2: 'b' }, questions, [])).toEqual([
      0, 1,
    ]);
  });

  it('목표가 첫 스텝이면 빈 히스토리를 반환한다', () => {
    const questions = [Q('q1', 0), Q('q2', 1, { pageBreakBefore: true })];
    const steps = buildRenderSteps(questions, []);

    expect(collectTraversedStepPath(steps, 0, {}, questions, [])).toEqual([]);
  });

  it('전진 goto 로 건너뛴 스텝은 히스토리에 포함되지 않는다', () => {
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

    expect(collectTraversedStepPath(steps, 2, { q1: 'skip' }, questions, [])).toEqual([0]);
    expect(collectTraversedStepPath(steps, 2, { q1: 'stay', q2: 'x' }, questions, [])).toEqual([
      0, 1,
    ]);
  });

  it('displayCondition 으로 전부 숨은 스텝은 히스토리에 포함되지 않는다', () => {
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

    expect(collectTraversedStepPath(steps, 2, { q1: 'a' }, questions, [])).toEqual([0]);
  });

  it('end 분기로 목표 스텝에 도달할 수 없으면 빈 히스토리를 반환한다', () => {
    const end: BranchRule = { id: 'r-end', value: '재학생', action: 'end' };
    const questions = [
      Q('q1', 0, { options: [OPT('재학생', end), OPT('졸업자')] }),
      Q('q2', 1, { pageBreakBefore: true }),
    ];
    const steps = buildRenderSteps(questions, []);

    expect(collectTraversedStepPath(steps, 1, { q1: '재학생' }, questions, [])).toEqual([]);
  });

  it('goto 가 목표 스텝을 지나쳐 도달 불가면 빈 히스토리를 반환한다', () => {
    const goto: BranchRule = {
      id: 'r-goto',
      value: 'skip',
      action: 'goto',
      targetQuestionId: 'q4',
    };
    const questions = [
      Q('q1', 0, { options: [OPT('skip', goto), OPT('stay')] }),
      Q('q2', 1, { pageBreakBefore: true }),
      Q('q3', 2, { pageBreakBefore: true }),
      Q('q4', 3, { pageBreakBefore: true }),
    ];
    const steps = buildRenderSteps(questions, []);

    // q1=skip → step0 에서 step3 으로 점프. step1(목표=q2) 은 경로에 없다.
    expect(collectTraversedStepPath(steps, 1, { q1: 'skip' }, questions, [])).toEqual([]);
  });
});
