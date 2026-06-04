import { describe, it, expect } from 'vitest';

import { valueMatchSet, bucketQuestions } from '@/lib/analytics/split-export';
import type { Question, QuestionConditionGroup } from '@/types/survey';

const vm = (sourceQuestionId: string, requiredValues: string[]): QuestionConditionGroup => ({
  logicType: 'AND',
  conditions: [
    { id: 'c1', sourceQuestionId, conditionType: 'value-match', requiredValues, logicType: 'AND' },
  ],
});

describe('valueMatchSet', () => {
  it('value-match 조건의 requiredValues를 Set으로 모은다', () => {
    const set = valueMatchSet(vm('Q2', ['opt1', 'opt3']), 'Q2');
    expect(set).not.toBeNull();
    expect([...set!].sort()).toEqual(['opt1', 'opt3']);
  });

  it('다른 sourceQuestionId는 무시한다', () => {
    expect(valueMatchSet(vm('Q9', ['opt1']), 'Q2')).toBeNull();
  });

  it('value-match가 아닌 conditionType은 무시한다', () => {
    const dc: QuestionConditionGroup = {
      logicType: 'AND',
      conditions: [
        { id: 'c1', sourceQuestionId: 'Q2', conditionType: 'table-cell-check', logicType: 'AND' },
      ],
    };
    expect(valueMatchSet(dc, 'Q2')).toBeNull();
  });

  it('조건이 없으면 null', () => {
    expect(valueMatchSet(undefined, 'Q2')).toBeNull();
  });
});

const q = (over: Partial<Question>): Question => ({
  id: 'x', surveyId: 's', type: 'text', title: 't', required: false, order: 0,
  ...over,
} as unknown as Question);

describe('bucketQuestions', () => {
  // basis Q2 + 공통질문 A + opt1전용 B + 테이블 T(공통행 r0 / opt1행 r1 / opt2행 r2)
  const basis = q({ id: 'Q2', type: 'checkbox', questionCode: 'Q2' });
  const A = q({ id: 'A', type: 'text' });
  const B = q({ id: 'B', type: 'radio', displayCondition: vm('Q2', ['opt1']) });
  const T = q({
    id: 'T', type: 'table',
    tableRowsData: [
      { id: 'r0', cells: [] },
      { id: 'r1', cells: [], displayCondition: vm('Q2', ['opt1']) },
      { id: 'r2', cells: [], displayCondition: vm('Q2', ['opt2']) },
    ],
  } as Partial<Question>);
  const all = [basis, A, B, T];

  it('common: 조건 없는 질문 + basis 조건 없는 테이블 행만', () => {
    const out = bucketQuestions(all, 'Q2', 'common');
    expect(out.map((x) => x.id).sort()).toEqual(['A', 'Q2', 'T']);
    const t = out.find((x) => x.id === 'T')!;
    expect(t.tableRowsData!.map((r) => r.id)).toEqual(['r0']);
  });

  it('opt1: opt1 전용 질문 + opt1 행만', () => {
    const out = bucketQuestions(all, 'Q2', 'opt1');
    expect(out.map((x) => x.id).sort()).toEqual(['B', 'T']);
    const t = out.find((x) => x.id === 'T')!;
    expect(t.tableRowsData!.map((r) => r.id)).toEqual(['r1']);
  });

  it('opt2: 전용 질문 없고 opt2 행만', () => {
    const out = bucketQuestions(all, 'Q2', 'opt2');
    expect(out.map((x) => x.id)).toEqual(['T']);
    expect(out[0].tableRowsData!.map((r) => r.id)).toEqual(['r2']);
  });
});
