import { describe, expect, it } from 'vitest';

import { expandRepeatRows } from '@/lib/question/row-repeat';
import type { Question, RowRepeatConfig, SumConstraint, TableCell, TableRow } from '@/types/survey';

import { collectNumericIssues, collectTableSoftWarnings } from './numeric-validation';

/**
 * 경고만 하는 표 제약 — 「출고량이 생산량의 2배를 넘으면 단위를 확인해 주세요」. 「다음」을 막지 않고
 * 표 아래 노란 안내로만 보인다(유가공업 문1, 웹 버전 v25QuantityWarnings 와 같은 규칙).
 */
const num = (id: string): TableCell => ({ id, type: 'input', content: '', inputType: 'number' });
const product: TableCell = {
  id: 'prod',
  type: 'select',
  content: '',
  selectOptions: [
    { id: 'o-milk', label: '우유', value: '01' },
    { id: 'o-powder', label: '분유', value: '12' },
  ],
};
const seed: TableRow[] = [
  { id: 'dom', label: '국내산', rowCode: 'r01', cells: [product, num('prodn'), num('ship'), num('raw')] },
  { id: 'imp', label: '수입산', rowCode: 'r02', cells: [{ id: 'blank', type: 'text', content: '' }, { id: 'b2', type: 'text', content: '' }, { id: 'b3', type: 'text', content: '' }, num('raw2')] },
];
const config: RowRepeatConfig = { enabled: true, templateRowIds: ['dom', 'imp'], maxRepeats: 3 };
let n = 0;
const rows = expandRepeatRows(seed, config, () => `g${++n}`);
const cellOf = (bundle: number, row: 0 | 1, i: number) =>
  rows.filter((r) => r.repeatIndex === bundle)[row]!.cells[i]!.id;

const shipWarn: SumConstraint = {
  id: 'warn-ship',
  cellIds: [],
  leftExpr: { kind: 'cell', cellId: 'ship' },
  targetExpr: { kind: 'group', op: '*', terms: [{ kind: 'cell', cellId: 'prodn' }, { kind: 'literal', value: 2 }] },
  operator: 'lte',
  target: 0,
  perRepeatBundle: true,
  severity: 'warn',
  errorMessage: '{묶음}번째 제품: 출고량을 확인해 주세요.',
};
const rawWarn: SumConstraint = {
  id: 'warn-raw',
  cellIds: [],
  leftExpr: { kind: 'agg', fn: 'sum', items: [{ kind: 'cell', cellId: 'raw' }, { kind: 'cell', cellId: 'raw2' }] },
  targetExpr: { kind: 'group', op: '*', terms: [{ kind: 'cell', cellId: 'prodn' }, { kind: 'literal', value: 5 }] },
  operator: 'lte',
  target: 0,
  perRepeatBundle: true,
  severity: 'warn',
  when: { kind: 'option', controllerCellId: 'prod', values: ['01'] },
  errorMessage: '{묶음}번째 제품: 원료 투입량을 확인해 주세요.',
};
const question = (sumConstraints: SumConstraint[]): Question =>
  ({
    id: 'q1',
    type: 'table',
    title: '문1',
    required: false,
    order: 1,
    tableColumns: ['품목', '생산', '출고', '원료'].map((label, i) => ({ id: `c${i}`, label })),
    tableRowsData: rows,
    rowRepeatConfig: config,
    sumConstraints,
  }) as Question;

describe('collectTableSoftWarnings', () => {
  it('출고량이 생산량의 2배를 넘으면 경고하고, 고치면 사라진다', () => {
    const q = question([shipWarn]);
    expect(collectTableSoftWarnings(q, { prodn: '100', ship: '250' }, undefined)).toEqual([
      { message: '1번째 제품: 출고량을 확인해 주세요.' },
    ]);
    expect(collectTableSoftWarnings(q, { prodn: '100', ship: '200' }, undefined)).toEqual([]);
  });

  it('생산량이나 출고량이 비면 경고하지 않는다', () => {
    const q = question([shipWarn]);
    expect(collectTableSoftWarnings(q, { ship: '250' }, undefined)).toEqual([]);
    expect(collectTableSoftWarnings(q, { prodn: '100' }, undefined)).toEqual([]);
    expect(collectTableSoftWarnings(q, {}, undefined)).toEqual([]);
  });

  it('묶음마다 그 묶음의 칸끼리 비교하고 묶음 번호를 붙인다', () => {
    const q = question([shipWarn]);
    const v = {
      prodn: '100',
      ship: '100',
      [cellOf(3, 0, 1)]: '10',
      [cellOf(3, 0, 2)]: '50',
    };
    expect(collectTableSoftWarnings(q, v, undefined).map((w) => w.message)).toEqual([
      '3번째 제품: 출고량을 확인해 주세요.',
    ]);
  });

  it('적용 조건(액상 품목)을 충족할 때만 원료 경고를 낸다 — 국내산·수입산 합', () => {
    const q = question([rawWarn]);
    const over = { prodn: '10', raw: '40', raw2: '20' }; // 60 > 50
    expect(collectTableSoftWarnings(q, { ...over, prod: '01' }, undefined)).toHaveLength(1);
    expect(collectTableSoftWarnings(q, { ...over, prod: '12' }, undefined)).toEqual([]);
    expect(collectTableSoftWarnings(q, over, undefined)).toEqual([]);
  });

  it('문구가 없으면 기본 경고 문구', () => {
    const { errorMessage: _m, ...plain } = shipWarn;
    expect(collectTableSoftWarnings(question([plain]), { prodn: '1', ship: '9' }, undefined)[0]!.message).toBe(
      '입력한 값을 다시 확인해 주세요. 맞다면 그대로 넘어가셔도 됩니다.',
    );
  });

  it('경고 제약이 없는 표는 빈 목록', () => {
    expect(collectTableSoftWarnings(question([]), { prodn: '1', ship: '9' }, undefined)).toEqual([]);
  });
});

describe('collectNumericIssues — 경고 제약은 막지 않는다', () => {
  it('경고에 걸려도 차단 이슈에 없다', () => {
    const q = question([shipWarn, rawWarn]);
    const v = { prod: '01', prodn: '1', ship: '9', raw: '99' };
    const issues = collectNumericIssues(q, v, { allResponses: { q1: v }, allQuestions: [q] });
    expect(issues.filter((i) => i.kind === 'sum')).toEqual([]);
  });

  it('차단 제약에 적용 조건이 붙으면 미충족일 때 막지 않는다', () => {
    const blocking: SumConstraint = { ...rawWarn, id: 'block-raw' };
    delete blocking.severity;
    const q = question([blocking]);
    // 차단 경로의 수식 제약은 ctx 가 있어야 평가한다(응답 화면은 늘 넘긴다)
    const run = (v: Record<string, unknown>) =>
      collectNumericIssues(q, v, { allResponses: { q1: v }, allQuestions: [q] }).some((i) => i.kind === 'sum');
    expect(run({ prod: '01', prodn: '1', raw: '99' })).toBe(true);
    expect(run({ prod: '12', prodn: '1', raw: '99' })).toBe(false);
  });
});
