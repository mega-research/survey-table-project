import { describe, expect, it, vi } from 'vitest';

process.env['CONTACT_PII_AES_KEY'] = Buffer.alloc(32, 7).toString('base64');

vi.mock('@sentry/nextjs', () => ({ captureMessage: vi.fn() }));

const { findFirstMock, findManyMock, surveysFindFirstMock, selectWhereMock } = vi.hoisted(() => ({
  findFirstMock: vi.fn(),
  findManyMock: vi.fn(),
  surveysFindFirstMock: vi.fn(),
  selectWhereMock: vi.fn(),
}));

vi.mock('@/db', () => ({
  db: {
    query: {
      surveyResponses: {
        findFirst: (...a: unknown[]) => findFirstMock(...a),
        findMany: (...a: unknown[]) => findManyMock(...a),
      },
      surveys: { findFirst: (...a: unknown[]) => surveysFindFirstMock(...a) },
    },
    select: () => ({
      from: () => ({
        where: (...a: unknown[]) => selectWhereMock(...a),
      }),
    }),
  },
}));

import type { QuotaConfig } from '@/db/schema/schema-types';
import { encryptAnswerValue } from '@/lib/crypto/response-pii';

describe('data/responses.getResponseById — 복호화 경계', () => {
  it('암호문 답변이 평문으로 복호화되어 반환된다 (평문·비문자열 혼재 보존)', async () => {
    const cipher = encryptAnswerValue('김철수');
    findFirstMock.mockResolvedValue({
      id: 'r1',
      questionResponses: { q1: cipher, q2: '평문', q3: ['a'] },
    });
    const { getResponseById } = await import('@/data/responses');
    const row = await getResponseById('r1');
    expect(row?.questionResponses).toEqual({ q1: '김철수', q2: '평문', q3: ['a'] });
  });
});

describe('response-read.service — authed procedure 노출 경계', () => {
  it('getResponsesBySurvey 가 암호문 행을 평문으로 반환한다', async () => {
    const cipher = encryptAnswerValue('010-1234-5678');
    findManyMock.mockResolvedValue([
      { id: 'r2', questionResponses: { q1: cipher, q2: 7 } },
    ]);
    const { getResponsesBySurvey } = await import(
      '@/features/survey-builder/server/services/response-read.service'
    );
    const rows = await getResponsesBySurvey('s1');
    expect(rows[0]?.questionResponses).toEqual({ q1: '010-1234-5678', q2: 7 });
  });

  it('getCompletedResponses 가 암호문 행을 평문으로 반환한다', async () => {
    const cipher = encryptAnswerValue('kim@example.com');
    findManyMock.mockResolvedValue([
      { id: 'r3', questionResponses: { q1: cipher, q2: '평문' } },
    ]);
    const { getCompletedResponses } = await import(
      '@/features/survey-builder/server/services/response-read.service'
    );
    const rows = await getCompletedResponses('s1');
    expect(rows[0]?.questionResponses).toEqual({ q1: 'kim@example.com', q2: '평문' });
  });
});

describe('lib/operations/quota-status.server.getQuotaStatus — 복호화 경계', () => {
  it('암호문 답변이 복호화되어 쿼터 셀 매칭에 반영된다', async () => {
    // q1 답이 '남' 인 응답만 c1 셀에 매칭되는 최소 쿼터 플랜
    const config: QuotaConfig = {
      enabled: true,
      dimensions: [
        {
          id: 'd1',
          questionId: 'q1',
          label: '성별',
          kind: 'choice',
          categories: [{ id: 'c1', label: '남', values: ['남'] }],
        },
      ],
      cells: [{ categoryIds: ['c1'], target: 10 }],
      closedMessage: null,
    };
    surveysFindFirstMock.mockResolvedValue({ quotaConfig: config });
    selectWhereMock.mockResolvedValue([
      { questionResponses: { q1: encryptAnswerValue('남') } },
    ]);
    const { getQuotaStatus } = await import('@/lib/operations/quota-status.server');
    const status = await getQuotaStatus('s1');
    // 복호화 없이는 'v1:...' 암호문이 category values 와 매칭되지 않아 current 가 0 이 된다
    expect(status?.cells[0]?.current).toBe(1);
  });
});
