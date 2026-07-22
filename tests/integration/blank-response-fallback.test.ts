import { describe, expect, it, vi, beforeEach } from 'vitest';

// DUPLICATE_DETECTION_SALT 는 signals.ts 에서 필요
process.env['DUPLICATE_DETECTION_SALT'] = 'test-salt-blank-response';

// ========================
// 모듈 모킹
// ========================
//
// createBlankResponse 는 feature service 이며 다음에 의존한다:
// - next/headers 의 headers() (UA / x-forwarded-for / x-real-ip)
// - @/db 의 drizzle client (db.insert, db.select, db.execute, db.query)
// - @/lib/operations/parse-ua (순수 함수이므로 모킹 안 함, 실제 호출)
//
// drizzle 의 fluent chain 을 흉내내기 위해 매 호출이 동일한 객체를 반환하는
// chainable mock 을 만든다. returning() / limit() 가 호출자가 await 했을 때
// 우리가 지정한 Promise 결과를 반환하면 된다.
//
// vi.mock factory 는 파일 상단으로 호이스팅되므로 factory 내부에서 참조하는 변수는
// vi.hoisted() 로 선언해야 한다.

const {
  insertReturningMock,
  selectLimitMock,
  dbExecuteMock,
  insertValuesArg,
  findFirstMock,
  contactFindFirstMock,
} = vi.hoisted(() => ({
  insertReturningMock: vi.fn(),
  selectLimitMock: vi.fn(),
  dbExecuteMock: vi.fn(),
  insertValuesArg: vi.fn(),
  findFirstMock: vi.fn(),
  contactFindFirstMock: vi.fn(),
}));

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

vi.mock('@/db', () => ({
  db: {
    insert: vi.fn(() => insertChain),
    select: vi.fn(() => selectChain),
    execute: vi.fn((...args: unknown[]) => dbExecuteMock(...args)),
    query: {
      surveyResponses: { findFirst: findFirstMock },
      contactTargets: { findFirst: contactFindFirstMock },
      // 가용성 게이트(#3): published 공개 설문으로 통과시킨다.
      surveys: {
        findFirst: vi.fn(async () => ({
          status: 'published',
          endDate: null,
          maxResponses: null,
          isPublic: true,
          requireInviteToken: false,
        })),
      },
      surveyVersions: { findFirst: vi.fn(async () => null) },
    },
  },
}));

// findContactByInviteToken 내부에서 negative codes 조회
vi.mock('@/lib/operations/result-code-statuses.server', async () => {
  const { mockBuildNegativeCodeExists } = await import('./_helpers/result-code-mock');
  return {
    getResultCodeStatuses: vi.fn(async () => ({ positive: [], negative: [] })),
    buildNegativeCodeExists: mockBuildNegativeCodeExists,
  };
});

import { createBlankResponse } from '@/features/survey-response/server/services/response.service';
import type { ClientSignals } from '@/lib/duplicate-detection/types';

const PLACEHOLDER_SIGNALS: ClientSignals = {
  deviceId: null,
  screen: '',
  tz: '',
  lang: '',
  platform: '',
};

describe('createBlankResponse', () => {
  beforeEach(() => {
    insertValuesArg.mockReset();
    insertReturningMock.mockReset();
    selectLimitMock.mockReset();
    dbExecuteMock.mockReset();
    findFirstMock.mockReset();
    contactFindFirstMock.mockReset();
  });

  it('happy path: 빈 응답을 INSERT 하고 invite 매칭된 contactTargetId 와 함께 id 반환', async () => {
    // findContactByInviteToken: 1) RPC lookup 성공
    dbExecuteMock.mockResolvedValueOnce([{ id: 'contact-1' }]);
    // findContactByInviteToken: 2) 대상자 종류·설문 테스트 모드 조회
    contactFindFirstMock.mockResolvedValue({
      id: 'contact-1',
      surveyId: '00000000-0000-4000-8000-000000000001',
      respondedAt: null,
      isTest: false,
      survey: { testModeEnabled: true, deletedAt: null },
    });
    // findContactByInviteToken: 3) excluded EXISTS — 비어있음 (제외 아님)
    dbExecuteMock.mockResolvedValueOnce([]);
    // findActiveResponseByContact: 활성 응답 없음 (insert 진행)
    selectLimitMock.mockResolvedValueOnce([]);
    insertReturningMock.mockResolvedValueOnce([
      { id: 'response-1', contactTargetId: 'contact-1' },
    ]);

    const result = await createBlankResponse({
      surveyId: '00000000-0000-4000-8000-000000000001',
      sessionId: 'session-abc',
      versionId: null,
      currentStepId: 'step-1',
      inviteToken: '11111111-1111-4111-8111-111111111111',
      clientSignals: PLACEHOLDER_SIGNALS,
    });

    expect(result).toEqual({ kind: 'created', id: 'response-1', contactTargetId: 'contact-1' });

    expect(insertValuesArg).toHaveBeenCalledOnce();
    const rawCall = insertValuesArg.mock.calls[0];
    if (!rawCall) throw new Error('insertValuesArg 호출 없음');
    const values = rawCall[0] as {
      questionResponses: Record<string, unknown>;
      isCompleted: boolean;
      status: string;
      contactTargetId: string | null;
      pageVisits: Array<{ stepId: string }>;
      ipHash: string | null;
    };
    expect(values.questionResponses).toEqual({});
    expect(values.isCompleted).toBe(false);
    expect(values.status).toBe('in_progress');
    expect(values.contactTargetId).toBe('contact-1');
    expect(values.pageVisits).toHaveLength(1);
    const firstVisit = values.pageVisits[0];
    if (!firstVisit) throw new Error('pageVisits[0] 없음');
    expect(firstVisit.stepId).toBe('step-1');
    // ipHash 는 null 이 아님 (IP 가 있으므로 sha256 결과)
    expect(values.ipHash).not.toBeNull();
  });

  it('conflict path: ON CONFLICT DO NOTHING 으로 빈 returning 시 기존 row id 반환', async () => {
    // findContactByInviteToken: 1) RPC lookup (유효 토큰)
    dbExecuteMock.mockResolvedValueOnce([{ id: 'contact-1' }]);
    // findContactByInviteToken: 2) 대상자 종류·설문 테스트 모드 조회
    contactFindFirstMock.mockResolvedValue({
      id: 'contact-1',
      surveyId: '00000000-0000-4000-8000-000000000001',
      respondedAt: null,
      isTest: false,
      survey: { testModeEnabled: true, deletedAt: null },
    });
    // findContactByInviteToken: 3) excluded EXISTS — 비어있음 (제외 아님)
    dbExecuteMock.mockResolvedValueOnce([]);
    // findActiveResponseByContact: 활성 응답 없음 (insert 진행)
    selectLimitMock.mockResolvedValueOnce([]);
    // INSERT returning 비어있음 (conflict)
    insertReturningMock.mockResolvedValueOnce([]);
    // SELECT 기존 행 조회 (sessionId 충돌 lookup)
    selectLimitMock.mockResolvedValueOnce([
      { id: 'response-existing', contactTargetId: 'contact-1' },
    ]);

    const result = await createBlankResponse({
      surveyId: '00000000-0000-4000-8000-000000000001',
      sessionId: 'session-abc',
      versionId: null,
      currentStepId: 'step-1',
      inviteToken: '11111111-1111-4111-8111-111111111111',
      clientSignals: PLACEHOLDER_SIGNALS,
    });

    expect(result).toEqual({ kind: 'created', id: 'response-existing', contactTargetId: 'contact-1' });
    expect(selectLimitMock).toHaveBeenCalled();
  });

  it('invite 무효: lookup 실패 시 contactTargetId === null 로 INSERT', async () => {
    // checkTrackA: 토큰 조회 null → blocked: invalid_token
    dbExecuteMock.mockResolvedValueOnce([{ id: null }]);

    const result = await createBlankResponse({
      surveyId: '00000000-0000-4000-8000-000000000001',
      sessionId: 'session-no-invite-match',
      versionId: null,
      currentStepId: 'step-1',
      inviteToken: '22222222-2222-4222-8222-222222222222',
      clientSignals: PLACEHOLDER_SIGNALS,
    });

    // 무효 토큰이므로 차단 반환
    expect(result).toEqual({ kind: 'blocked', reason: 'invalid_token' });
    expect(insertValuesArg).not.toHaveBeenCalled();
  });
});
