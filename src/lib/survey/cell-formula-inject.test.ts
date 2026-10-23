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

  it('payload 에만 있는 최신 입력이 계산에 반영된다 (stale ctx 방지)', () => {
    const q = calcTable('q1');
    // ctx.responses 는 이전 값 '1', payload 는 최신 값 '9'
    const out = withCalcValues(
      { q1: { 'q1-a': '9' } },
      { questions: [q], responses: { q1: { 'q1-a': '1' } }, lookups: [], contactAttrs: {} },
    );
    expect((out['q1'] as Record<string, unknown>)['q1-c']).toBe('9');
  });

  it('payload 최신 입력이 교차 질문 참조 계산에도 반영된다', () => {
    const q1 = calcTable('q1');
    const q2 = calcTable('q2', 'q1'); // q2 calc 이 q1-a 참조
    const out = withCalcValues(
      { q1: { 'q1-a': '20' } },
      { questions: [q1, q2], responses: { q1: { 'q1-a': '5' } }, lookups: [], contactAttrs: {} },
    );
    expect((out['q2'] as Record<string, unknown>)['q2-c']).toBe('20');
  });
});

describe('withCalcValues — 채울 문항 한정 (inScopeQuestionIds)', () => {
  const ctxOf = (questions: Question[], responses: Record<string, unknown>) => ({
    questions,
    responses,
    lookups: [],
    contactAttrs: {},
  });

  it('닿지 않은 문항에는 계산값을 새로 만들지 않는다', () => {
    const q1 = calcTable('q1');
    const q2 = calcTable('q2', 'q1');
    const responses = { q1: { 'q1-a': '5' } };
    const out = withCalcValues(responses, ctxOf([q1, q2], responses), {
      inScopeQuestionIds: new Set(['q1']),
    });
    expect((out['q1'] as Record<string, unknown>)['q1-c']).toBe('5');
    expect(out).not.toHaveProperty('q2');
  });

  it('닿지 않았어도 이미 값이 있는 문항은 다시 계산한다 — 수식과 다른 저장값을 남기지 않는다', () => {
    const q1 = calcTable('q1');
    const q2 = calcTable('q2', 'q1');
    const responses = { q1: { 'q1-a': '5' }, q2: { 'q2-a': '1', 'q2-c': '999' } };
    const out = withCalcValues(responses, ctxOf([q1, q2], responses), {
      inScopeQuestionIds: new Set(['q1']),
    });
    expect((out['q2'] as Record<string, unknown>)['q2-c']).toBe('5');
  });

  it('숨은 문항의 값을 참조하는 수식은 그대로 계산한다', () => {
    const q1 = calcTable('q1');
    const q2 = calcTable('q2', 'q1');
    const responses = { q1: { 'q1-a': '7' } };
    const out = withCalcValues({}, ctxOf([q1, q2], responses), {
      inScopeQuestionIds: new Set(['q2']),
    });
    expect((out['q2'] as Record<string, unknown>)['q2-c']).toBe('7');
  });

  it('한정이 없으면 종전대로 모든 계산 칸 문항을 채운다', () => {
    const q1 = calcTable('q1');
    const q2 = calcTable('q2', 'q1');
    const out = withCalcValues({}, ctxOf([q1, q2], {}));
    expect(out).toHaveProperty('q1');
    expect(out).toHaveProperty('q2');
  });
});
