import { describe, expect, it } from 'vitest';

import type { TableCell, TableRow } from '@/types/survey';

import { applyDistinctGroupToColumn, countColumnDistinctGroupTargets } from './column-distinct-group';

/**
 * 중복 불가 묶음 이름의 열 단위 일괄 지정 — 같은 열을 따라 내려가는 선택 칸 전부에
 * 같은 이름을 한 번에 건다(12칸에 일일이 적다 빠뜨리지 않게).
 */

function select(id: string, extra: Partial<TableCell> = {}): TableCell {
  return { id, type: 'select', content: '', selectOptions: [], ...extra };
}

/** 열 0 = 2025년 국가(선택), 열 1 = 비중(입력). 셋째 행의 열 0 은 병합에 가려져 있고 넷째는 글자 칸. */
const rows: TableRow[] = [
  { id: 'r1', label: '1', cells: [select('a1'), { id: 'p1', type: 'input', content: '' }] },
  { id: 'r2', label: '2', cells: [select('a2', { distinctGroup: '옛이름' }), select('b2')] },
  { id: 'r3', label: '3', cells: [select('a3', { isHidden: true }), select('b3')] },
  { id: 'r4', label: '4', cells: [{ id: 'a4', type: 'text', content: '합계' }, select('b4')] },
];

function groups(result: TableRow[]): Record<string, string | undefined> {
  return Object.fromEntries(
    result.flatMap((row) => row.cells.map((cell) => [cell.id, cell.distinctGroup])),
  );
}

describe('applyDistinctGroupToColumn', () => {
  it('같은 열의 다른 선택 칸에 이름을 건다 — 기준 칸·다른 열·다른 유형·가려진 칸은 그대로', () => {
    const result = applyDistinctGroupToColumn(rows, 'a1', '수출국가-2025');
    expect(groups(result)).toEqual({
      a1: undefined, // 기준 칸은 모달 저장이 쓴다
      p1: undefined,
      a2: '수출국가-2025',
      b2: undefined,
      a3: undefined, // 병합에 가려진 칸
      b3: undefined,
      a4: undefined, // 글자 칸
      b4: undefined,
    });
  });

  it('값이 undefined 면 같은 열 선택 칸의 이름을 지운다', () => {
    const result = applyDistinctGroupToColumn(rows, 'a1', undefined);
    expect('distinctGroup' in result[1]!.cells[0]!).toBe(false);
  });

  it('기준 칸을 못 찾으면 그대로 돌려준다', () => {
    expect(applyDistinctGroupToColumn(rows, 'nope', 'x')).toBe(rows);
  });
});

describe('countColumnDistinctGroupTargets', () => {
  it('일괄 적용이 바꿀 칸 수 — 기준 칸 자신은 세지 않는다', () => {
    expect(countColumnDistinctGroupTargets(rows, 'a1')).toBe(1);
    expect(countColumnDistinctGroupTargets(rows, 'b2')).toBe(2);
    expect(countColumnDistinctGroupTargets(rows, 'nope')).toBe(0);
  });
});
