import { describe, expect, it } from 'vitest';

import type { HeaderCell, TableCell, TableRow } from '@/types/survey';

import {
  findColumnRevealHostId,
  listHeaderInputCandidates,
  resolveHeaderInputCells,
} from './header-input-cells';

const text = (id: string, content = ''): TableCell => ({ id, type: 'text', content });
const input = (id: string, extra: Partial<TableCell> = {}): TableCell => ({ id, type: 'input', content: '', ...extra });
const hc = (id: string, extra: Partial<HeaderCell> = {}): HeaderCell => ({ id, label: id, colspan: 1, rowspan: 1, ...extra });

/** 열 4개: 품목 | 원유 | 기타1 | 기타2 — 이름 줄(r0) 위, 본문 줄(r1) 아래 */
function table(nameRow: Partial<TableRow> = {}) {
  const rows: TableRow[] = [
    { id: 'r0', label: '기타 원료명', cells: [text('n0', '기타 원료명'), text('n1'), input('name1'), input('name2')], ...nameRow },
    { id: 'r1', label: '국내산', cells: [text('b0', '국내산'), input('q-raw'), input('q-e1'), input('q-e2')] },
  ];
  const headerGrid: HeaderCell[][] = [
    [hc('h-item', { rowspan: 2 }), hc('h-raw-all', { colspan: 3 })],
    [hc('h-raw'), hc('h-e1', { inputCellId: 'name1' }), hc('h-e2', { inputCellId: 'name2' })],
  ];
  return { rows, headerGrid };
}

describe('resolveHeaderInputCells', () => {
  it('머리글이 가리키는 이름 줄 칸을 연결하고, 글자 칸만 남는 이름 줄을 올린다', () => {
    const { rows, headerGrid } = table();
    const out = resolveHeaderInputCells(headerGrid, rows);
    expect([...out.cellByHeaderId].map(([h, c]) => [h, c.id])).toEqual([
      ['h-e1', 'name1'],
      ['h-e2', 'name2'],
    ]);
    expect([...out.hoistedRowIds]).toEqual(['r0']);
  });

  it('연결이 없는 표는 빈 결과 — 화면이 바뀌지 않는다', () => {
    const { rows } = table();
    const out = resolveHeaderInputCells([[hc('a'), hc('b'), hc('c'), hc('d')]], rows);
    expect(out.cellByHeaderId.size).toBe(0);
    expect(out.hoistedRowIds.size).toBe(0);
  });

  it('머리글 열과 칸 열이 다르면 무시한다', () => {
    const { rows, headerGrid } = table();
    headerGrid[1]![1] = hc('h-e1', { inputCellId: 'name2' }); // 기타1 머리글이 기타2 칸을 가리킴
    const out = resolveHeaderInputCells(headerGrid, rows);
    expect(out.cellByHeaderId.has('h-e1')).toBe(false);
    // 그 결과 name1 이 본문에 남으므로 이름 줄을 올리지 않고, 기타2 연결도 함께 무효
    expect(out.cellByHeaderId.size).toBe(0);
    expect(out.hoistedRowIds.size).toBe(0);
  });

  it('여러 열을 덮는 머리글·없는 칸·입력칸이 아닌 칸·병합 칸은 무시한다', () => {
    const { rows, headerGrid } = table();
    headerGrid[0]![1] = hc('h-raw-all', { colspan: 3, inputCellId: 'name1' });
    headerGrid[1]![2] = hc('h-e2', { inputCellId: 'ghost' });
    expect(resolveHeaderInputCells(headerGrid, rows).cellByHeaderId.has('h-raw-all')).toBe(false);
    expect(resolveHeaderInputCells(headerGrid, rows).cellByHeaderId.has('h-e2')).toBe(false);

    const t2 = table();
    t2.rows[0]!.cells[2] = { ...text('name1') };
    expect(resolveHeaderInputCells(t2.headerGrid, t2.rows).cellByHeaderId.has('h-e1')).toBe(false);
  });

  it('같은 칸을 두 머리글이 가리키면 앞의 것만', () => {
    const { rows } = table();
    const grid = [[hc('x', { inputCellId: 'name1' }), hc('y'), hc('z', { inputCellId: 'name1' }), hc('w', { inputCellId: 'name2' })]];
    // x 는 열이 안 맞아 무효, z 만 유효
    expect([...resolveHeaderInputCells(grid, rows).cellByHeaderId.keys()]).toEqual(['z', 'w']);
    const grid2 = [[hc('a'), hc('b'), hc('z1', { inputCellId: 'name1' }), hc('w', { inputCellId: 'name2' })], [hc('a2'), hc('b2'), hc('z2', { inputCellId: 'name1' }), hc('w2')]];
    expect([...resolveHeaderInputCells(grid2, rows).cellByHeaderId.keys()]).toEqual(['z1', 'w']);
  });

  it.each<[string, Partial<TableRow>]>([
    ['행 반복 줄', { repeatIndex: 1, repeatSourceRowId: 'r0' }],
    ['동적 행', { dynamicGroupId: 'g1' }],
    ['동적 그룹 소계 행', { showWhenDynamicGroupId: 'g1' }],
    ['표시 조건 행', { displayCondition: { logicType: 'AND', conditions: [] } }],
  ])('%s 칸은 올리지 않는다', (_name, extra) => {
    const { rows, headerGrid } = table(extra);
    const out = resolveHeaderInputCells(headerGrid, rows);
    expect(out.cellByHeaderId.size).toBe(0);
    expect(out.hoistedRowIds.size).toBe(0);
  });

  it('행 차례로 열기 묶음의 행은 올리지 않는다', () => {
    const { rows, headerGrid } = table();
    const out = resolveHeaderInputCells(headerGrid, rows, { enabled: true, rowIds: ['r0', 'r1'], initialVisibleCount: 1 });
    expect(out.hoistedRowIds.size).toBe(0);
  });

  it('연결되지 않은 입력칸이 남는 행은 올리지 않고, 그 행의 연결도 무효다(같은 값 입력칸 둘 방지)', () => {
    const { rows, headerGrid } = table();
    headerGrid[1]![2] = hc('h-e2'); // 기타2 는 연결 안 함 → name2 가 본문에 남는다
    const out = resolveHeaderInputCells(headerGrid, rows);
    expect(out.hoistedRowIds.size).toBe(0);
    expect(out.cellByHeaderId.size).toBe(0);
  });

  it('세로 병합이 걸린 행은 올리지 않는다', () => {
    const merged = table();
    merged.rows[0]!.cells[0] = { ...text('n0', '기타 원료명'), rowspan: 2 };
    merged.rows[1]!.cells[0] = { ...text('b0'), isHidden: true };
    expect(resolveHeaderInputCells(merged.headerGrid, merged.rows).hoistedRowIds.size).toBe(0);

    // 위 행의 세로 병합이 내려오는 행
    const below = table();
    const rows: TableRow[] = [
      { id: 'top', label: '', cells: [{ ...text('t0'), rowspan: 2 }, text('t1'), text('t2'), text('t3')] },
      { ...below.rows[0]!, cells: [{ ...text('n0'), isHidden: true }, text('n1'), input('name1'), input('name2')] },
      below.rows[1]!,
    ];
    expect(resolveHeaderInputCells(below.headerGrid, rows).hoistedRowIds.size).toBe(0);
  });

  it('가로 병합으로 숨은 칸은 글자 칸처럼 본다', () => {
    const { rows, headerGrid } = table();
    rows[0]!.cells[0] = { ...text('n0', '기타 원료명'), colspan: 2 };
    rows[0]!.cells[1] = { ...input('n1'), isHidden: true };
    expect([...resolveHeaderInputCells(headerGrid, rows).hoistedRowIds]).toEqual(['r0']);
  });
});

describe('findColumnRevealHostId', () => {
  it('열 추가 버튼 자리로 지정한 첫 머리글 칸', () => {
    expect(findColumnRevealHostId([[hc('a'), hc('b', { hostsColumnReveal: true })], [hc('c', { hostsColumnReveal: true })]])).toBe('b');
    expect(findColumnRevealHostId([[hc('a')]])).toBeNull();
    expect(findColumnRevealHostId(undefined)).toBeNull();
  });
});

describe('listHeaderInputCandidates', () => {
  it('그 열의 평범한 행 입력칸만 — 반복·동적 행과 글자 칸은 빠진다', () => {
    const { rows } = table();
    rows.push({ id: 'r-rep', label: '반복', repeatIndex: 1, repeatSourceRowId: 'r-rep', cells: [text('x0'), input('x1'), input('x2'), input('x3')] });
    rows.push({ id: 'r-dyn', label: '동적', dynamicGroupId: 'g', cells: [text('y0'), input('y1'), input('y2'), input('y3')] });
    expect(listHeaderInputCandidates(rows, 2).map((c) => c.cellId)).toEqual(['name1', 'q-e1']);
    expect(listHeaderInputCandidates(rows, 0)).toEqual([]);
  });

  it('목록 글자는 엑셀 라벨 → 모바일 라벨 → 행 이름', () => {
    const { rows } = table();
    rows[0]!.cells[2] = input('name1', { exportLabel: '기타1 원료명' });
    rows[0]!.cells[3] = input('name2', { mobileLabel: '기타2' });
    expect(listHeaderInputCandidates(rows, 2)[0]!.label).toBe('기타1 원료명');
    expect(listHeaderInputCandidates(rows, 3)[0]!.label).toBe('기타2');
    expect(listHeaderInputCandidates(rows, 3)[1]!.label).toBe('국내산');
  });
});
