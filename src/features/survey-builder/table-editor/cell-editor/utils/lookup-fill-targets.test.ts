import { describe, expect, it } from 'vitest';

import type { TableRow } from '@/types/survey';

import { listLookupFillTargets } from './lookup-fill-targets';

const rows: TableRow[] = [
  {
    id: 'r1',
    label: '',
    cells: [
      { id: 't1', type: 'text', content: '(1) 기업명' },
      { id: 'name', type: 'input', content: '' },
      { id: 'name-hidden', type: 'input', content: '', isHidden: true },
    ],
  },
  {
    id: 'r2',
    label: '번호',
    cells: [
      { id: 't2', type: 'text', content: '(8) 법인등록번호\n(13자리)' },
      { id: 'corp', type: 'input', content: '' },
      { id: 'r', type: 'radio', content: '' },
      { id: 'biz', type: 'input', content: '' },
    ],
  },
  {
    id: 'r3',
    label: '연락처',
    cells: [{ id: 'tel', type: 'input', content: '' }],
  },
];

describe('listLookupFillTargets', () => {
  it('자기 자신·가려진 칸·입력 칸이 아닌 칸을 빼고, 같은 행 앞 글자 칸 첫 줄로 이름을 붙인다', () => {
    expect(listLookupFillTargets(rows, 'name')).toEqual([
      { cellId: 'corp', label: '(8) 법인등록번호' },
      { cellId: 'biz', label: '(8) 법인등록번호 (2번째 칸)' },
      { cellId: 'tel', label: '연락처' },
    ]);
  });

  it('앞 글자 칸도 행 이름도 없으면 위치로 부른다', () => {
    expect(
      listLookupFillTargets([{ id: 'r', label: '', cells: [{ id: 'x', type: 'input', content: '' }] }], 'y'),
    ).toEqual([{ cellId: 'x', label: '1행 1열' }]);
  });
});
