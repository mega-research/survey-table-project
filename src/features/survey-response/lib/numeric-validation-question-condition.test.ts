import { describe, expect, it } from 'vitest';

import { expandRepeatRows, resolveBundleSumConstraints, validateRowRepeatTemplate } from '@/lib/question/row-repeat';
import type { Question, RowRepeatConfig, SumConstraint, TableCell, TableRow } from '@/types/survey';

import { collectNumericIssues } from './numeric-validation';

/**
 * 표 제약의 다른 문항 조건(`whenQuestion`) · 값 세기(`countValues`) · 묶음 가로지르기(`acrossRepeatBundles`) —
 * 유가공업 SQ3 → 문1 연도 규칙: ②면 2024만, ③이면 2025만, ①이면 두 해 모두. 「다음」에서 막는다.
 */
const year: TableCell = {
  id: 'year',
  type: 'select',
  content: '',
  selectOptions: [
    { id: 'y24', label: '2024', value: '2024' },
    { id: 'y25', label: '2025', value: '2025' },
  ],
};
const seed: TableRow[] = [{ id: 'row', label: '제품', rowCode: 'r01', cells: [year, { id: 'qty', type: 'input', content: '', inputType: 'number' }] }];
const config: RowRepeatConfig = { enabled: true, templateRowIds: ['row'], maxRepeats: 3 };
let n = 0;
const rows = expandRepeatRows(seed, config, () => `g${++n}`);
const yearOf = (bundle: number) => rows.find((r) => r.repeatIndex === bundle)!.cells[0]!.id;

const sq3: Question = {
  id: 'sq3',
  type: 'radio',
  title: 'SQ3',
  required: true,
  order: 0,
  options: ['1', '2', '3'].map((v) => ({ id: `o${v}`, label: v, value: v })),
} as Question;
const onlyWhen = (v: string) => ({
  logicType: 'AND' as const,
  conditions: [{ id: `c${v}`, conditionType: 'value-match' as const, sourceQuestionId: 'sq3', requiredValues: [v], logicType: 'AND' as const }],
});
const yearRule = (id: string, sq3Value: string, countValue: string, operator: SumConstraint['operator'], target: number): SumConstraint => ({
  id,
  aggregate: 'count',
  cellIds: ['year'],
  acrossRepeatBundles: true,
  countValues: [countValue],
  operator,
  target,
  whenQuestion: onlyWhen(sq3Value),
  errorMessage: id,
});
const q1 = {
  id: 'q1',
  type: 'table',
  title: '문1',
  required: true,
  order: 1,
  tableColumns: [{ id: 'c1', label: '연도' }, { id: 'c2', label: '수량' }],
  tableRowsData: rows,
  rowRepeatConfig: config,
  sumConstraints: [
    yearRule('only-2024', '2', '2025', 'eq', 0),
    yearRule('only-2025', '3', '2024', 'eq', 0),
    yearRule('need-2024', '1', '2024', 'gte', 1),
    yearRule('need-2025', '1', '2025', 'gte', 1),
  ],
} as unknown as Question;

function messages(sq3Value: string | undefined, table: Record<string, unknown>, withCtx = true) {
  const all = { ...(sq3Value ? { sq3: sq3Value } : {}), q1: table };
  return collectNumericIssues(q1, table, withCtx ? { allResponses: all, allQuestions: [sq3, q1] } : undefined)
    .filter((i) => i.kind === 'sum')
    .map((i) => i.message);
}

describe('SQ3 → 문1 연도 (다른 문항 조건 · 값 세기 · 묶음 가로지르기)', () => {
  it('② 2024만 — 어느 줄이든 2025를 고르면 막고 그 칸을 짚는다', () => {
    expect(messages('2', { [yearOf(1)]: '2024' })).toEqual([]);
    expect(messages('2', { [yearOf(1)]: '2024', [yearOf(3)]: '2025' })).toEqual(['only-2024']);
    const issue = collectNumericIssues(q1, { [yearOf(1)]: '2024', [yearOf(3)]: '2025' }, {
      allResponses: { sq3: '2' },
      allQuestions: [sq3, q1],
    }).find((i) => i.message === 'only-2024')!;
    expect(issue.cellIds).toEqual([yearOf(3)]);
  });

  it('③ 2025만', () => {
    expect(messages('3', { [yearOf(1)]: '2025', [yearOf(2)]: '2025' })).toEqual([]);
    expect(messages('3', { [yearOf(1)]: '2024' })).toEqual(['only-2025']);
  });

  it('① 두 해 모두 — 빠진 해마다 막는다', () => {
    expect(messages('1', { [yearOf(1)]: '2024', [yearOf(2)]: '2025' })).toEqual([]);
    expect(messages('1', { [yearOf(1)]: '2024', [yearOf(2)]: '2024' })).toEqual(['need-2025']);
    expect(messages('1', { [yearOf(1)]: '2025' })).toEqual(['need-2024']);
  });

  it('SQ3 를 아직 안 골랐거나 평가 재료가 없으면 막지 않는다', () => {
    expect(messages(undefined, { [yearOf(1)]: '2025' })).toEqual([]);
    expect(messages('2', { [yearOf(1)]: '2025' }, false)).toEqual([]);
  });
});

describe('묶음 가로지르기 (row-repeat)', () => {
  it('1벌 칸이 1벌 + 적기 시작한 벌의 같은 자리 칸으로 넓어진 한 제약이 된다', () => {
    const [rule] = resolveBundleSumConstraints(q1, { [yearOf(3)]: '2025' }).filter((c) => c.id === 'only-2024');
    expect(rule!.cellIds).toEqual(['year', yearOf(3)]);
  });

  it('반복 검증 — 블록 칸만 가리키면 허용, 수식·칸 조건과 섞이면 막는다', () => {
    const base = { tableRowsData: seed } as unknown as Question;
    const ok = yearRule('a', '1', '2024', 'gte', 1);
    expect(validateRowRepeatTemplate({ ...base, sumConstraints: [ok] }, ['row'])).toEqual([]);
    const withWhen = { ...ok, when: { kind: 'filled' as const, controllerCellId: 'qty' } };
    expect(validateRowRepeatTemplate({ ...base, sumConstraints: [withWhen] }, ['row']).map((v) => v.kind)).toContain('sum-constraint');
  });
});
