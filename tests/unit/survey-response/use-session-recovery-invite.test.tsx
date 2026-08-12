import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useSessionRecovery } from '@/components/survey-response/hooks/use-session-recovery';
import { sessionStorageKey } from '@/components/survey-response/hooks/session-helpers';
import { client } from '@/shared/lib/rpc';
import type { Survey } from '@/types/survey';

// invite 크로스 기기 회복 (2026-08-12 제품 결정) 클라이언트 게이트 검증:
// - invite 토큰이 있으면 localStorage saved sessionId 가 없어도(다른 기기·시크릿탭) resume 을 호출한다.
// - invite 도 saved 키도 없으면 기존대로 resume 을 호출하지 않는다.
// 서버 측 복원 의미론은 tests/integration/resume-answer-rehydration.test.ts 가 커버한다.

vi.mock('@/shared/lib/rpc', () => ({
  client: {
    surveyResponse: {
      lifecycle: {
        resume: vi.fn(),
      },
    },
  },
}));

vi.mock('@/components/survey-response/hooks/session-helpers', async (importOriginal) => {
  const actual = await importOriginal<
    typeof import('@/components/survey-response/hooks/session-helpers')
  >();
  return {
    ...actual,
    // 회복 직후 show segment 비콘은 네트워크 호출이라 테스트에서 차단한다.
    sendVisibilitySegment: vi.fn(),
  };
});

const resumeMock = vi.mocked(client.surveyResponse.lifecycle.resume);

const SURVEY = { id: 'survey-1' } as Survey;

function renderRecovery(overrides: Partial<Parameters<typeof useSessionRecovery>[0]> = {}) {
  const setCurrentResponseId = vi.fn();
  const setSessionId = vi.fn();
  const setResponses = vi.fn();
  const hook = renderHook(() =>
    useSessionRecovery({
      isAdminEdit: false,
      loadedSurvey: SURVEY,
      currentResponseId: null,
      inviteToken: null,
      testToken: null,
      isTestSession: false,
      sessionId: 'fresh-session',
      setSessionId,
      setResponses,
      setCurrentResponseId,
      setDuplicateStatus: vi.fn(),
      ...overrides,
    }),
  );
  return { hook, setCurrentResponseId, setSessionId, setResponses };
}

describe('useSessionRecovery invite 크로스 기기 회복', () => {
  beforeEach(() => {
    window.localStorage.clear();
    resumeMock.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('invite 토큰이 있으면 saved sessionId 없이도 resume 을 호출하고 답을 복원한다', async () => {
    resumeMock.mockResolvedValue({
      id: 'response-1',
      status: 'in_progress',
      resumed: true,
      questionResponses: { q1: '저장된 답' },
      currentStepId: 'step-3',
    } as Awaited<ReturnType<typeof client.surveyResponse.lifecycle.resume>>);

    const { setCurrentResponseId, setResponses } = renderRecovery({
      inviteToken: 'invite-1',
    });

    await waitFor(() => expect(setCurrentResponseId).toHaveBeenCalledWith('response-1'));
    expect(resumeMock).toHaveBeenCalledWith({
      surveyId: 'survey-1',
      sessionId: 'fresh-session',
      inviteToken: 'invite-1',
    });
    expect(setResponses).toHaveBeenCalledWith({ q1: '저장된 답' });
    // 이후 같은 브라우저 재진입이 saved-session 경로를 타도록 키가 저장된다.
    expect(window.localStorage.getItem(sessionStorageKey('survey-1', 'invite-1'))).toBe(
      'fresh-session',
    );
  });

  it('invite 도 saved sessionId 도 없으면 resume 을 호출하지 않는다', async () => {
    renderRecovery();
    // effect 가 동기적으로 게이트에서 반환하는지 microtask flush 후 확인
    await act(async () => {});
    expect(resumeMock).not.toHaveBeenCalled();
  });

  it('saved sessionId 가 있으면 기존대로 그 값으로 resume 을 호출한다', async () => {
    window.localStorage.setItem(sessionStorageKey('survey-1', 'invite-1'), 'saved-session');
    resumeMock.mockResolvedValue(null as Awaited<
      ReturnType<typeof client.surveyResponse.lifecycle.resume>
    >);

    renderRecovery({ inviteToken: 'invite-1' });

    await waitFor(() =>
      expect(resumeMock).toHaveBeenCalledWith({
        surveyId: 'survey-1',
        sessionId: 'saved-session',
        inviteToken: 'invite-1',
      }),
    );
  });
});
