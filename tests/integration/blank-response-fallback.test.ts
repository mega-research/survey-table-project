import { describe, expect, it, vi, beforeEach } from 'vitest';

// ========================
// 모듈 모킹
// ========================
//
// createBlankResponse 는 server action 이며 다음에 의존한다:
// - next/headers 의 headers() (UA / x-forwarded-for / x-real-ip)
// - @/db 의 drizzle client (db.insert, db.select, db.execute)
// - @/lib/operations/parse-ua (순수 함수이므로 모킹 안 함, 실제 호출)
//
// drizzle 의 fluent chain 을 흉내내기 위해 매 호출이 동일한 객체를 반환하는
// chainable mock 을 만든다. returning() / limit() 가 호출자가 await 했을 때
// 우리가 지정한 Promise 결과를 반환하면 된다.

const headerStore = {
  get: vi.fn((name: string) => {
    if (name === 'user-agent') return 'Mozilla/5.0 (Macintosh) AppleWebKit/537.36 Chrome/120.0';
    if (name === 'x-forwarded-for') return '203.0.113.42';
    if (name === 'x-real-ip') return null;
    return null;
  }),
};

vi.mock('next/headers', () => ({
  headers: vi.fn(async () => headerStore),
}));

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}));

const insertReturningMock = vi.fn();
const selectLimitMock = vi.fn();
const dbExecuteMock = vi.fn();
const insertValuesArg = vi.fn();

const insertChain = {
  values: vi.fn((arg: unknown) => {
    insertValuesArg(arg);
    return insertChain;
  }),
  onConflictDoNothing: vi.fn(() => insertChain),
  returning: vi.fn(() => insertReturningMock()),
};

const selectChain = {
  from: vi.fn(() => selectChain),
  where: vi.fn(() => selectChain),
  limit: vi.fn(() => selectLimitMock()),
};

vi.mock('@/db', () => ({
  db: {
    insert: vi.fn(() => insertChain),
    select: vi.fn(() => selectChain),
    execute: vi.fn((...args: unknown[]) => dbExecuteMock(...args)),
  },
}));

vi.mock('@/lib/auth', () => ({
  requireAuth: vi.fn(async () => ({ id: 'user-test' })),
}));

import { createBlankResponse } from '@/actions/response-actions';

describe('createBlankResponse', () => {
  beforeEach(() => {
    insertValuesArg.mockReset();
    insertReturningMock.mockReset();
    selectLimitMock.mockReset();
    dbExecuteMock.mockReset();
  });

  it('happy path: 빈 응답을 INSERT 하고 invite 매칭된 contactTargetId 와 함께 id 반환', async () => {
    dbExecuteMock.mockResolvedValueOnce([{ id: 'contact-1' }]);
    insertReturningMock.mockResolvedValueOnce([
      { id: 'response-1', contactTargetId: 'contact-1' },
    ]);

    const result = await createBlankResponse({
      surveyId: '00000000-0000-4000-8000-000000000001',
      sessionId: 'session-abc',
      versionId: null,
      currentStepId: 'step-1',
      inviteToken: '11111111-1111-4111-8111-111111111111',
    });

    expect(result).toEqual({ id: 'response-1', contactTargetId: 'contact-1' });

    expect(insertValuesArg).toHaveBeenCalledOnce();
    const values = insertValuesArg.mock.calls[0][0] as {
      questionResponses: Record<string, unknown>;
      isCompleted: boolean;
      status: string;
      contactTargetId: string | null;
      pageVisits: Array<{ stepId: string }>;
      ipAddress: string | null;
    };
    expect(values.questionResponses).toEqual({});
    expect(values.isCompleted).toBe(false);
    expect(values.status).toBe('in_progress');
    expect(values.contactTargetId).toBe('contact-1');
    expect(values.pageVisits).toHaveLength(1);
    expect(values.pageVisits[0].stepId).toBe('step-1');
    expect(values.ipAddress).toBe('203.0.113.42');
  });

  it('conflict path: ON CONFLICT DO NOTHING 으로 빈 returning 시 기존 row id 반환', async () => {
    dbExecuteMock.mockResolvedValueOnce([{ id: 'contact-1' }]);
    insertReturningMock.mockResolvedValueOnce([]);
    selectLimitMock.mockResolvedValueOnce([
      { id: 'response-existing', contactTargetId: 'contact-1' },
    ]);

    const result = await createBlankResponse({
      surveyId: '00000000-0000-4000-8000-000000000001',
      sessionId: 'session-abc',
      versionId: null,
      currentStepId: 'step-1',
      inviteToken: '11111111-1111-4111-8111-111111111111',
    });

    expect(result).toEqual({ id: 'response-existing', contactTargetId: 'contact-1' });
    expect(selectLimitMock).toHaveBeenCalledOnce();
  });

  it('invite 무효: lookup 실패 시 contactTargetId === null 로 INSERT', async () => {
    dbExecuteMock.mockResolvedValueOnce([{ id: null }]);
    insertReturningMock.mockResolvedValueOnce([
      { id: 'response-2', contactTargetId: null },
    ]);

    const result = await createBlankResponse({
      surveyId: '00000000-0000-4000-8000-000000000001',
      sessionId: 'session-no-invite-match',
      versionId: null,
      currentStepId: 'step-1',
      inviteToken: '22222222-2222-4222-8222-222222222222',
    });

    expect(result).toEqual({ id: 'response-2', contactTargetId: null });

    const values = insertValuesArg.mock.calls[0][0] as { contactTargetId: string | null };
    expect(values.contactTargetId).toBeNull();
  });
});
