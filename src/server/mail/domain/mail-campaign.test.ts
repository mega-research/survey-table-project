import { describe, expect, it } from 'vitest';

import { HEADER_FILTER_VALUE_MAX_LENGTH } from '@/lib/operations/filter-shared';
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

describe('FilterSnapshotSchema — 열 머리 필터 값 길이', () => {
  // 위저드 깔때기가 같은 상수로 적용 전에 막는다. 두 한도가 갈리면 화면이 건 조건을
  // 필터 결과 전체 선택·발송이 입력 검증에서 거부한다.
  it('깔때기가 적용을 허용하는 길이까지 받고, 한 글자 넘으면 거부한다', () => {
    const parse = (hv: string) =>
      FilterSnapshotSchema.safeParse({
        headerClauses: [{ source: 'system.group', mode: 'in', hv }],
      }).success;
    expect(parse('가'.repeat(HEADER_FILTER_VALUE_MAX_LENGTH))).toBe(true);
    expect(parse('가'.repeat(HEADER_FILTER_VALUE_MAX_LENGTH + 1))).toBe(false);
  });
});
