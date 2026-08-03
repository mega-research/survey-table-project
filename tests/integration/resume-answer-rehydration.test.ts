import { beforeEach, describe, expect, it, vi } from 'vitest';

const { selectMock, updateSetMock, updateWhereMock } = vi.hoisted(() => {
  const updateWhereMock = vi.fn();
  const updateSetMock = vi.fn(() => ({ where: updateWhereMock }));
  return { selectMock: vi.fn(), updateSetMock, updateWhereMock };
});

vi.mock('@/db', () => ({
  db: {
    select: selectMock,
    update: vi.fn(() => ({ set: updateSetMock })),
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

  it('일반 in_progress 세션은 저장된 draftSeq 를 반환한다 - 이어하기 seq seed 용', async () => {
    const limitMock = vi.fn().mockResolvedValue([
      {
        id: 'response-1',
        status: 'in_progress',
        isTest: false,
        questionResponses: { q1: '저장된 답' },
        metadata: { draftSeq: 7 },
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
    ).resolves.toMatchObject({ draftSeq: 7 });
  });

  it('metadata 에 draftSeq 가 없으면 draftSeq 를 생략한다', async () => {
    const limitMock = vi.fn().mockResolvedValue([
      {
        id: 'response-1',
        status: 'in_progress',
        isTest: false,
        questionResponses: {},
        metadata: {},
      },
    ]);
    selectMock.mockReturnValue({
      from: vi.fn(() => ({
        where: vi.fn(() => ({ limit: limitMock })),
      })),
    });

    const result = await resumeOrCreateResponse({
      surveyId: 'survey-1',
      sessionId: 'saved-session',
    });
    expect(result).not.toHaveProperty('draftSeq');
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

  describe('대상자 테스트 진입 판정', () => {
    async function mockTestTargetRow(row: Record<string, unknown>) {
      const { findContactByInviteToken } = await import(
        '@/lib/duplicate-detection/invite-lookup'
      );
      vi.mocked(findContactByInviteToken).mockResolvedValue({
        kind: 'valid',
        contactTargetId: 'contact-1',
        isTest: true,
      } as Awaited<ReturnType<typeof findContactByInviteToken>>);
      const limitMock = vi.fn().mockResolvedValue([row]);
      selectMock.mockReturnValue({
        from: vi.fn(() => ({
          where: vi.fn(() => ({ limit: limitMock })),
        })),
      });
    }

    const testTargetRowBase = {
      id: 'response-1',
      status: 'in_progress',
      isTest: true,
      sessionId: 'row-session',
      versionId: 'version-1',
      questionResponses: { q1: '테스트 답' },
      currentStepId: 'step-2',
      metadata: { draftSeq: 3 },
    };

    const resume = () =>
      resumeOrCreateResponse({
        surveyId: 'survey-1',
        // 대상자 테스트는 매 진입 새 sessionId 라 행의 sessionId 와 다르다 - 세션 일치를 요구하지 않는다
        sessionId: 'new-session',
        inviteToken: 'invite-1',
      });

    it('중도 이탈(drop) 행은 되살려 저장된 답을 돌려준다', async () => {
      await mockTestTargetRow({ ...testTargetRowBase, status: 'drop' });

      await expect(resume()).resolves.toEqual({
        id: 'response-1',
        status: 'in_progress',
        resumed: true,
        questionResponses: { q1: '테스트 답' },
        currentStepId: 'step-2',
        draftSeq: 3,
      });
      expect(updateSetMock).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'in_progress' }),
      );
    });

    it('in_progress 행은 기존대로 답만 돌려주고 행을 쓰지 않는다', async () => {
      await mockTestTargetRow(testTargetRowBase);

      await expect(resume()).resolves.toMatchObject({
        id: 'response-1',
        status: 'in_progress',
        resumed: false,
        questionResponses: { q1: '테스트 답' },
      });
      expect(updateSetMock).not.toHaveBeenCalled();
    });

    it('drop 이라도 버전이 다르면 복원하지 않는다 - 구버전 답 주입 차단', async () => {
      await mockTestTargetRow({ ...testTargetRowBase, status: 'drop', versionId: 'version-0' });

      await expect(resume()).resolves.toBeNull();
      expect(updateSetMock).not.toHaveBeenCalled();
    });

    it('종결 상태는 복원하지 않는다 - 첫 입력에서 제자리 초기화된다', async () => {
      for (const status of ['screened_out', 'quotaful_out', 'bad'] as const) {
        vi.clearAllMocks();
        await mockTestTargetRow({ ...testTargetRowBase, status });
        await expect(resume()).resolves.toBeNull();
        expect(updateSetMock).not.toHaveBeenCalled();
      }
    });

    it('알 수 없는 status 는 복원하지 않는다 - 보수적으로 기존 동작 유지', async () => {
      await mockTestTargetRow({ ...testTargetRowBase, status: 'unknown_status' });

      await expect(resume()).resolves.toBeNull();
      expect(updateSetMock).not.toHaveBeenCalled();
    });
  });
});
