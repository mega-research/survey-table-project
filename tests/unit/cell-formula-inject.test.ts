import { describe, expect, it } from 'vitest';
import { withCalcValues } from '@/lib/survey/cell-formula';
import type { Question } from '@/types/survey';

function calcTable(id: string, refQuestionId?: string): Question {
  return {
    id, type: 'table', title: 'T', required: false, order: 1,
    tableRowsData: [
      {
        id: 'r1', label: 'r1',
        cells: [
          { id: `${id}-a`, content: '', type: 'input', inputType: 'number' },
          {
            id: `${id}-c`, content: '', type: 'calc',
            formula: refQuestionId
              ? { kind: 'cell', questionId: refQuestionId, cellId: `${refQuestionId}-a` }
              : { kind: 'cell', cellId: `${id}-a` },
          },
        ],
      },
    ],
  } as Question;
}

describe('withCalcValues', () => {
  it('calc 셀 값을 문자열로 주입한다', () => {
    const q = calcTable('q1');
    const responses = { q1: { 'q1-a': '10' } };
    const out = withCalcValues({ q1: { 'q1-a': '10' } }, { questions: [q], responses, lookups: [], contactAttrs: {} });
    expect((out['q1'] as Record<string, unknown>)['q1-c']).toBe('10');
  });

  it('null 결과는 빈 문자열로 주입한다', () => {
    const q = calcTable('q1');
    q.tableRowsData![0]!.cells[1]!.formula = { kind: 'cell', cellId: 'q1-c' }; // 순환
    const out = withCalcValues({}, { questions: [q], responses: {}, lookups: [], contactAttrs: {} });
    expect((out['q1'] as Record<string, unknown>)['q1-c']).toBe('');
  });

  it('payload 에 없는 질문도 calc 셀이 있으면 최신 응답과 병합해 포함시킨다', () => {
    const q1 = calcTable('q1');
    const q2 = calcTable('q2', 'q1'); // q2 의 calc 이 q1 셀을 참조
    const responses = { q1: { 'q1-a': '5' }, q2: { 'q2-a': '1' } };
    const out = withCalcValues({ q1: { 'q1-a': '5' } }, { questions: [q1, q2], responses, lookups: [], contactAttrs: {} });
    const q2Out = out['q2'] as Record<string, unknown>;
    expect(q2Out['q2-c']).toBe('5');
    expect(q2Out['q2-a']).toBe('1'); // 기존 셀 값 보존
  });

  it('calc 셀이 없는 payload 는 그대로 반환한다', () => {
    const plain = { q9: 'free text' };
    const out = withCalcValues(plain, { questions: [], responses: plain, lookups: [], contactAttrs: {} });
    expect(out).toEqual(plain);
  });

  it('반올림 규칙은 numberFormat.decimalPlaces 를 따른다', () => {
    const q = calcTable('q1');
    const cell = q.tableRowsData![0]!.cells[1]!;
    cell.numberFormat = { decimalPlaces: 0 };
    cell.formula = {
      kind: 'group', op: '*',
      terms: [{ kind: 'literal', value: 0.7 }, { kind: 'literal', value: 5 }],
    };
    const out = withCalcValues({}, { questions: [q], responses: {}, lookups: [], contactAttrs: {} });
    expect((out['q1'] as Record<string, unknown>)['q1-c']).toBe('4'); // 3.5 → 4
  });
});
