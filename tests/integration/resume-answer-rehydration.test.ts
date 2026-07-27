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
});
