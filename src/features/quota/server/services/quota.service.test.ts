import { describe, expect, it, vi, beforeEach } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';

import type { QuotaConfig } from '@/db/schema/schema-types';

// checkQuota 는 db.query.surveys.findFirst(설정 조회) + db.select(...).from(surveyResponses)
// .where(...)(완료 응답 answers 조회) 를 쓴다. 실 PG 없는 vitest 환경이라 where 절 자체를
// 캡처해 SQL 을 검증한다 (T3 duplicate-detection check.test.ts 선례).
const { mockFindFirst, mockWhere } = vi.hoisted(() => ({
  mockFindFirst: vi.fn(),
  mockWhere: vi.fn(),
}));

vi.mock('@/db', () => ({
  db: {
    query: { surveys: { findFirst: mockFindFirst } },
    select: () => ({ from: () => ({ where: mockWhere }) }),
    update: () => ({ set: () => ({ where: vi.fn() }) }),
  },
}));

const dialect = new PgDialect();

const config: QuotaConfig = {
  enabled: true,
  dimensions: [
    {
      id: 'd1',
      questionId: 'q1',
      label: '성별',
      kind: 'choice',
      categories: [{ id: 'c-f', label: '여성', values: ['female'] }],
    },
  ],
  cells: [{ categoryIds: ['c-f'], target: 10 }],
  closedMessage: null,
};

describe('checkQuota', () => {
  beforeEach(() => {
    mockFindFirst.mockReset();
    mockWhere.mockReset();
    mockWhere.mockResolvedValue([]);
  });

  it('isTest 완료 응답을 셀 카운트 모수에서 제외한다 (where 절에 is_test=false 조건 포함)', async () => {
    mockFindFirst.mockResolvedValue({ quotaConfig: config });
    const { checkQuota } = await import('./quota.service');

    await checkQuota({
      responseId: 'r1',
      surveyId: 's1',
      answers: { q1: 'female' },
    });

    expect(mockWhere).toHaveBeenCalledTimes(1);
    const whereArg = mockWhere.mock.calls[0]![0];
    const query = dialect.sqlToQuery(whereArg as never);
    expect(query.sql).toContain('is_test');
    expect(query.params).toContain(false);
  });
});
