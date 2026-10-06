import { describe, expect, it } from 'vitest';

import type { StagedRowsConfig, TableCell, TableRow } from '@/types/survey';

import {
  cellIdsOfStagedRowAt,
  deriveOpenStagedCount,
  hiddenStagedRowIds,
  isStagedRowsActive,
  stagedOptionalCellIds,
  stagedRowCount,
} from './staged-rows';

function inputRow(id: string, cellIds: string[]): TableRow {
  return {
    id,
    label: id,
    cells: cellIds.map((cellId): TableCell => ({ id: cellId, content: '', type: 'input' })),
  };
}

/** 머리 행 1개 + 묶음 4행(행당 2칸) + 꼬리 행 1개 */
const rows: TableRow[] = [
  inputRow('head', ['h1']),
  inputRow('s1', ['s1a', 's1b']),
  inputRow('s2', ['s2a', 's2b']),
  inputRow('s3', ['s3a', 's3b']),
  inputRow('s4', ['s4a', 's4b']),
  inputRow('tail', ['t1']),
];

const config: StagedRowsConfig = {
  enabled: true,
  rowIds: ['s1', 's2', 's3', 's4'],
  initialVisibleCount: 2,
};

describe('deriveOpenStagedCount — 값에서 파생하는 열린 행 수', () => {
  it('값이 없으면 처음 보이는 행 수', () => {
    expect(deriveOpenStagedCount(rows, config, {})).toBe(2);
  });

  it('값이 있는 마지막 묶음 행까지 연다 — 사이 행이 비어 있어도', () => {
    expect(deriveOpenStagedCount(rows, config, { s4b: '40' })).toBe(4);
  });

  it('빈 문자열·빈 배열은 값으로 치지 않는다', () => {
    expect(deriveOpenStagedCount(rows, config, { s3a: '  ', s4a: [] })).toBe(2);
  });

  it('셀 게이팅으로 닫힌 칸의 값은 없는 것으로 친다', () => {
    const gated: TableRow[] = rows.map((row) =>
      row.id === 's4'
        ? {
            ...row,
            cells: row.cells.map((cell) => ({
              ...cell,
              enabledWhen: { kind: 'numeric', op: '>', value: 0, controllerCellId: 'h1' } as const,
            })),
          }
        : row,
    );
    expect(deriveOpenStagedCount(gated, config, { s4a: '잔존' })).toBe(2);
    expect(deriveOpenStagedCount(gated, config, { h1: '10', s4a: '값' })).toBe(4);
  });

  it('처음 보이는 행 수는 1 이상 · 묶음 행 수 이하로 다듬는다', () => {
    expect(deriveOpenStagedCount(rows, { ...config, initialVisibleCount: 0 }, {})).toBe(1);
    expect(deriveOpenStagedCount(rows, { ...config, initialVisibleCount: 99 }, {})).toBe(4);
  });

  it('표에 없는 행 id 는 묶음에서 빠진다', () => {
    const stale = { ...config, rowIds: ['s1', 'gone', 's2', 's3', 's4'], initialVisibleCount: 5 };
    expect(deriveOpenStagedCount(rows, stale, {})).toBe(4);
  });
});

describe('isStagedRowsActive', () => {
  it('켜져 있고 묶음 행이 있어야 활성이다', () => {
    expect(isStagedRowsActive(config)).toBe(true);
    expect(isStagedRowsActive({ ...config, enabled: false })).toBe(false);
    expect(isStagedRowsActive({ ...config, rowIds: [] })).toBe(false);
    expect(isStagedRowsActive(null)).toBe(false);
    expect(isStagedRowsActive(undefined)).toBe(false);
  });
});

describe('hiddenStagedRowIds — 열린 수 뒤의 묶음 행', () => {
  it('열린 수보다 뒤에 있는 묶음 행만 가린다 — 묶음 밖의 행은 건드리지 않는다', () => {
    expect([...hiddenStagedRowIds(rows, config, 2)]).toEqual(['s3', 's4']);
    expect([...hiddenStagedRowIds(rows, config, 3)]).toEqual(['s4']);
    expect(hiddenStagedRowIds(rows, config, 4).size).toBe(0);
  });

  it('묶음 행 수는 표에 실제로 있는 행만 센다', () => {
    expect(stagedRowCount(rows, config)).toBe(4);
    expect(stagedRowCount(rows, { ...config, rowIds: ['s1', 'gone'] })).toBe(1);
  });
});

describe('cellIdsOfStagedRowAt — 닫을 때 비울 칸', () => {
  it('순번(1부터)의 묶음 행에 든 모든 칸', () => {
    expect(cellIdsOfStagedRowAt(rows, config, 3)).toEqual(['s3a', 's3b']);
  });

  it('범위 밖 순번은 빈 목록', () => {
    expect(cellIdsOfStagedRowAt(rows, config, 0)).toEqual([]);
    expect(cellIdsOfStagedRowAt(rows, config, 5)).toEqual([]);
  });
});

describe('stagedOptionalCellIds — 필수에서 빼는 칸', () => {
  it('값에서 파생한 열린 수 뒤의 묶음 행 칸만 든다', () => {
    expect([...stagedOptionalCellIds(rows, config, {})].sort()).toEqual([
      's3a',
      's3b',
      's4a',
      's4b',
    ]);
    expect([...stagedOptionalCellIds(rows, config, { s3a: '값' })].sort()).toEqual(['s4a', 's4b']);
    expect(stagedOptionalCellIds(rows, config, { s4b: '값' }).size).toBe(0);
  });

  it('설정이 없거나 꺼져 있으면 빈 집합', () => {
    expect(stagedOptionalCellIds(rows, null, {}).size).toBe(0);
    expect(stagedOptionalCellIds(rows, { ...config, enabled: false }, {}).size).toBe(0);
    expect(stagedOptionalCellIds(undefined, config, {}).size).toBe(0);
  });
});
