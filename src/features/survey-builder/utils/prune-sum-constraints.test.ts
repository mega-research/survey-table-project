import { describe, expect, it } from 'vitest';

import { pruneSumConstraints } from '@/features/survey-builder/utils/prune-sum-constraints';
import type { SumConstraint, TableRow } from '@/types/survey';

const rows: TableRow[] = [
  {
    id: 'r1',
    label: '행1',
    cells: [
      { id: 'c1', type: 'input', inputType: 'number', content: '' },
      { id: 'c2', type: 'input', inputType: 'number', content: '' },
    ],
  },
];

const eq100: SumConstraint = { id: 's1', cellIds: ['c1', 'c2'], operator: 'eq', target: 100 };

describe('pruneSumConstraints', () => {
  it('존재하지 않는 cellId 를 제거한다', () => {
    const pruned = pruneSumConstraints([{ ...eq100, cellIds: ['c1', 'ghost'] }], rows);
    expect(pruned[0]!.cellIds).toEqual(['c1']);
  });
});
