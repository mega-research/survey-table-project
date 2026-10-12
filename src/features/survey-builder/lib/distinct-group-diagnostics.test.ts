import { describe, expect, it } from 'vitest';

import type { QuestionOption, TableCell, TableRow } from '@/types/survey';

import { diagnoseDistinctGroup } from './distinct-group-diagnostics';

/**
 * 중복 불가 묶음 빌더 경고 — 이름만 적어 두고 동작하지 않는 설정을 저작자에게 알린다.
 * 묶음은 이름이 같은 선택 칸이 둘 이상이고, 그 칸들의 보기 값이 겹쳐야 뜻이 있다.
 */

const COUNTRIES: QuestionOption[] = [
  { id: 'o1', label: '미국', value: 'us' },
  { id: 'o2', label: '일본', value: 'jp' },
];

function select(id: string, extra: Partial<TableCell> = {}): TableCell {
  return { id, type: 'select', content: '', selectOptions: COUNTRIES, ...extra };
}

const rows: TableRow[] = [
  { id: 'r1', label: '1', cells: [select('a1'), select('b1', { distinctGroup: '2026' })] },
  { id: 'r2', label: '2', cells: [select('a2', { distinctGroup: '2025' }), select('b2')] },
];

const base = { rows, cellId: 'a1', selectOptions: COUNTRIES, applyToColumn: false };

describe('diagnoseDistinctGroup', () => {
  it('이름이 없으면 경고도 없다', () => {
    expect(diagnoseDistinctGroup({ ...base, name: '  ' })).toBeNull();
  });

  it('같은 이름의 다른 선택 칸이 있고 보기 값이 겹치면 경고가 없다', () => {
    expect(diagnoseDistinctGroup({ ...base, name: '2025' })).toBeNull();
  });

  it('같은 이름의 다른 선택 칸이 없으면 혼자다', () => {
    expect(diagnoseDistinctGroup({ ...base, name: '새이름' })).toBe('alone');
  });

  it('같은 열에도 적용하면 그 열의 선택 칸이 구성원으로 들어온다', () => {
    expect(diagnoseDistinctGroup({ ...base, name: '새이름', applyToColumn: true })).toBeNull();
  });

  it('병합에 가려진 칸은 구성원으로 세지 않는다', () => {
    const hidden = rows.map((row) => ({
      ...row,
      cells: row.cells.map((cell) => (cell.id === 'a2' ? { ...cell, isHidden: true } : cell)),
    }));
    expect(diagnoseDistinctGroup({ ...base, rows: hidden, name: '2025' })).toBe('alone');
  });

  it('구성원은 있는데 겹치는 보기 값이 없으면 따로 알린다', () => {
    const others: QuestionOption[] = [{ id: 'x1', label: '미국', value: 'usa' }];
    expect(diagnoseDistinctGroup({ ...base, name: '2025', selectOptions: others })).toBe(
      'no-shared-options',
    );
  });

  it('보기에 값이 없으면 id 로 비교한다', () => {
    const noValue = [{ id: 'o1', label: '미국' }] as QuestionOption[];
    const table: TableRow[] = [
      {
        id: 'r1',
        label: '1',
        cells: [
          select('a1'),
          select('a2', { distinctGroup: 'g', selectOptions: [{ id: 'z9', label: '미국' }] as QuestionOption[] }),
        ],
      },
    ];
    expect(
      diagnoseDistinctGroup({ ...base, rows: table, name: 'g', selectOptions: noValue }),
    ).toBe('no-shared-options');
  });
});
