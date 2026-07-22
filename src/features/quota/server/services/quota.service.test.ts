import { describe, expect, it, vi, beforeEach } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';

import type { QuotaConfig } from '@/db/schema/schema-types';

// checkQuota 는 db.query.surveys.findFirst(설정 조회) + db.select(...).from(surveyResponses)
// .where(...)(완료 응답 answers 조회) 를 쓴다. 실 PG 없는 vitest 환경이라 where 절 자체를
// 캡처해 SQL 을 검증한다 (T3 duplicate-detection check.test.ts 선례).
const { mockSurveyFindFirst, mockResponseFindFirst, mockWhere, mockUpdateWhere } = vi.hoisted(() => ({
  mockSurveyFindFirst: vi.fn(),
  mockResponseFindFirst: vi.fn(),
  mockWhere: vi.fn(),
  mockUpdateWhere: vi.fn(),
}));

vi.mock('@/db', () => ({
  db: {
    query: {
      surveys: { findFirst: mockSurveyFindFirst },
      surveyResponses: { findFirst: mockResponseFindFirst },
    },
    select: () => ({ from: () => ({ where: mockWhere }) }),
    update: () => ({ set: () => ({ where: mockUpdateWhere }) }),
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
    mockSurveyFindFirst.mockReset();
    mockResponseFindFirst.mockReset();
    mockWhere.mockReset();
    mockUpdateWhere.mockReset();
    mockWhere.mockResolvedValue([]);
    mockResponseFindFirst.mockResolvedValue({ isTest: false });
  });

  it('isTest 완료 응답을 셀 카운트 모수에서 제외한다 (where 절에 is_test=false 조건 포함)', async () => {
    mockSurveyFindFirst.mockResolvedValue({ quotaConfig: config });
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

  it('현재 응답이 테스트이면 소진 quota를 우회하고 상태를 변경하지 않는다', async () => {
    mockSurveyFindFirst.mockResolvedValue({
      quotaConfig: { ...config, cells: [{ categoryIds: ['c-f'], target: 0 }] },
    });
    mockResponseFindFirst.mockResolvedValue({ isTest: true });
    const { checkQuota } = await import('./quota.service');

    const result = await checkQuota({
      responseId: 'test-response',
      surveyId: 's1',
      answers: { q1: 'female' },
    });

    expect(result).toEqual({ blocked: false, closedMessage: null });
    expect(mockWhere).not.toHaveBeenCalled();
    expect(mockUpdateWhere).not.toHaveBeenCalled();
  });

  it('responseId와 surveyId가 섞였거나 stale이면 quota mutation을 거부한다', async () => {
    mockSurveyFindFirst.mockResolvedValue({ quotaConfig: config });
    mockResponseFindFirst.mockResolvedValue(null);
    const { checkQuota } = await import('./quota.service');

    await expect(
      checkQuota({
        responseId: 'other-survey-response',
        surveyId: 's1',
        answers: { q1: 'female' },
      }),
    ).rejects.toThrow('쿼터 응답 범위가 일치하지 않습니다.');

    expect(mockResponseFindFirst).toHaveBeenCalledOnce();
    const lookup = mockResponseFindFirst.mock.calls[0]![0] as { where: unknown };
    const lookupQuery = dialect.sqlToQuery(lookup.where as never);
    expect(lookupQuery.params).toEqual(expect.arrayContaining(['other-survey-response', 's1']));
    expect(lookupQuery.sql).toContain('"deleted_at" is null');
    expect(mockWhere).not.toHaveBeenCalled();
    expect(mockUpdateWhere).not.toHaveBeenCalled();
  });
});
