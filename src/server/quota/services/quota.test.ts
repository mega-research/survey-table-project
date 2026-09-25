import { describe, expect, it, vi, beforeEach } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';

import type { QuotaConfig } from '@/shared/contracts/quota';

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
    mockResponseFindFirst.mockResolvedValue({ isTest: false, status: 'in_progress' });
  });

  it('isTest 완료 응답을 셀 카운트 모수에서 제외한다 (where 절에 is_test=false 조건 포함)', async () => {
    mockSurveyFindFirst.mockResolvedValue({ quotaConfig: config });
    const { checkQuota } = await import('./quota');

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
    mockResponseFindFirst.mockResolvedValue({ isTest: true, status: 'in_progress' });
    const { checkQuota } = await import('./quota');

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
    const { checkQuota } = await import('./quota');

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
  describe('조사 대상 속성형 × 텍스트형', () => {
    const crossed: QuotaConfig = {
      enabled: true,
      dimensions: [
        {
          id: 'd-field',
          questionId: '',
          label: '산업 분야',
          kind: 'attr',
          attrKey: '산업 분야',
          categories: [{ id: 'c-ai', label: '인공지능', values: ['인공지능'] }],
        },
        {
          id: 'd-region',
          questionId: 'q1',
          label: '지역',
          kind: 'text',
          cellIds: ['sido', 'sigungu'],
          categories: [
            { id: 'c-sn', label: '성남시', keywords: ['성남'] },
            { id: 'c-etc', label: '성남시 외', isElse: true },
          ],
        },
      ],
      cells: [{ categoryIds: ['c-ai', 'c-sn'], target: 1 }],
      closedMessage: '마감',
    };
    const seongnam = { q1: { sido: '경기도', sigungu: '성남시 분당구' } };

    it('attrs 는 응답 행의 조사 대상 연결로 서버가 읽고, 마감 셀이면 쿼터마감한다', async () => {
      mockSurveyFindFirst.mockResolvedValue({ quotaConfig: crossed });
      mockResponseFindFirst.mockResolvedValue({ isTest: false, contactTargetId: 'c1', status: 'in_progress' });
      mockWhere
        .mockResolvedValueOnce([{ attrs: { '산업 분야': '인공지능' } }]) // 현재 응답의 조사 대상
        .mockResolvedValueOnce([{ questionResponses: seongnam, contactTargetId: 'c2' }]) // 완료 모수
        .mockResolvedValueOnce([{ id: 'c2', attrs: { '산업 분야': '인공지능' } }]); // 모수의 조사 대상
      const { checkQuota } = await import('./quota');

      const result = await checkQuota({ responseId: 'r1', surveyId: 's1', answers: seongnam });

      expect(result).toEqual({
        blocked: true,
        closedMessage: '마감',
        midSurveyClosedMessage: '마감',
      });
      expect(mockUpdateWhere).toHaveBeenCalledOnce();
    });

    it('조사 대상이 없는 응답은 미분류로 통과한다 — 모수도 읽지 않는다', async () => {
      mockSurveyFindFirst.mockResolvedValue({ quotaConfig: crossed });
      mockResponseFindFirst.mockResolvedValue({ isTest: false, contactTargetId: null, status: 'in_progress' });
      const { checkQuota } = await import('./quota');

      const result = await checkQuota({ responseId: 'r1', surveyId: 's1', answers: seongnam });

      expect(result).toEqual({ blocked: false, closedMessage: null });
      expect(mockWhere).not.toHaveBeenCalled();
      expect(mockUpdateWhere).not.toHaveBeenCalled();
    });

    it('같은 산업 분야라도 성남 외 주소는 다른 셀이라 막히지 않는다', async () => {
      mockSurveyFindFirst.mockResolvedValue({ quotaConfig: crossed });
      mockResponseFindFirst.mockResolvedValue({ isTest: false, contactTargetId: 'c1', status: 'in_progress' });
      mockWhere.mockResolvedValueOnce([{ attrs: { '산업 분야': '인공지능' } }]);
      const { checkQuota } = await import('./quota');

      const result = await checkQuota({
        responseId: 'r1',
        surveyId: 's1',
        answers: { q1: { sido: '서울', sigungu: '강남구' } },
      });

      expect(result).toEqual({ blocked: false, closedMessage: null }); // 목표 없는 셀
      expect(mockUpdateWhere).not.toHaveBeenCalled();
    });
  });

  // 진행 중 마감 — 페이지마다 재호출되므로 멱등이어야 한다 (ADR 0025).
  describe('재호출 멱등', () => {
    const midClose: QuotaConfig = {
      ...config,
      midSurveyClose: true,
      midSurveyClosedMessage: '죄송합니다',
    };

    it('이미 쿼터마감인 응답은 모수를 다시 세지 않고 blocked 를 그대로 돌려준다', async () => {
      mockSurveyFindFirst.mockResolvedValue({ quotaConfig: midClose });
      mockResponseFindFirst.mockResolvedValue({ isTest: false, status: 'quotaful_out' });
      const { checkQuota } = await import('./quota');

      const result = await checkQuota({ responseId: 'r1', surveyId: 's1', answers: { q1: 'female' } });

      expect(result).toEqual({
        blocked: true,
        closedMessage: null,
        midSurveyClosedMessage: '죄송합니다',
      });
      expect(mockWhere).not.toHaveBeenCalled();
      expect(mockUpdateWhere).not.toHaveBeenCalled();
    });

    it('이미 완료된 응답에 늦게 온 확인은 막지 않는다', async () => {
      mockSurveyFindFirst.mockResolvedValue({
        quotaConfig: { ...midClose, cells: [{ categoryIds: ['c-f'], target: 0 }] },
      });
      mockResponseFindFirst.mockResolvedValue({ isTest: false, status: 'completed' });
      const { checkQuota } = await import('./quota');

      const result = await checkQuota({ responseId: 'r1', surveyId: 's1', answers: { q1: 'female' } });

      expect(result).toEqual({ blocked: false, closedMessage: null });
      expect(mockUpdateWhere).not.toHaveBeenCalled();
    });

    it('마감 판정에 진행 중 마감 문구를 함께 싣고, 비면 마감 문구로 폴백한다', async () => {
      mockSurveyFindFirst.mockResolvedValue({
        quotaConfig: {
          ...midClose,
          closedMessage: '마감',
          midSurveyClosedMessage: null,
          cells: [{ categoryIds: ['c-f'], target: 0 }],
        },
      });
      mockResponseFindFirst.mockResolvedValue({ isTest: false, status: 'in_progress' });
      const { checkQuota } = await import('./quota');

      const result = await checkQuota({ responseId: 'r1', surveyId: 's1', answers: { q1: 'female' } });

      expect(result).toEqual({ blocked: true, closedMessage: '마감', midSurveyClosedMessage: '마감' });
      expect(mockUpdateWhere).toHaveBeenCalledOnce();
    });
  });
});
