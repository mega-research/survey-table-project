import { beforeEach, describe, expect, it, vi } from 'vitest';

const { selectMock, updateWhereMock } = vi.hoisted(() => ({
  selectMock: vi.fn(),
  updateWhereMock: vi.fn(),
}));

vi.mock('@/db', () => ({
  db: {
    select: selectMock,
    update: vi.fn(() => ({
      set: vi.fn(() => ({ where: updateWhereMock })),
    })),
  },
}));

vi.mock('@/lib/survey-control', () => ({
  getSurveyControlFlags: vi.fn().mockResolvedValue({
    isPaused: false,
    testModeEnabled: false,
    testToken: null,
    currentVersionId: 'version-1',
  }),
  isValidTestToken: vi.fn(() => false),
}));

vi.mock('@/lib/duplicate-detection/invite-lookup', () => ({
  findContactByInviteToken: vi.fn(),
}));

import { resumeOrCreateResponse } from '@/features/survey-response/server/services/lifecycle.service';

describe('resumeOrCreateResponse 응답 복원', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    updateWhereMock.mockResolvedValue(undefined);
  });

  it('일반 in_progress 세션에 저장된 questionResponses를 반환한다', async () => {
    const limitMock = vi.fn().mockResolvedValue([
      {
        id: 'response-1',
        status: 'in_progress',
        isTest: false,
        questionResponses: { q1: '저장된 답' },
      },
    ]);
    selectMock.mockReturnValue({
      from: vi.fn(() => ({
        where: vi.fn(() => ({ limit: limitMock })),
      })),
    });

    await expect(
      resumeOrCreateResponse({
        surveyId: 'survey-1',
        sessionId: 'saved-session',
      }),
    ).resolves.toEqual({
      id: 'response-1',
      status: 'in_progress',
      resumed: false,
      questionResponses: { q1: '저장된 답' },
    });
  });

  it('저장된 currentStepId를 반환한다 - 재접속 시 멈춘 페이지 복원용', async () => {
    const limitMock = vi.fn().mockResolvedValue([
      {
        id: 'response-1',
        status: 'in_progress',
        isTest: false,
        questionResponses: { q1: '저장된 답' },
        currentStepId: 'step-3',
      },
    ]);
    selectMock.mockReturnValue({
      from: vi.fn(() => ({
        where: vi.fn(() => ({ limit: limitMock })),
      })),
    });

    await expect(
      resumeOrCreateResponse({
        surveyId: 'survey-1',
        sessionId: 'saved-session',
      }),
    ).resolves.toMatchObject({ currentStepId: 'step-3' });
  });

  async function mockContactRow(row: Record<string, unknown>) {
    const { findContactByInviteToken } = await import(
      '@/lib/duplicate-detection/invite-lookup'
    );
    vi.mocked(findContactByInviteToken).mockResolvedValue({
      kind: 'valid',
      contactTargetId: 'contact-1',
      isTest: false,
    } as Awaited<ReturnType<typeof findContactByInviteToken>>);
    const limitMock = vi.fn().mockResolvedValue([row]);
    selectMock.mockReturnValue({
      from: vi.fn(() => ({
        where: vi.fn(() => ({ limit: limitMock })),
      })),
    });
  }

  const contactRowBase = {
    id: 'response-1',
    status: 'in_progress',
    isTest: false,
    sessionId: 'saved-session',
    versionId: 'version-1',
    questionResponses: { q1: '저장된 답' },
    currentStepId: 'step-3',
  };

  it('컨택 invite 경로 in_progress 회복도 저장된 답과 currentStepId를 반환한다', async () => {
    await mockContactRow(contactRowBase);

    await expect(
      resumeOrCreateResponse({
        surveyId: 'survey-1',
        sessionId: 'saved-session',
        inviteToken: 'invite-1',
      }),
    ).resolves.toMatchObject({
      questionResponses: { q1: '저장된 답' },
      currentStepId: 'step-3',
    });
  });

  it('컨택 경로 세션 불일치면 답과 currentStepId를 반환하지 않는다 - invite URL 유출 방어', async () => {
    await mockContactRow(contactRowBase);

    const result = await resumeOrCreateResponse({
      surveyId: 'survey-1',
      sessionId: 'attacker-session',
      inviteToken: 'invite-1',
    });
    expect(result).toMatchObject({ id: 'response-1', status: 'in_progress' });
    expect(result).not.toHaveProperty('questionResponses');
    expect(result).not.toHaveProperty('currentStepId');
  });

  it('컨택 경로 버전 불일치면 답과 currentStepId를 반환하지 않는다 - 구버전 답 주입 차단', async () => {
    await mockContactRow({ ...contactRowBase, versionId: 'version-0' });

    const result = await resumeOrCreateResponse({
      surveyId: 'survey-1',
      sessionId: 'saved-session',
      inviteToken: 'invite-1',
    });
    expect(result).toMatchObject({ id: 'response-1', status: 'in_progress' });
    expect(result).not.toHaveProperty('questionResponses');
    expect(result).not.toHaveProperty('currentStepId');
  });
});
