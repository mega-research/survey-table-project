import { describe, expect, it, vi } from 'vitest';

process.env['CONTACT_PII_AES_KEY'] = Buffer.alloc(32, 7).toString('base64');

vi.mock('@sentry/nextjs', () => ({ captureMessage: vi.fn() }));

const { findFirstMock } = vi.hoisted(() => ({ findFirstMock: vi.fn() }));

vi.mock('@/db', () => ({
  db: {
    query: {
      surveyResponses: { findFirst: (...a: unknown[]) => findFirstMock(...a) },
    },
  },
}));

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
