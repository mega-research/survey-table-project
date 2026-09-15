import { describe, expect, it } from 'vitest';

import type { TableCell, TableRow } from '@/types/survey';

import {
  cellIdsOfBundlesBeyond,
  deriveOpenRepeatCount,
  hiddenRepeatRowIds,
  structuralRepeatCount,
} from './row-repeat';

function bundleRow(bundle: number, cellIds: string[]): TableRow {
  return {
    id: `row${bundle}`,
    label: `행 ${bundle}`,
    repeatIndex: bundle,
    repeatSourceRowId: 'tpl',
    cells: cellIds.map((id): TableCell => ({ id, content: '', type: 'input' })),
  };
}

/** 비반복 행 1개 + 3벌(벌당 2칸) */
const rows: TableRow[] = [
  { id: 'head', label: '머리', cells: [{ id: 'h1', content: '', type: 'input' }] },
  bundleRow(1, ['b1c1', 'b1c2']),
  bundleRow(2, ['b2c1', 'b2c2']),
  bundleRow(3, ['b3c1', 'b3c2']),
];

describe('deriveOpenRepeatCount — 값에서 파생하는 열린 벌 수', () => {
  it('값이 전혀 없으면 1벌', () => {
    expect(deriveOpenRepeatCount(rows, {})).toBe(1);
  });

  it('1벌만 채웠으면 1벌', () => {
    expect(deriveOpenRepeatCount(rows, { b1c1: '논문' })).toBe(1);
  });

  it('값이 들어 있는 마지막 벌까지 연다', () => {
    expect(deriveOpenRepeatCount(rows, { b1c1: '가', b3c2: '다' })).toBe(3);
  });

  it('중간 벌만 채워져 있어도 그 벌까지 연다 — 위 벌은 비어 있어도 보인다', () => {
    expect(deriveOpenRepeatCount(rows, { b2c1: '나' })).toBe(2);
  });

  it('빈 문자열·빈 배열은 값으로 치지 않는다', () => {
    expect(deriveOpenRepeatCount(rows, { b2c1: '  ', b3c1: [] })).toBe(1);
  });

  it('반복 행이 없는 표는 1을 돌려준다', () => {
    expect(deriveOpenRepeatCount([rows[0]!], { h1: '값' })).toBe(1);
  });
});

describe('structuralRepeatCount', () => {
  it('구조에 펼쳐진 최대 벌 수를 센다', () => {
    expect(structuralRepeatCount(rows)).toBe(3);
    expect(structuralRepeatCount([rows[0]!])).toBe(0);
  });
});

describe('hiddenRepeatRowIds', () => {
  it('열린 벌보다 뒤에 있는 반복 행만 숨긴다', () => {
    expect(hiddenRepeatRowIds(rows, 1)).toEqual(new Set(['row2', 'row3']));
    expect(hiddenRepeatRowIds(rows, 3)).toEqual(new Set());
  });

  it('비반복 행은 절대 숨기지 않는다', () => {
    expect(hiddenRepeatRowIds(rows, 0).has('head')).toBe(false);
  });
});

describe('cellIdsOfBundlesBeyond — 접을 때 비울 셀', () => {
  it('지정한 벌보다 뒤에 있는 벌의 셀 id 를 모은다', () => {
    expect(cellIdsOfBundlesBeyond(rows, 1)).toEqual(['b2c1', 'b2c2', 'b3c1', 'b3c2']);
  });

  it('마지막 벌까지 열려 있으면 비울 셀이 없다', () => {
    expect(cellIdsOfBundlesBeyond(rows, 3)).toEqual([]);
  });
});
