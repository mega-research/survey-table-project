import { describe, expect, it } from 'vitest';

import { collectNumericIssues } from '@/features/survey-response/lib/numeric-validation';
import { expandRepeatRows } from '@/lib/question/row-repeat';
import type { Question, RowRepeatConfig, SumConstraint, TableCell, TableRow } from '@/types/survey';

/**
 * 행 반복 — 「적기 시작한 벌도 1벌처럼 필수」(requireStartedBundles)와 벌마다 제약(perRepeatBundle).
 * 2026-11-04 유가공업 문1: 2벌에 연도만 고르고 품목을 비워도 넘어가던 것을 막는다. 빈 채로 열어 둔 벌은 막지 않는다.
 */
const sel = (id: string): TableCell => ({
  id,
  type: 'select',
  content: '',
  required: true,
  selectOptions: [{ id: `${id}-o`, label: '2024', value: '2024' }],
});
const input = (id: string, required = false): TableCell => ({ id, type: 'input', content: '', inputType: 'number', required });
const seed: TableRow[] = [
  { id: 'dom', label: '국내산', rowCode: 'r01', cells: [sel('year'), input('qty', true), input('milk')] },
  { id: 'imp', label: '수입산', rowCode: 'r02', cells: [{ id: 'blank', type: 'text', content: '' }, { id: 'blank2', type: 'text', content: '' }, input('milk2')] },
];
const raw: SumConstraint = { id: 'raw', aggregate: 'count', cellIds: ['milk', 'milk2'], operator: 'gte', target: 1, perRepeatBundle: true, errorMessage: '원료 투입량을 한 칸 이상' };

function build(config: RowRepeatConfig, sumConstraints: SumConstraint[] = []) {
  let n = 0;
  const rows = expandRepeatRows(seed, config, () => `g${++n}`);
  const q = {
    id: 'q1', type: 'table', title: '표', required: false, order: 0,
    tableColumns: [{ id: 'c1', label: '연도' }, { id: 'c2', label: '생산량' }, { id: 'c3', label: '원유' }],
    tableRowsData: rows, rowRepeatConfig: config, sumConstraints,
  } as unknown as Question;
  const cellOf = (bundle: number, row: 0 | 1, i: number) => rows.filter((r) => r.repeatIndex === bundle)[row]!.cells[i]!.id;
  return { q, cellOf };
}
const kinds = (issues: ReturnType<typeof collectNumericIssues>) => issues.map((i) => i.kind);
const filledBundle1 = (cellOf: (b: number, r: 0 | 1, i: number) => string) => ({
  [cellOf(1, 0, 0)]: '2024', [cellOf(1, 0, 1)]: '10', [cellOf(1, 0, 2)]: '5',
});

describe('적기 시작한 벌도 1벌처럼 필수', () => {
  const on: RowRepeatConfig = { enabled: true, templateRowIds: ['dom', 'imp'], maxRepeats: 3, requireStartedBundles: true };

  it('2벌에 연도만 고르고 생산량을 비우면 막는다', () => {
    const { q, cellOf } = build(on);
    const issues = collectNumericIssues(q, { ...filledBundle1(cellOf), [cellOf(2, 0, 0)]: '2024' }, undefined);
    expect(kinds(issues)).toContain('required-cells');
  });

  it('빈 채로 열어 둔 벌은 막지 않는다', () => {
    const { q, cellOf } = build(on);
    expect(collectNumericIssues(q, filledBundle1(cellOf), undefined)).toEqual([]);
  });

  it('설정을 끄면(기본) 종전대로 2벌은 필수가 아니다', () => {
    const { q, cellOf } = build({ enabled: true, templateRowIds: ['dom', 'imp'], maxRepeats: 3 });
    expect(collectNumericIssues(q, { ...filledBundle1(cellOf), [cellOf(2, 0, 0)]: '2024' }, undefined)).toEqual([]);
  });
});

describe('벌마다 제약 — 원료 투입량 한 칸 이상', () => {
  const cfg: RowRepeatConfig = { enabled: true, templateRowIds: ['dom', 'imp'], maxRepeats: 3, requireStartedBundles: true };

  it('1벌에 원료가 하나도 없으면 막는다', () => {
    const { q, cellOf } = build(cfg, [raw]);
    const v = { [cellOf(1, 0, 0)]: '2024', [cellOf(1, 0, 1)]: '10' };
    expect(collectNumericIssues(q, v, undefined).map((i) => i.message)).toContain('원료 투입량을 한 칸 이상');
  });

  it('적기 시작한 2벌에 원료가 없으면 그 벌 칸을 짚어 막는다 — 수입산만 있어도 통과', () => {
    const { q, cellOf } = build(cfg, [raw]);
    const started = { ...filledBundle1(cellOf), [cellOf(2, 0, 0)]: '2024', [cellOf(2, 0, 1)]: '3' };
    const issues = collectNumericIssues(q, started, undefined);
    const rawIssue = issues.find((i) => i.message === '원료 투입량을 한 칸 이상');
    expect(rawIssue?.cellIds).toEqual(expect.arrayContaining([cellOf(2, 0, 2), cellOf(2, 1, 2)]));
    expect(collectNumericIssues(q, { ...started, [cellOf(2, 1, 2)]: '7' }, undefined)).toEqual([]);
  });

  it('빈 채로 열어 둔 벌에는 걸지 않는다', () => {
    const { q, cellOf } = build(cfg, [raw]);
    expect(collectNumericIssues(q, filledBundle1(cellOf), undefined)).toEqual([]);
  });
});
