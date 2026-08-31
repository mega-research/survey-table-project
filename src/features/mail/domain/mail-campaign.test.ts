import { describe, expect, it } from 'vitest';

import { SINGLE_COLUMN_ID_LIST_MAX } from '@/lib/operations/range-list';

import { FilterSnapshotSchema } from './mail-campaign';

describe('FilterSnapshotSchema — 붙여넣기 ID 목록이 스냅샷을 통과해야 한다', () => {
  it('인라인 상한(2,000개) 목록 값이 절 value 로 저장된다', () => {
    const value = Array.from({ length: SINGLE_COLUMN_ID_LIST_MAX }, (_, i) =>
      String(1000 + i),
    ).join(' ');
    const result = FilterSnapshotSchema.safeParse({
      clauses: [{ source: 'attrs.ID', value, op: null }],
      unrespondedOnly: true,
    });
    expect(result.success).toBe(true);
  });

  it('저장 토큰 값도 통과한다', () => {
    const result = FilterSnapshotSchema.safeParse({
      clauses: [
        {
          source: 'system.resid',
          value: 'list:0f3a4b5c-1111-4222-8333-444455556666:5000',
          op: null,
        },
      ],
    });
    expect(result.success).toBe(true);
  });
});
