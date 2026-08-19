import { describe, expect, it } from 'vitest';

import { seedLeftExprFromCellIds } from '@/components/survey-builder/sum-constraint-editor';

describe('seedLeftExprFromCellIds', () => {
  it('선택 셀들을 SUM 수식으로 시드한다 — questionId 생략(자기 질문)', () => {
    expect(seedLeftExprFromCellIds(['c1', 'c2'])).toEqual({
      kind: 'group',
      op: '+',
      terms: [
        {
          kind: 'agg',
          fn: 'sum',
          items: [
            { kind: 'cell', cellId: 'c1' },
            { kind: 'cell', cellId: 'c2' },
          ],
        },
      ],
    });
  });

  it('선택 셀이 없으면 빈 SUM 으로 시드한다', () => {
    expect(seedLeftExprFromCellIds([])).toEqual({
      kind: 'group',
      op: '+',
      terms: [{ kind: 'agg', fn: 'sum', items: [] }],
    });
  });
});
