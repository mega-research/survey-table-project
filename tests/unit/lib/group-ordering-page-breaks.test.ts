import { describe, expect, it } from 'vitest';
import { buildRenderSteps, stepIdOf, findStepIndexOfQuestion } from '@/lib/group-ordering';
import type { Question, QuestionGroup } from '@/types/survey';

const G = (id: string, order: number, extra: Partial<QuestionGroup> = {}): QuestionGroup =>
  ({ id, surveyId: 's', name: id.toUpperCase(), order, ...extra }) as QuestionGroup;
const Q = (id: string, order: number, extra: Partial<Question> = {}): Question =>
  ({ id, type: 'radio', title: id.toUpperCase(), required: false, order, ...extra }) as Question;

describe('buildRenderSteps — 수동 구분점', () => {
  it('구분점이 없으면 모든 질문이 한 페이지 (테이블 포함)', () => {
    const questions = [Q('q1', 0), Q('q2', 1, { type: 'table' }), Q('q3', 2)];
    const steps = buildRenderSteps(questions, []);
    expect(steps).toHaveLength(1);
    expect(steps[0]!.items.map((i) => i.question.id)).toEqual(['q1', 'q2', 'q3']);
  });

  it('pageBreakBefore 질문에서만 페이지를 자른다', () => {
    const questions = [Q('q1', 0), Q('q2', 1), Q('q3', 2, { pageBreakBefore: true }), Q('q4', 3)];
    const steps = buildRenderSteps(questions, []);
    expect(steps.map((s) => s.items.map((i) => i.question.id))).toEqual([
      ['q1', 'q2'],
      ['q3', 'q4'],
    ]);
  });

  it('첫 질문의 pageBreakBefore는 무시한다', () => {
    const questions = [Q('q1', 0, { pageBreakBefore: true }), Q('q2', 1)];
    const steps = buildRenderSteps(questions, []);
    expect(steps).toHaveLength(1);
  });

  it('페이지가 그룹 경계를 가로질러도 항목별 그룹 컨텍스트가 붙는다', () => {
    const groups = [G('g1', 0), G('g2', 1)];
    const questions = [Q('q1', 0, { groupId: 'g1' }), Q('q2', 0, { groupId: 'g2' })];
    const steps = buildRenderSteps(questions, groups);
    expect(steps).toHaveLength(1);
    const items = steps[0]!.items;
    expect(items[0]!.rootGroupId).toBe('g1');
    expect(items[0]!.rootGroupName).toBe('G1');
    expect(items[1]!.rootGroupId).toBe('g2');
  });

  it('stepId는 페이지 첫 질문 id 기반', () => {
    const questions = [Q('q1', 0), Q('q2', 1, { pageBreakBefore: true })];
    const steps = buildRenderSteps(questions, []);
    expect(stepIdOf(steps[0]!)).toBe('page:q1');
    expect(stepIdOf(steps[1]!)).toBe('page:q2');
    expect(findStepIndexOfQuestion(steps, 'q2')).toBe(1);
    expect(findStepIndexOfQuestion(steps, 'zzz')).toBe(-1);
  });
});
