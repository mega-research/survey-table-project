import { describe, expect, it } from 'vitest';

import { expandRepeatRows } from '@/lib/question/row-repeat';
import { stripHiddenQuestionValues } from '@/lib/survey/question-visibility';
import type { Question, QuestionConditionGroup, RowRepeatConfig, TableRow } from '@/types/survey';

import { collectNumericIssues } from './numeric-validation';

/**
 * 행 반복 블록 표시 조건 · 처음엔 접어 두기 — 필수 검증과 저장 경계 (2026-11-06).
 */
const whenQ0Is = (v: string): QuestionConditionGroup =>
  ({
    logicType: 'AND',
    conditions: [{ id: `q0-${v}`, conditionType: 'value-match', sourceQuestionId: 'q0', requiredValues: [v] }],
  }) as QuestionConditionGroup;
const q0 = { id: 'q0', type: 'radio', title: 'q0', required: false, order: 0, options: [{ id: 'o1', label: '예', value: '1' }] } as Question;

function table(config: RowRepeatConfig): Question {
  let n = 0;
  const rows: TableRow[] = expandRepeatRows(
    [
      { id: 'fixed', label: '원유', cells: [{ id: 'f1', content: '', type: 'input' }] },
      { id: 'tpl', label: '품목', cells: [{ id: 't1', content: '', type: 'input', required: true }] },
    ],
    config,
    () => `gen${++n}`,
  );
  return { id: 'q1', type: 'table', title: 't', required: false, order: 1, tableColumns: [{ id: 'c1', label: '품목' }], tableRowsData: rows, rowRepeatConfig: config } as Question;
}
const base: RowRepeatConfig = { enabled: true, templateRowIds: ['tpl'], maxRepeats: 3 };
const requiredIssues = (q: Question, value: Record<string, unknown>, all: Record<string, unknown>) =>
  collectNumericIssues(q, value, { allResponses: { ...all, q1: value }, allQuestions: [q0, q] }).filter(
    (i) => i.kind === 'required-cells',
  );

describe('필수 검증 (고정 줄을 적어 표를 건드린 상태)', () => {
  const touched = { f1: '10' };
  it('블록이 숨으면 블록 첫 줄의 필수 칸은 막지 않는다', () => {
    const q = table({ ...base, displayCondition: whenQ0Is('1') });
    expect(requiredIssues(q, touched, {})).toHaveLength(0);
    expect(requiredIssues(q, touched, { q0: '1' })).toHaveLength(1);
  });

  it('접힌 첫 줄은 비어 있으면 막지 않고, 적기 시작하면 1벌처럼 검사한다', () => {
    const q = table({ ...base, startCollapsed: true });
    expect(requiredIssues(q, touched, {})).toHaveLength(0);
    // 펼쳐 둘 조건이 참이면 평소처럼 첫 줄 필수
    const expanded = table({ ...base, startCollapsed: true, expandWhen: whenQ0Is('1') });
    expect(requiredIssues(expanded, touched, { q0: '1' })).toHaveLength(1);
  });

  it('접힌 첫 줄도 다른 칸을 적기 시작했으면 필수 칸을 검사한다', () => {
    let n = 0;
    const rows: TableRow[] = expandRepeatRows(
      [
        { id: 'fixed', label: '원유', cells: [{ id: 'f1', content: '', type: 'input' }] },
        { id: 'tpl', label: '품목', cells: [{ id: 't1', content: '', type: 'input', required: true }, { id: 't2', content: '', type: 'input' }] },
      ],
      { ...base, startCollapsed: true },
      () => `g${++n}`,
    );
    const q = { id: 'q1', type: 'table', title: 't', required: false, order: 1, tableColumns: [{ id: 'c1', label: 'a' }, { id: 'c2', label: 'b' }], tableRowsData: rows, rowRepeatConfig: { ...base, startCollapsed: true } } as Question;
    expect(requiredIssues(q, { f1: '10', t2: '메모' }, {})).toHaveLength(1);
  });
});

describe('저장 경계', () => {
  it('블록이 숨으면 블록 칸의 값은 지우고 고정 줄 값은 남긴다', () => {
    const q = table({ ...base, displayCondition: whenQ0Is('1') });
    const out = stripHiddenQuestionValues([q0, q], { q1: { f1: '10', t1: '버터' } });
    expect(out['q1']).toEqual({ f1: '10' });
    const kept = { q0: '1', q1: { f1: '10', t1: '버터' } };
    expect(stripHiddenQuestionValues([q0, q], kept)['q1']).toEqual({ f1: '10', t1: '버터' });
  });
});

describe('접힌 첫 줄은 화면에 없는 칸이다 — 필수뿐 아니라 모든 차단 검증에서 빠진다 (리뷰 지적)', () => {
  const withCount = (config: RowRepeatConfig): Question => ({
    ...table(config),
    sumConstraints: [{ id: 'need-t1', aggregate: 'count', cellIds: ['t1'], operator: 'gte', target: 1, errorMessage: '품목을 적어 주세요' }],
  }) as Question;
  const countIssues = (q: Question, value: Record<string, unknown>, all: Record<string, unknown> = {}) =>
    collectNumericIssues(q, value, { allResponses: { ...all, q1: value }, allQuestions: [q0, q] }).filter((i) =>
      i.message.includes('품목을 적어'),
    );

  it('접힌 채 비어 있으면 입력 개수 제약이 막지 않는다', () => {
    expect(countIssues(withCount({ ...base, startCollapsed: true }), { f1: '10' })).toHaveLength(0);
  });

  it('펼쳐 둔 첫 줄(조건 참)이나 접어 두지 않은 첫 줄은 그대로 검사한다', () => {
    expect(countIssues(withCount(base), { f1: '10' })).toHaveLength(1);
    expect(countIssues(withCount({ ...base, startCollapsed: true, expandWhen: whenQ0Is('1') }), { f1: '10' }, { q0: '1' })).toHaveLength(1);
  });
});

