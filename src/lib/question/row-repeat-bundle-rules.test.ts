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

describe('묶음마다 수식·적용 조건 (경고 제약)', () => {
  // 출고(milk) ≤ 생산(year 자리 칸) × 2, 조건: year 칸이 채워졌을 때
  const exprConstraint: SumConstraint = {
    id: 'warn',
    cellIds: [],
    leftExpr: { kind: 'cell', cellId: 'milk' },
    targetExpr: { kind: 'group', op: '*', terms: [{ kind: 'cell', cellId: 'year' }, { kind: 'literal', value: 2 }] },
    operator: 'lte',
    target: 0,
    perRepeatBundle: true,
    severity: 'warn',
    when: { kind: 'filled', controllerCellId: 'milk2' },
  };

  it('수식 셀 참조와 조건 컨트롤러가 그 벌의 칸으로 옮겨간다', () => {
    const out = resolveBundleSumConstraints(question([exprConstraint]), { [cellOf(3, 0, 0)]: '10' });
    const b3 = out.find((c) => c.id === 'warn#3')!;
    expect(b3.leftExpr).toEqual({ kind: 'cell', cellId: cellOf(3, 0, 2) });
    expect(b3.targetExpr).toEqual({
      kind: 'group',
      op: '*',
      terms: [{ kind: 'cell', cellId: cellOf(3, 0, 0) }, { kind: 'literal', value: 2 }],
    });
    expect(b3.when).toEqual({ kind: 'filled', controllerCellId: cellOf(3, 1, 2) });
    expect(b3.severity).toBe('warn');
    // 1벌은 원본 그대로
    expect(out.find((c) => c.id === 'warn')).toBe(exprConstraint);
  });

  it('다른 질문을 가리키는 수식 항과 블록 밖 칸은 그대로 둔다', () => {
    const c: SumConstraint = {
      ...exprConstraint,
      targetExpr: { kind: 'cell', questionId: 'other', cellId: 'year' },
      when: { kind: 'filled', controllerCellId: 'outside' },
    };
    const b2 = resolveBundleSumConstraints(question([c]), { [cellOf(2, 0, 0)]: '1' }).find((x) => x.id === 'warn#2')!;
    expect(b2.targetExpr).toEqual({ kind: 'cell', questionId: 'other', cellId: 'year' });
    expect(b2.when).toEqual({ kind: 'filled', controllerCellId: 'outside' });
  });

  it('블록 안 칸만 가리키는 벌마다 수식 제약은 막지 않고, 블록 밖 조건이 섞이면 막는다', () => {
    const ok = { tableRowsData: seed, sumConstraints: [exprConstraint] } as unknown as Question;
    expect(validateRowRepeatTemplate(ok, ['dom', 'imp'])).toEqual([]);
    const mixed = {
      tableRowsData: [...seed, { id: 'out', label: '밖', cells: [input('outside'), label('l3'), input('o3')] }],
      sumConstraints: [{ ...exprConstraint, when: { kind: 'filled', controllerCellId: 'outside' } }],
    } as unknown as Question;
    expect(validateRowRepeatTemplate(mixed, ['dom', 'imp']).map((v) => v.kind)).toContain('sum-constraint');
  });

  it('벌마다가 아닌데 수식이 블록 칸을 가리키면 막는다 — 1벌만 검사되는 것을 막는다', () => {
    const { perRepeatBundle: _p, ...plain } = exprConstraint;
    const q = { tableRowsData: seed, sumConstraints: [plain] } as unknown as Question;
    expect(validateRowRepeatTemplate(q, ['dom', 'imp']).map((v) => v.kind)).toContain('sum-constraint');
  });
});
