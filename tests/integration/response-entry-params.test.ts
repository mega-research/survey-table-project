import { beforeEach, describe, expect, it, vi } from 'vitest';

process.env['DUPLICATE_DETECTION_SALT'] = 'test-salt-entry-params';

// ========================
// 이어 넘길 값(패널 회원 ID) — 응답 행을 처음 만들 때 metadata.entryParams 에 남는가.
// 모킹 방식은 blank-response-fallback.test.ts 와 같다(invite 경로로 Track B 를 건너뛴다).
// ========================

const {
  insertReturningMock,
  selectLimitMock,
  dbExecuteMock,
  insertValuesArg,
  surveyFindFirstMock,
  contactFindFirstMock,
} = vi.hoisted(() => ({
  insertReturningMock: vi.fn(),
  selectLimitMock: vi.fn(),
  dbExecuteMock: vi.fn(),
  insertValuesArg: vi.fn(),
  surveyFindFirstMock: vi.fn(),
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
      surveyResponses: { findFirst: vi.fn() },
      contactTargets: { findFirst: contactFindFirstMock },
      surveys: { findFirst: surveyFindFirstMock },
      surveyVersions: { findFirst: vi.fn(async () => null) },
    },
  },
}));

vi.mock('@/server/read-models/result-code-statuses', async () => {
  const { mockBuildNegativeCodeExists } = await import('./_helpers/result-code-mock');
  return {
    getResultCodeStatuses: vi.fn(async () => ({ positive: [], negative: [] })),
    buildNegativeCodeExists: mockBuildNegativeCodeExists,
  };
});

import { createBlankResponse } from '@/server/survey-response/services/response-entry';

const SURVEY_ID = '00000000-0000-4000-8000-000000000001';

function gateRow(endRedirects: unknown) {
  return {
    status: 'published',
    endDate: null,
    maxResponses: null,
    isPublic: true,
    requireInviteToken: false,
    currentVersionId: null,
    isPaused: false,
    testModeEnabled: false,
    testToken: null,
    endRedirects,
  };
}

async function createWith(entryParams: Record<string, string> | undefined) {
  dbExecuteMock.mockResolvedValueOnce([{ id: 'contact-1' }]);
  contactFindFirstMock.mockResolvedValue({
    id: 'contact-1',
    surveyId: SURVEY_ID,
    respondedAt: null,
    isTest: false,
    survey: { testModeEnabled: false, deletedAt: null },
  });
  selectLimitMock.mockResolvedValueOnce([]);
  insertReturningMock.mockResolvedValueOnce([
    { id: 'response-1', contactTargetId: 'contact-1', status: 'in_progress' },
  ]);
  await createBlankResponse({
    surveyId: SURVEY_ID,
    sessionId: 'session-abc',
    versionId: null,
    currentStepId: 'step-1',
    inviteToken: '11111111-1111-4111-8111-111111111111',
    clientSignals: { deviceId: null, screen: '', tz: '', lang: '', platform: '' },
    ...(entryParams ? { entryParams } : {}),
  });
  const call = insertValuesArg.mock.calls[0];
  if (!call) throw new Error('INSERT 없음');
  return call[0] as { metadata?: unknown };
}

describe('응답 행 생성 — 이어 넘길 값 기록', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('설정된 이름의 값을 metadata.entryParams 에 남긴다', async () => {
    surveyFindFirstMock.mockResolvedValue(
      gateRow({ completed: 'https://tally.so/r/rDyxNl', passParams: ['euid'] }),
    );
    const values = await createWith({ euid: '12345' });
    expect(values.metadata).toEqual({ entryParams: { euid: '12345' } });
  });

  it('클라이언트가 보낸 값이라도 설정에 없는 이름은 버린다', async () => {
    surveyFindFirstMock.mockResolvedValue(gateRow({ passParams: ['euid'] }));
    const values = await createWith({ euid: '12345', invite: 'leak', other: 'x' });
    expect(values.metadata).toEqual({ entryParams: { euid: '12345' } });
  });

  it('설정이 없거나 남는 값이 없으면 metadata 를 건드리지 않는다', async () => {
    surveyFindFirstMock.mockResolvedValue(gateRow(null));
    expect((await createWith({ euid: '12345' })).metadata).toBeUndefined();

    vi.clearAllMocks();
    surveyFindFirstMock.mockResolvedValue(gateRow({ passParams: ['euid'] }));
    expect((await createWith(undefined)).metadata).toBeUndefined();
  });
});
