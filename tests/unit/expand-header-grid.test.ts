import { describe, it, expect } from 'vitest';

import { expandHeaderGrid } from '@/utils/expand-header-grid';
import type { HeaderCell } from '@/types/survey';

// ── 헤더 셀 빌더 ──
const HC = (id: string, cs = 1, rs = 1): HeaderCell => ({
  id,
  label: id,
  colspan: cs,
  rowspan: rs,
});

// 결과를 셀 id 기준으로 배치 좌표만 뽑아 비교 (표현 무관)
const place = (grid: HeaderCell[][]) =>
  expandHeaderGrid(grid).map((p) => ({
    id: p.cell.id,
    startCol: p.startCol,
    rowIdx: p.rowIdx,
    colSpan: p.colSpan,
    rowSpan: p.rowSpan,
    gridColumn: p.gridColumn,
    gridRow: p.gridRow,
  }));

describe('expandHeaderGrid', () => {
  it('단순 그리드 — 단일 행, 병합 없음', () => {
    const grid = [[HC('a'), HC('b'), HC('c')]];

    expect(place(grid)).toEqual([
      { id: 'a', startCol: 1, rowIdx: 0, colSpan: 1, rowSpan: 1, gridColumn: 1, gridRow: 1 },
      { id: 'b', startCol: 2, rowIdx: 0, colSpan: 1, rowSpan: 1, gridColumn: 2, gridRow: 1 },
      { id: 'c', startCol: 3, rowIdx: 0, colSpan: 1, rowSpan: 1, gridColumn: 3, gridRow: 1 },
    ]);
  });

  it('colspan 병합 — 다음 셀 시작 열이 병합 폭만큼 밀린다', () => {
    const grid = [[HC('a', 2), HC('b'), HC('c')]];

    expect(place(grid)).toEqual([
      {
        id: 'a',
        startCol: 1,
        rowIdx: 0,
        colSpan: 2,
        rowSpan: 1,
        gridColumn: '1 / span 2',
        gridRow: 1,
      },
      { id: 'b', startCol: 3, rowIdx: 0, colSpan: 1, rowSpan: 1, gridColumn: 3, gridRow: 1 },
      { id: 'c', startCol: 4, rowIdx: 0, colSpan: 1, rowSpan: 1, gridColumn: 4, gridRow: 1 },
    ]);
  });

  it('rowspan 병합 — 아래 행이 점유 열을 건너뛴다', () => {
    // 첫 열이 2행 세로 병합. 둘째 행 첫 셀은 col 1을 건너뛰고 col 2에 배치.
    const grid = [
      [HC('a', 1, 2), HC('b')],
      [HC('c')],
    ];

    expect(place(grid)).toEqual([
      {
        id: 'a',
        startCol: 1,
        rowIdx: 0,
        colSpan: 1,
        rowSpan: 2,
        gridColumn: 1,
        gridRow: '1 / span 2',
      },
      { id: 'b', startCol: 2, rowIdx: 0, colSpan: 1, rowSpan: 1, gridColumn: 2, gridRow: 1 },
      { id: 'c', startCol: 2, rowIdx: 1, colSpan: 1, rowSpan: 1, gridColumn: 2, gridRow: 2 },
    ]);
  });

  it('복합 병합 — colspan + rowspan 혼합 2행 그리드', () => {
    // 행0: 대분류(colspan 2) + 단일열(rowspan 2)
    // 행1: 대분류 아래 소분류 2칸. rowspan 단일열은 점유로 건너뜀.
    const grid = [
      [HC('grp', 2), HC('side', 1, 2)],
      [HC('s1'), HC('s2')],
    ];

    expect(place(grid)).toEqual([
      {
        id: 'grp',
        startCol: 1,
        rowIdx: 0,
        colSpan: 2,
        rowSpan: 1,
        gridColumn: '1 / span 2',
        gridRow: 1,
      },
      {
        id: 'side',
        startCol: 3,
        rowIdx: 0,
        colSpan: 1,
        rowSpan: 2,
        gridColumn: 3,
        gridRow: '1 / span 2',
      },
      { id: 's1', startCol: 1, rowIdx: 1, colSpan: 1, rowSpan: 1, gridColumn: 1, gridRow: 2 },
      { id: 's2', startCol: 2, rowIdx: 1, colSpan: 1, rowSpan: 1, gridColumn: 2, gridRow: 2 },
    ]);
  });

  it('rowspan + colspan 동시 점유 — 아래 행이 병합 폭 전체를 건너뛴다', () => {
    // 행0 첫 셀이 colspan 2 + rowspan 2. 행1은 col 1,2를 모두 건너뛰고 col 3부터 배치.
    const grid = [
      [HC('big', 2, 2), HC('top')],
      [HC('bottom')],
    ];

    expect(place(grid)).toEqual([
      {
        id: 'big',
        startCol: 1,
        rowIdx: 0,
        colSpan: 2,
        rowSpan: 2,
        gridColumn: '1 / span 2',
        gridRow: '1 / span 2',
      },
      { id: 'top', startCol: 3, rowIdx: 0, colSpan: 1, rowSpan: 1, gridColumn: 3, gridRow: 1 },
      { id: 'bottom', startCol: 3, rowIdx: 1, colSpan: 1, rowSpan: 1, gridColumn: 3, gridRow: 2 },
    ]);
  });
});
