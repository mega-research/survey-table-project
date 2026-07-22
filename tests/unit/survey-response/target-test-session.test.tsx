import { createRef, StrictMode } from 'react';
import type { RefObject } from 'react';

import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  sendVisibilitySegment,
  sessionStorageKey,
} from '@/components/survey-response/hooks/session-helpers';
import { handleInvalidTestLinkMutationError } from '@/components/survey-response/hooks/use-duplicate-guard';
import { useResponseTelemetry } from '@/components/survey-response/hooks/use-response-telemetry';
import { useSessionRecovery } from '@/components/survey-response/hooks/use-session-recovery';
import { SurveyResponseFlow } from '@/components/survey-response/survey-response-flow';
import type { RenderStep } from '@/lib/group-ordering';
import { useSurveyResponseStore } from '@/stores/survey-response-store';
import type { Survey } from '@/types/survey';

const {
  stepVisit,
  resume,
  bySlug,
  byPrivateToken,
  forResponse,
  attrsLookup,
  createWithFirstAnswer,
  createBlank,
  complete,
  checkOnEntry,
} = vi.hoisted(() => ({
  stepVisit: vi.fn(),
  resume: vi.fn(),
  bySlug: vi.fn(),
  byPrivateToken: vi.fn(),
  forResponse: vi.fn(),
  attrsLookup: vi.fn(),
  createWithFirstAnswer: vi.fn(),
  createBlank: vi.fn(),
  complete: vi.fn(),
  checkOnEntry: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock('@/shared/lib/rpc', () => ({
  client: {
    surveyBuilder: {
      publicRead: {
        bySlug: (...args: unknown[]) => bySlug(...args),
        byPrivateToken: (...args: unknown[]) => byPrivateToken(...args),
        forResponse: (...args: unknown[]) => forResponse(...args),
      },
    },
    contacts: {
      attrs: {
        lookup: (...args: unknown[]) => attrsLookup(...args),
      },
    },
    surveyResponse: {
      lifecycle: {
        stepVisit: (...args: unknown[]) => stepVisit(...args),
        resume: (...args: unknown[]) => resume(...args),
      },
      response: {
        createWithFirstAnswer: (...args: unknown[]) => createWithFirstAnswer(...args),
        createBlank: (...args: unknown[]) => createBlank(...args),
        complete: (...args: unknown[]) => complete(...args),
      },
      duplicate: {
        checkOnEntry: (...args: unknown[]) => checkOnEntry(...args),
      },
    },
    quota: { check: vi.fn() },
  },
}));

const targetSurvey = {
  id: 'survey-1',
  title: '대상자 테스트 설문',
  status: 'published',
  currentVersionId: 'version-1',
  groups: [],
  questions: [
    {
      id: 'q1',
      type: 'text',
      title: '첫 번째 질문',
      description: '',
      required: false,
      order: 0,
      placeholder: '첫 답변',
    },
    {
      id: 'q2',
      type: 'text',
      title: '두 번째 질문',
      description: '',
      required: false,
      order: 1,
      placeholder: '두 번째 답변',
    },
  ],
  settings: {
    isPublic: true,
    allowMultipleResponses: false,
    showProgressBar: true,
    shuffleQuestions: false,
    requireLogin: false,
    thankYouMessage: '감사합니다.',
    requireInviteToken: false,
  },
  lookups: [],
  createdAt: new Date('2026-07-22T00:00:00.000Z'),
  updatedAt: new Date('2026-07-22T00:00:00.000Z'),
} as Survey;

function readBlob(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener('load', () => resolve(String(reader.result)));
    reader.addEventListener('error', () => reject(reader.error));
    reader.readAsText(blob);
  });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

describe('대상자 테스트 응답 세션', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: vi.fn(() => ({
        matches: false,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    });
    window.localStorage.clear();
    useSurveyResponseStore.getState().resetResponseState();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    stepVisit.mockReset();
    resume.mockReset();
    bySlug.mockReset();
    byPrivateToken.mockReset();
    forResponse.mockReset();
    attrsLookup.mockReset();
    createWithFirstAnswer.mockReset();
    createBlank.mockReset();
    complete.mockReset();
    checkOnEntry.mockReset();
  });

  it('같은 설문의 localStorage 세션을 invite token별로 격리한다', () => {
    expect(sessionStorageKey('survey-1', 'invite-a')).toBe(
      'survey-session:survey-1:invite:invite-a',
    );
    expect(sessionStorageKey('survey-1', 'invite-b')).toBe(
      'survey-session:survey-1:invite:invite-b',
    );
    expect(sessionStorageKey('survey-1')).toBe('survey-session:survey-1');
  });

  it('초기 무효 테스트 링크는 stale 응답 상태를 비우고 recovery와 telemetry를 mount하지 않는다', async () => {
    bySlug.mockResolvedValue({ id: 'survey-1' });
    forResponse.mockResolvedValue({
      survey: targetSurvey,
      versionId: 'version-1',
      control: {
        isPaused: false,
        pausedMessage: null,
        testSession: 'invalid',
        testSessionKind: null,
      },
    });
    attrsLookup.mockResolvedValue({});
    window.localStorage.setItem(
      'survey-session:survey-1:invite:invite-invalid',
      'stale-session',
    );
    useSurveyResponseStore.getState().setCurrentResponseId('stale-response');
    useSurveyResponseStore.getState().setPendingResponse('q1', 'stale-answer');

    render(
      <SurveyResponseFlow
        surveyIdentifier="target-survey"
        inviteToken="invite-invalid"
        testToken={null}
      />,
    );

    expect(
      await screen.findByRole('heading', { name: '유효하지 않은 테스트 링크입니다' }),
    ).toBeInTheDocument();
    await waitFor(() => {
      expect(useSurveyResponseStore.getState().currentResponseId).toBeNull();
      expect(useSurveyResponseStore.getState().pendingResponses).toEqual({});
      expect(
        window.localStorage.getItem('survey-session:survey-1:invite:invite-invalid'),
      ).toBeNull();
    });
    expect(resume).not.toHaveBeenCalled();
    expect(stepVisit).not.toHaveBeenCalled();
  });

  it('페이지 종료 segment의 sendBeacon 본문에 attempt identity를 보낸다', async () => {
    const sendBeacon = vi.fn<(url: string, data?: BodyInit | null) => boolean>(() => true);
    Object.defineProperty(navigator, 'sendBeacon', {
      configurable: true,
      value: sendBeacon,
    });
    const identity = {
      attemptId: '77777777-8888-4999-8aaa-bbbbbbbbbbbb',
      sessionId: 'target-session',
    };

    sendVisibilitySegment('response-1', 'hide', identity, true);

    expect(sendBeacon).toHaveBeenCalledTimes(1);
    const body = sendBeacon.mock.calls[0]?.[1] as Blob;
    await expect(readBlob(body)).resolves.toBe(
      JSON.stringify({ responseId: 'response-1', action: 'hide', ...identity }),
    );
  });

  it('소유권 획득 전 telemetry를 막고 이후 같은 attempt identity를 보낸다', async () => {
    stepVisit.mockResolvedValue(undefined);
    const fetchMock = vi.fn<typeof fetch>(async () => new Response('{}'));
    vi.stubGlobal('fetch', fetchMock);
    const identity = {
      attemptId: '77777777-8888-4999-8aaa-bbbbbbbbbbbb',
      sessionId: 'target-session',
    };
    const currentStep = {
      kind: 'group',
      id: 'step-1',
      items: [],
    } as unknown as RenderStep;
    const visibleProgressRef = createRef<{
      index: number;
      total: number;
    }>() as RefObject<{ index: number; total: number }>;
    visibleProgressRef.current = { index: 1, total: 2 };
    const initialProps = {
      enabled: false,
      isAdminEdit: false,
      currentResponseId: 'response-1',
      currentStep,
      isCompleted: false,
      visibleProgressRef,
      testIdentity: identity,
    };
    const { rerender } = renderHook((props: typeof initialProps) => useResponseTelemetry(props), {
      initialProps,
    });

    expect(stepVisit).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();

    rerender({ ...initialProps, enabled: true });

    await waitFor(() => expect(stepVisit).toHaveBeenCalledWith(expect.objectContaining(identity)));
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await waitFor(() => {
      const body = fetchMock.mock.calls.at(-1)?.[1]?.body;
      expect(JSON.parse(String(body))).toMatchObject(identity);
    });
  });

  it('저장 key가 없는 대상자 테스트도 현재 session으로 답을 읽되 telemetry는 쓰지 않는다', async () => {
    window.localStorage.clear();
    resume.mockResolvedValue({
      id: 'response-1',
      status: 'in_progress',
      resumed: false,
      questionResponses: { q1: '기존 답' },
    });
    const fetchMock = vi.fn<typeof fetch>(async () => new Response('{}'));
    vi.stubGlobal('fetch', fetchMock);
    const setResponses = vi.fn();
    const setCurrentResponseId = vi.fn();
    const survey = { id: 'survey-1' } as Survey;

    const { result } = renderHook(() =>
      useSessionRecovery({
        isAdminEdit: false,
        loadedSurvey: survey,
        currentResponseId: null,
        inviteToken: 'invite-a',
        testToken: null,
        isTestSession: true,
        isTargetTestSession: true,
        sessionId: 'new-page-session',
        setSessionId: vi.fn(),
        setResponses,
        setCurrentResponseId,
        setDuplicateStatus: vi.fn(),
      }),
    );

    await waitFor(() => expect(result.current.isRecovering).toBe(false));
    expect(resume).toHaveBeenCalledWith({
      surveyId: 'survey-1',
      sessionId: 'new-page-session',
      inviteToken: 'invite-a',
    });
    expect(setResponses).toHaveBeenCalledWith({ q1: '기존 답' });
    expect(setCurrentResponseId).toHaveBeenCalledWith('response-1');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('이전 identity의 지연된 resume 결과가 새 identity의 응답 상태를 덮지 않는다', async () => {
    const first = deferred<{
      id: string;
      status: 'in_progress';
      resumed: false;
      questionResponses: Record<string, unknown>;
    } | null>();
    const second = deferred<{
      id: string;
      status: 'in_progress';
      resumed: false;
      questionResponses: Record<string, unknown>;
    } | null>();
    resume.mockImplementation(({ sessionId }: { sessionId: string }) =>
      sessionId === 'session-a' ? first.promise : second.promise,
    );
    const setResponses = vi.fn();
    const setCurrentResponseId = vi.fn();
    const setSessionId = vi.fn();
    const setDuplicateStatus = vi.fn();
    const survey = { id: 'survey-1' } as Survey;
    const base = {
      isAdminEdit: false,
      loadedSurvey: survey,
      currentResponseId: null,
      testToken: null,
      isTestSession: true,
      isTargetTestSession: true,
      setSessionId,
      setResponses,
      setCurrentResponseId,
      setDuplicateStatus,
    };

    const { result, rerender } = renderHook(
      (props: { inviteToken: string; sessionId: string }) =>
        useSessionRecovery({ ...base, ...props }),
      { initialProps: { inviteToken: 'invite-a', sessionId: 'session-a' } },
    );
    expect(result.current.isRecovering).toBe(true);

    rerender({ inviteToken: 'invite-b', sessionId: 'session-b' });
    await act(async () => {
      second.resolve({
        id: 'response-b',
        status: 'in_progress',
        resumed: false,
        questionResponses: { q1: 'B 답' },
      });
      await second.promise;
    });
    await waitFor(() => expect(setCurrentResponseId).toHaveBeenCalledWith('response-b'));

    await act(async () => {
      first.resolve({
        id: 'response-a',
        status: 'in_progress',
        resumed: false,
        questionResponses: { q1: 'A 답' },
      });
      await first.promise;
    });

    expect(setCurrentResponseId).not.toHaveBeenCalledWith('response-a');
    expect(setResponses).not.toHaveBeenCalledWith({ q1: 'A 답' });
    expect(result.current.isRecovering).toBe(false);
  });

  it('StrictMode에서 같은 identity resume를 한 번만 요청한다', async () => {
    const pending = deferred<null>();
    resume.mockReturnValue(pending.promise);
    const args = {
      isAdminEdit: false,
      loadedSurvey: { id: 'survey-1' } as Survey,
      currentResponseId: null,
      inviteToken: 'invite-a',
      testToken: null,
      isTestSession: true,
      isTargetTestSession: true,
      sessionId: 'session-a',
      setSessionId: vi.fn(),
      setResponses: vi.fn(),
      setCurrentResponseId: vi.fn(),
      setDuplicateStatus: vi.fn(),
    };

    const view = renderHook(
      () => useSessionRecovery(args),
      { wrapper: StrictMode },
    );

    expect(resume).toHaveBeenCalledTimes(1);
    await act(async () => {
      pending.resolve(null);
      await pending.promise;
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(view.result.current.isRecovering).toBe(false);
  });

  it('이전 identity의 지연된 resume 실패가 새 identity를 차단하지 않는다', async () => {
    const first = deferred<null>();
    const second = deferred<null>();
    resume.mockImplementation(({ sessionId }: { sessionId: string }) =>
      sessionId === 'session-a' ? first.promise : second.promise,
    );
    const setDuplicateStatus = vi.fn();
    const base = {
      isAdminEdit: false,
      loadedSurvey: { id: 'survey-1' } as Survey,
      currentResponseId: null,
      testToken: null,
      isTestSession: true,
      isTargetTestSession: true,
      setSessionId: vi.fn(),
      setResponses: vi.fn(),
      setCurrentResponseId: vi.fn(),
      setDuplicateStatus,
    };
    const { rerender } = renderHook(
      (props: { inviteToken: string; sessionId: string }) =>
        useSessionRecovery({ ...base, ...props }),
      { initialProps: { inviteToken: 'invite-a', sessionId: 'session-a' } },
    );

    rerender({ inviteToken: 'invite-b', sessionId: 'session-b' });
    await act(async () => {
      second.resolve(null);
      await second.promise;
      first.reject(new Error('survey_paused'));
      await first.promise.catch(() => undefined);
    });

    expect(setDuplicateStatus).not.toHaveBeenCalled();
  });

  it('unmount 후 도착한 resume 결과는 외부 상태를 갱신하지 않는다', async () => {
    const pending = deferred<{
      id: string;
      status: 'in_progress';
      resumed: false;
      questionResponses: Record<string, unknown>;
    } | null>();
    resume.mockReturnValue(pending.promise);
    const setResponses = vi.fn();
    const setCurrentResponseId = vi.fn();
    const { unmount } = renderHook(() =>
      useSessionRecovery({
        isAdminEdit: false,
        loadedSurvey: { id: 'survey-1' } as Survey,
        currentResponseId: null,
        inviteToken: 'invite-a',
        testToken: null,
        isTestSession: true,
        isTargetTestSession: true,
        sessionId: 'session-a',
        setSessionId: vi.fn(),
        setResponses,
        setCurrentResponseId,
        setDuplicateStatus: vi.fn(),
      }),
    );

    unmount();
    await act(async () => {
      pending.resolve({
        id: 'response-a',
        status: 'in_progress',
        resumed: false,
        questionResponses: { q1: 'A 답' },
      });
      await pending.promise;
    });

    expect(setCurrentResponseId).not.toHaveBeenCalled();
    expect(setResponses).not.toHaveBeenCalled();
  });

  it('target test 첫 입력과 후속 telemetry에 같은 attemptId와 sessionId를 보낸다', async () => {
    bySlug.mockResolvedValue({ id: 'survey-1' });
    forResponse.mockResolvedValue({
      survey: targetSurvey,
      versionId: 'version-1',
      control: {
        isPaused: false,
        pausedMessage: null,
        testSession: 'valid',
        testSessionKind: 'target',
      },
    });
    attrsLookup.mockResolvedValue({});
    resume.mockResolvedValue(null);
    createWithFirstAnswer.mockResolvedValue({
      kind: 'created',
      id: 'response-1',
      contactTargetId: 'target-1',
    });
    stepVisit.mockResolvedValue(undefined);

    render(
      <SurveyResponseFlow
        surveyIdentifier="target-survey"
        inviteToken="invite-a"
        testToken={null}
      />,
    );

    fireEvent.change(await screen.findByPlaceholderText('첫 답변'), {
      target: { value: '응답' },
    });

    await waitFor(() => expect(createWithFirstAnswer).toHaveBeenCalledTimes(1));
    const createInput = createWithFirstAnswer.mock.calls[0]?.[0] as {
      attemptId?: string;
      sessionId?: string;
    };
    expect(createInput.attemptId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    expect(createInput.sessionId).toBeTruthy();
    await waitFor(() =>
      expect(stepVisit).toHaveBeenCalledWith(
        expect.objectContaining({
          attemptId: createInput.attemptId,
          sessionId: createInput.sessionId,
        }),
      ),
    );
  });

  it('마스킹된 저장 오류도 재조회 결과가 invalid target이면 종료 상태로 전환한다', async () => {
    forResponse.mockResolvedValue({
      survey: targetSurvey,
      versionId: 'version-1',
      control: {
        isPaused: false,
        pausedMessage: null,
        testSession: 'invalid',
        testSessionKind: null,
      },
    });
    const setDuplicateStatus = vi.fn();
    const onInvalid = vi.fn();

    await expect(
      handleInvalidTestLinkMutationError({
        err: new Error('Internal server error'),
        surveyId: 'survey-1',
        inviteToken: 'invite-a',
        isTargetTestSession: true,
        setDuplicateStatus,
        onInvalid,
      }),
    ).resolves.toBe(true);
    expect(forResponse).toHaveBeenCalledWith({
      surveyId: 'survey-1',
      inviteToken: 'invite-a',
    });
    expect(onInvalid).toHaveBeenCalledTimes(1);
    expect(setDuplicateStatus).toHaveBeenCalledWith({
      kind: 'blocked',
      reason: 'invalid_test_token',
    });
  });

  it('terminal 또는 이전 버전 target은 저장 key만 지우고 빈 입력 화면을 유지한다', async () => {
    window.localStorage.setItem('survey-session:survey-1:invite:invite-a', 'old-page-session');
    bySlug.mockResolvedValue({ id: 'survey-1' });
    forResponse.mockResolvedValue({
      survey: targetSurvey,
      versionId: 'version-1',
      control: {
        isPaused: false,
        pausedMessage: null,
        testSession: 'valid',
        testSessionKind: 'target',
      },
    });
    attrsLookup.mockResolvedValue({});
    resume.mockResolvedValue(null);

    render(
      <SurveyResponseFlow
        surveyIdentifier="target-survey"
        inviteToken="invite-a"
        testToken={null}
      />,
    );

    expect(await screen.findByPlaceholderText('첫 답변')).toHaveValue('');
    expect(resume).toHaveBeenCalledWith({
      surveyId: 'survey-1',
      sessionId: 'old-page-session',
      inviteToken: 'invite-a',
    });
    expect(window.localStorage.getItem('survey-session:survey-1:invite:invite-a')).toBeNull();
    expect(createWithFirstAnswer).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: '다시 테스트하기' })).not.toBeInTheDocument();
  });

  it('같은 버전 target 답을 복원해도 첫 새 입력 전에는 telemetry를 쓰지 않는다', async () => {
    bySlug.mockResolvedValue({ id: 'survey-1' });
    forResponse.mockResolvedValue({
      survey: targetSurvey,
      versionId: 'version-1',
      control: {
        isPaused: false,
        pausedMessage: null,
        testSession: 'valid',
        testSessionKind: 'target',
      },
    });
    attrsLookup.mockResolvedValue({});
    resume.mockResolvedValue({
      id: 'response-1',
      status: 'in_progress',
      resumed: false,
      questionResponses: { q1: '기존 답' },
    });
    createWithFirstAnswer.mockResolvedValue({
      kind: 'created',
      id: 'response-1',
      contactTargetId: 'target-1',
    });
    stepVisit.mockResolvedValue(undefined);

    render(
      <SurveyResponseFlow
        surveyIdentifier="target-survey"
        inviteToken="invite-a"
        testToken={null}
      />,
    );

    expect(await screen.findByDisplayValue('기존 답')).toBeInTheDocument();
    expect(stepVisit).not.toHaveBeenCalled();

    fireEvent.change(screen.getByPlaceholderText('두 번째 답변'), {
      target: { value: '새 입력' },
    });

    await waitFor(() =>
      expect(createWithFirstAnswer).toHaveBeenCalledWith(
        expect.objectContaining({
          questionId: 'q2',
          attemptId: expect.any(String),
          sessionId: expect.any(String),
        }),
      ),
    );
    await waitFor(() => expect(stepVisit).toHaveBeenCalledTimes(1));
  });

  it('anonymous test 첫 입력 payload에는 attempt identity를 추가하지 않는다', async () => {
    bySlug.mockResolvedValue({ id: 'survey-1' });
    forResponse.mockResolvedValue({
      survey: targetSurvey,
      versionId: 'version-1',
      control: {
        isPaused: false,
        pausedMessage: null,
        testSession: 'valid',
        testSessionKind: 'anonymous',
      },
    });
    createWithFirstAnswer.mockResolvedValue({
      kind: 'created',
      id: 'anonymous-response-1',
      contactTargetId: null,
    });
    stepVisit.mockResolvedValue(undefined);

    render(
      <SurveyResponseFlow
        surveyIdentifier="target-survey"
        inviteToken={null}
        testToken="anonymous-test-token"
      />,
    );
    fireEvent.change(await screen.findByPlaceholderText('첫 답변'), {
      target: { value: '익명 테스트 응답' },
    });

    await waitFor(() => expect(createWithFirstAnswer).toHaveBeenCalledTimes(1));
    const input = createWithFirstAnswer.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(input['testToken']).toBe('anonymous-test-token');
    expect(input).not.toHaveProperty('attemptId');
  });

  it('flow를 새로 열면 이전 화면과 다른 attempt로 첫 입력을 시작한다', async () => {
    bySlug.mockResolvedValue({ id: 'survey-1' });
    forResponse.mockResolvedValue({
      survey: targetSurvey,
      versionId: 'version-1',
      control: {
        isPaused: false,
        pausedMessage: null,
        testSession: 'valid',
        testSessionKind: 'target',
      },
    });
    attrsLookup.mockResolvedValue({});
    resume.mockResolvedValue(null);
    createWithFirstAnswer
      .mockResolvedValueOnce({
        kind: 'created',
        id: 'response-1',
        contactTargetId: 'target-1',
      })
      .mockResolvedValueOnce({
        kind: 'created',
        id: 'response-1',
        contactTargetId: 'target-1',
      });
    stepVisit.mockResolvedValue(undefined);

    const first = render(
      <SurveyResponseFlow
        surveyIdentifier="target-survey"
        inviteToken="invite-a"
        testToken={null}
      />,
    );
    fireEvent.change(await screen.findByPlaceholderText('첫 답변'), {
      target: { value: '첫 화면' },
    });
    await waitFor(() => expect(createWithFirstAnswer).toHaveBeenCalledTimes(1));
    const firstAttempt = createWithFirstAnswer.mock.calls[0]?.[0]?.attemptId;
    first.unmount();
    useSurveyResponseStore.getState().resetResponseState();

    render(
      <SurveyResponseFlow
        surveyIdentifier="target-survey"
        inviteToken="invite-a"
        testToken={null}
      />,
    );
    await waitFor(() => expect(resume).toHaveBeenCalledTimes(2));
    fireEvent.change(await screen.findByPlaceholderText('첫 답변'), {
      target: { value: '새 화면' },
    });
    await waitFor(() => expect(createWithFirstAnswer).toHaveBeenCalledTimes(2));
    const secondAttempt = createWithFirstAnswer.mock.calls[1]?.[0]?.attemptId;

    expect(firstAttempt).toMatch(/^[0-9a-f-]{36}$/i);
    expect(secondAttempt).toMatch(/^[0-9a-f-]{36}$/i);
    expect(secondAttempt).not.toBe(firstAttempt);
  });

  it('같은 flow에서 invite identity가 바뀌면 이전 응답을 새 invite로 완료하지 않는다', async () => {
    bySlug.mockResolvedValue({ id: 'survey-1' });
    forResponse.mockResolvedValue({
      survey: targetSurvey,
      versionId: 'version-1',
      control: {
        isPaused: false,
        pausedMessage: null,
        testSession: 'valid',
        testSessionKind: 'target',
      },
    });
    attrsLookup.mockResolvedValue({});
    resume.mockResolvedValue(null);
    createWithFirstAnswer
      .mockResolvedValueOnce({ kind: 'created', id: 'response-a', contactTargetId: 'target-a' })
      .mockResolvedValueOnce({ kind: 'created', id: 'response-b', contactTargetId: 'target-b' });
    complete.mockResolvedValue(undefined);
    stepVisit.mockResolvedValue(undefined);

    const { rerender } = render(
      <SurveyResponseFlow
        surveyIdentifier="target-survey"
        inviteToken="invite-a"
        testToken={null}
      />,
    );
    fireEvent.change(await screen.findByPlaceholderText('첫 답변'), {
      target: { value: 'A 응답' },
    });
    await waitFor(() => expect(createWithFirstAnswer).toHaveBeenCalledTimes(1));
    const firstCreate = createWithFirstAnswer.mock.calls[0]?.[0] as {
      attemptId: string;
      sessionId: string;
    };

    rerender(
      <SurveyResponseFlow
        surveyIdentifier="target-survey"
        inviteToken="invite-b"
        testToken={null}
      />,
    );

    expect(await screen.findByPlaceholderText('첫 답변')).toHaveValue('');
    await waitFor(() => expect(resume).toHaveBeenCalledTimes(2));
    await act(async () => {
      await Promise.resolve();
    });
    fireEvent.change(screen.getByPlaceholderText('첫 답변'), {
      target: { value: 'B 응답' },
    });
    await waitFor(() => expect(createWithFirstAnswer).toHaveBeenCalledTimes(2));
    const secondCreate = createWithFirstAnswer.mock.calls[1]?.[0] as {
      attemptId: string;
      sessionId: string;
    };
    expect(secondCreate.attemptId).not.toBe(firstCreate.attemptId);
    expect(secondCreate.sessionId).not.toBe(firstCreate.sessionId);

    fireEvent.click(screen.getByRole('button', { name: '제출' }));
    await waitFor(() =>
      expect(complete).toHaveBeenCalledWith(
        expect.objectContaining({
          responseId: 'response-b',
          attemptId: secondCreate.attemptId,
          sessionId: secondCreate.sessionId,
        }),
      ),
    );
    expect(complete).not.toHaveBeenCalledWith(
      expect.objectContaining({ responseId: 'response-a' }),
    );
  });

  it('저장 중 무효화된 target 링크는 재시작 CTA 없는 종료 화면으로 전환한다', async () => {
    bySlug.mockResolvedValue({ id: 'survey-1' });
    forResponse.mockResolvedValue({
      survey: targetSurvey,
      versionId: 'version-1',
      control: {
        isPaused: false,
        pausedMessage: null,
        testSession: 'valid',
        testSessionKind: 'target',
      },
    });
    attrsLookup.mockResolvedValue({});
    resume.mockResolvedValue(null);
    createWithFirstAnswer.mockResolvedValue({
      kind: 'blocked',
      reason: 'invalid_test_token',
    });

    render(
      <SurveyResponseFlow
        surveyIdentifier="target-survey"
        inviteToken="invite-a"
        testToken={null}
      />,
    );
    fireEvent.change(await screen.findByPlaceholderText('첫 답변'), {
      target: { value: '응답' },
    });

    expect(
      await screen.findByRole('heading', { name: '유효하지 않은 테스트 링크입니다' }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '다시 테스트하기' })).not.toBeInTheDocument();
  });
});
