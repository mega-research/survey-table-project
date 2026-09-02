import { describe, expect, it } from 'vitest';

import type { TableRow } from '@/types/survey';

import { collectPiiCellIds } from './pii-cells';

const rows: TableRow[] = [
  {
    id: 'r1',
    label: '1행',
    cells: [
      { id: 'c1', type: 'input', content: '', piiEncrypted: true },
      { id: 'c2', type: 'input', content: '' },
      { id: 'c3', type: 'text', content: '라벨', piiEncrypted: true },
    ],
  },
  {
    id: 'r2',
    label: '2행',
    cells: [{ id: 'c4', type: 'input', content: '', piiEncrypted: true }],
  },
];

describe('collectPiiCellIds — 표에서 암호화 대상 input 셀 id 수집', () => {
  it('piiEncrypted 가 켜진 input 셀만 행 순서대로', () => {
    expect(collectPiiCellIds(rows)).toEqual(['c1', 'c4']);
  });

  it('행 데이터가 없으면 빈 배열', () => {
    expect(collectPiiCellIds(undefined)).toEqual([]);
    expect(collectPiiCellIds(null)).toEqual([]);
  });
});
