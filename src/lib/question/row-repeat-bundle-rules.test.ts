import { describe, expect, it } from 'vitest';

import type { Question, RowRepeatConfig, SumConstraint, TableCell, TableRow } from '@/types/survey';

import { expandRepeatRows, resolveBundleSumConstraints, startedRepeatBundles, validateRowRepeatTemplate } from './row-repeat';

/**
 * 적기 시작한 벌 — 값이 하나라도 든 2벌 이후. 빈 채로 열어 둔 벌은 안 쓴 것이다(2026-11-04 사용자 결정).
 * 벌마다 제약(`SumConstraint.perRepeatBundle`) — 1벌 칸으로 만든 제약을 1벌과 적기 시작한 벌마다 복제해 검사한다.
 */
const input = (id: string): TableCell => ({ id, type: 'input', content: '' });
const label = (id: string): TableCell => ({ id, type: 'text', content: '구분' });
const seed: TableRow[] = [
  { id: 'dom', label: '국내산', rowCode: 'r01', cells: [input('year'), label('lab'), input('milk')] },
  { id: 'imp', label: '수입산', rowCode: 'r02', cells: [label('y2'), label('lab2'), input('milk2')] },
];
const config: RowRepeatConfig = { enabled: true, templateRowIds: ['dom', 'imp'], maxRepeats: 3 };
let n = 0;
const rows = expandRepeatRows(seed, config, () => `g${++n}`);
const cellOf = (bundle: number, row: 0 | 1, i: number) =>
  rows.filter((r) => r.repeatIndex === bundle)[row]!.cells[i]!.id;
const constraint: SumConstraint = {
  id: 'raw',
  aggregate: 'count',
  cellIds: ['milk', 'milk2'],
  operator: 'gte',
  target: 1,
  perRepeatBundle: true,
};
const question = (sumConstraints: SumConstraint[]) =>
  ({ id: 'q', type: 'table', tableRowsData: rows, rowRepeatConfig: config, sumConstraints }) as unknown as Question;

describe('startedRepeatBundles', () => {
  it('값이 든 2벌 이후만 — 글자 칸은 세지 않는다', () => {
    expect([...startedRepeatBundles(rows, {})]).toEqual([]);
    expect([...startedRepeatBundles(rows, { [cellOf(3, 1, 2)]: '5' })]).toEqual([3]);
    expect([...startedRepeatBundles(rows, { [cellOf(2, 0, 0)]: '' })]).toEqual([]);
  });
});

describe('resolveBundleSumConstraints', () => {
  it('벌마다 제약은 1벌 + 적기 시작한 벌로 복제되고 칸 id 가 그 벌로 옮겨간다', () => {
    const out = resolveBundleSumConstraints(question([constraint]), { [cellOf(2, 0, 0)]: '2024' });
    expect(out.map((c) => c.cellIds)).toEqual([
      ['milk', 'milk2'],
      [cellOf(2, 0, 2), cellOf(2, 1, 2)],
    ]);
    expect(new Set(out.map((c) => c.id)).size).toBe(2);
  });

  it('빈 채로 열어 둔 벌·안 연 벌에는 걸지 않는다', () => {
    expect(resolveBundleSumConstraints(question([constraint]), {})).toHaveLength(1);
  });

  it('벌마다 표식이 없는 제약은 그대로 둔다', () => {
    const { perRepeatBundle: _p, ...plain } = constraint;
    expect(resolveBundleSumConstraints(question([plain]), { [cellOf(2, 0, 0)]: '2024' })).toEqual([plain]);
  });
});

describe('validateRowRepeatTemplate — 벌마다 제약', () => {
  it('블록 안 칸만 가리키는 벌마다 제약은 막지 않는다', () => {
    const q = { tableRowsData: seed, sumConstraints: [constraint] } as unknown as Question;
    expect(validateRowRepeatTemplate(q, ['dom', 'imp'])).toEqual([]);
  });

  it('벌마다 표식이 없는 제약은 여전히 막는다', () => {
    const q = { tableRowsData: seed, sumConstraints: [{ id: 'raw', aggregate: 'count', cellIds: ['milk', 'milk2'], operator: 'gte', target: 1 }] } as unknown as Question;
    expect(validateRowRepeatTemplate(q, ['dom', 'imp']).map((v) => v.kind)).toContain('sum-constraint');
  });
});
