import { describe, expect, it } from 'vitest';

import type { StagedRowsConfig, TableCell, TableRow } from '@/types/survey';

import {
  cellIdsOfStagedRowAt,
  deriveOpenStagedCount,
  hiddenStagedRowIds,
  isStagedRowsActive,
  isStagedRowsIntact,
  remapStagedRowIds,
  resolveStagedRows,
  stagedOptionalCellIds,
  stagedRowCount,
  validateStagedRows,
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

  it('계산 칸의 저장값은 응답으로 치지 않는다 — 저장 뒤 다시 들어와도 열린 수가 같다', () => {
    // 저장 경계는 계산 칸의 값을 응답에 주입한다(빈 행도 '0'). 그 값을 응답으로 세면 저장 전에는
    // 닫혀 있던 행이 재진입 때 열리고, 그 행의 필수 칸이 「다음」을 막는다.
    const withCalc: TableRow[] = rows.map((row) =>
      row.id === 's3' || row.id === 's4'
        ? { ...row, cells: [row.cells[0]!, { id: `${row.id}calc`, content: '', type: 'calc' }] }
        : row,
    );
    expect(deriveOpenStagedCount(withCalc, config, { s3calc: '0', s4calc: '0' })).toBe(2);
    expect(deriveOpenStagedCount(withCalc, config, { s3a: '5', s3calc: '5', s4calc: '0' })).toBe(3);
    expect([...stagedOptionalCellIds(withCalc, config, { s3calc: '0', s4calc: '0' })].sort()).toEqual(
      ['s3a', 's3calc', 's4a', 's4calc'],
    );
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

describe('validateStagedRows — 묶음으로 지정해도 되는가', () => {
  const kinds = (rowIds: string[], initialVisibleCount: number, table = rows) =>
    validateStagedRows(table, { rowIds, initialVisibleCount }).map((v) => v.kind);

  it('연속된 평범한 행 묶음은 통과한다', () => {
    expect(kinds(['s1', 's2', 's3', 's4'], 2)).toEqual([]);
  });

  it('빈 묶음', () => {
    expect(kinds([], 1)).toEqual(['empty']);
  });

  it('표에 없는 행', () => {
    expect(kinds(['s1', 'gone'], 1)).toEqual(['unknown-row']);
  });

  it('붙어 있지 않은 행', () => {
    expect(kinds(['s1', 's3'], 1)).toEqual(['not-contiguous']);
  });

  it('처음 보이는 행 수가 묶음 행 수와 같거나 크면 열 것이 없다', () => {
    expect(kinds(['s1', 's2'], 2)).toEqual(['initial-count']);
    expect(kinds(['s1', 's2'], 0)).toEqual(['initial-count']);
    expect(kinds(['s1', 's2'], 1.5)).toEqual(['initial-count']);
  });

  it('보기 옵션 칸 · 순위 옵션 칸이 든 행은 넣을 수 없다 — 그 선택은 칸 값이 아닌 곳에 산다', () => {
    // 보기 그룹 선택은 표 응답 안 예약 키에, 순위 옵션은 문항 응답에 저장된다. 열린 수 파생·닫을 때
    // 값 비우기·필수 범위가 전부 「행의 칸 값」을 보므로 이런 행을 묶으면 닫아도 선택이 남는다.
    const choiceRow: TableRow = {
      id: 's2',
      label: 's2',
      cells: [{ id: 'opt', content: '①', type: 'choice_opt', choiceGroupId: 'g1' }],
    };
    const rankRow: TableRow = {
      id: 's3',
      label: 's3',
      cells: [{ id: 'rk', content: '가', type: 'ranking_opt' }],
    };
    const table = [rows[0]!, rows[1]!, choiceRow, rankRow, rows[4]!, rows[5]!];
    const violations = validateStagedRows(table, {
      rowIds: ['s1', 's2', 's3', 's4'],
      initialVisibleCount: 1,
    });
    expect(violations.map((v) => v.kind)).toEqual(['choice-cell']);
    expect(violations[0]!.rowIds).toEqual(['s2', 's3']);
    expect(isStagedRowsIntact(table, { ...config, initialVisibleCount: 1 })).toBe(false);
  });

  it('행 반복 행 · 동적 행 그룹 행 · 표시 조건이 걸린 행은 넣을 수 없다', () => {
    const table: TableRow[] = [
      { ...rows[1]!, repeatIndex: 1 },
      { ...rows[2]!, dynamicGroupId: 'g1' },
      { ...rows[3]!, displayCondition: { logicType: 'AND', conditions: [] } },
      rows[4]!,
    ];
    const violations = validateStagedRows(table, {
      rowIds: ['s1', 's2', 's3', 's4'],
      initialVisibleCount: 1,
    });
    expect(violations.map((v) => v.kind).sort()).toEqual([
      'display-condition',
      'dynamic-row',
      'row-repeat',
    ]);
    expect(violations.find((v) => v.kind === 'row-repeat')!.rowIds).toEqual(['s1']);
  });
});

describe('isStagedRowsIntact — 표가 바뀐 뒤에도 묶음이 성립하는가', () => {
  it('묶음 행이 전부 살아 있고 붙어 있으면 성립한다', () => {
    expect(isStagedRowsIntact(rows, config)).toBe(true);
  });

  it('묶음 밖의 행을 지우거나 옮겨도 성립한다', () => {
    expect(isStagedRowsIntact(rows.slice(1), config)).toBe(true);
    expect(isStagedRowsIntact([rows[5]!, ...rows.slice(0, 5)], config)).toBe(true);
  });

  it('묶음 행이 지워지면 깨진다', () => {
    expect(isStagedRowsIntact(rows.filter((row) => row.id !== 's3'), config)).toBe(false);
  });

  it('묶음 사이에 다른 행이 끼면 깨진다', () => {
    const interleaved = [rows[1]!, rows[0]!, rows[2]!, rows[3]!, rows[4]!];
    expect(isStagedRowsIntact(interleaved, config)).toBe(false);
  });

  it('묶음 행이 행 반복 블록이 되거나 표시 조건·동적 행 그룹이 붙으면 깨진다', () => {
    const withRepeat = rows.map((row) => (row.id === 's2' ? { ...row, repeatIndex: 1 } : row));
    const withCondition = rows.map((row) =>
      row.id === 's2' ? { ...row, displayCondition: { logicType: 'AND', conditions: [] } } : row,
    ) as TableRow[];
    const withDynamic = rows.map((row) => (row.id === 's2' ? { ...row, dynamicGroupId: 'g' } : row));
    expect(isStagedRowsIntact(withRepeat, config)).toBe(false);
    expect(isStagedRowsIntact(withCondition, config)).toBe(false);
    expect(isStagedRowsIntact(withDynamic, config)).toBe(false);
  });

  it('꺼져 있거나 없는 설정은 깨질 것이 없다', () => {
    expect(isStagedRowsIntact([], null)).toBe(true);
    expect(isStagedRowsIntact([], { ...config, enabled: false })).toBe(true);
  });
});

describe('remapStagedRowIds — 행 id 가 새로 발번되는 경로', () => {
  it('대응표에 있는 행 id 를 새 id 로 옮긴다', () => {
    const map = new Map([
      ['s1', 'n1'],
      ['s2', 'n2'],
      ['s3', 'n3'],
      ['s4', 'n4'],
    ]);
    expect(remapStagedRowIds(config, map)).toEqual({ ...config, rowIds: ['n1', 'n2', 'n3', 'n4'] });
  });

  it('꺼져 있거나 없는 설정은 null', () => {
    expect(remapStagedRowIds(null, new Map())).toBeNull();
    expect(remapStagedRowIds({ ...config, enabled: false }, new Map())).toBeNull();
  });
});

describe('resolveStagedRows — 실제로 동작시킬 설정인가', () => {
  it('성립하는 설정은 그대로, 구조가 깨진 설정은 null (전부 보이는 쪽으로 물러난다)', () => {
    expect(resolveStagedRows(rows, config)).toBe(config);
    expect(resolveStagedRows(rows, null)).toBeNull();
    expect(resolveStagedRows(rows, { ...config, enabled: false })).toBeNull();
    // 묶음 행 하나가 사라졌거나 사이에 다른 행이 끼었다
    expect(resolveStagedRows(rows.filter((row) => row.id !== 's3'), config)).toBeNull();
    // 묶음 행에 보기 옵션 칸이 들어왔다
    const withChoice = rows.map((row) =>
      row.id === 's2'
        ? { ...row, cells: [{ id: 'opt', content: '①', type: 'choice_opt' as const }] }
        : row,
    );
    expect(resolveStagedRows(withChoice, config)).toBeNull();
    expect(stagedOptionalCellIds(withChoice, config, {}).size).toBe(0);
  });
});
