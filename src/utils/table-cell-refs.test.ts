import { describe, expect, it } from 'vitest';

import type { TableCell } from '@/types/survey';

import { remapCellRefs } from './table-cell-refs';

describe('remapCellRefs — 목록에서 찾기 채우기 대상', () => {
  const cell: TableCell = {
    id: 'name',
    type: 'input',
    content: '',
    lookupSearch: {
      lookupId: 'lut-1',
      labelColumn: '기업명',
      fills: [
        { column: '법인등록번호', cellId: 'corp' },
        { column: '사업자등록번호', cellId: 'outside' },
      ],
    },
  };

  it('대응표에 있는 칸은 새 id 로, 없는 칸은 그대로 둔다', () => {
    const next = remapCellRefs(cell, new Map([['corp', 'corp-copy']]));
    expect(next.lookupSearch?.fills).toEqual([
      { column: '법인등록번호', cellId: 'corp-copy' },
      { column: '사업자등록번호', cellId: 'outside' },
    ]);
    expect(cell.lookupSearch?.fills?.[0]?.cellId).toBe('corp');
  });

  it('바뀔 것이 없으면 원본 참조를 돌려준다', () => {
    expect(remapCellRefs(cell, new Map([['other', 'x']]))).toBe(cell);
  });
});
