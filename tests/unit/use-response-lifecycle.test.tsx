import { createRef } from 'react';

import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useResponseLifecycle } from '@/components/survey-response/hooks/use-response-lifecycle';
import type { RenderStep } from '@/lib/group-ordering';
import type { Question, QuestionGroup, Survey } from '@/types/survey';
import type { BranchEvalCtx } from '@/utils/branch-logic';

// RPC client 모킹 — 응답 쓰기 경로(createWithFirstAnswer/createBlank/complete)만 사용.
const createWithFirstAnswer = vi.fn();
const createBlank = vi.fn();
const complete = vi.fn();

vi.mock('@/shared/lib/rpc', () => ({
  client: {
    surveyResponse: {
      response: {
        createWithFirstAnswer: (...args: unknown[]) => createWithFirstAnswer(...args),
        createBlank: (...args: unknown[]) => createBlank(...args),
        complete: (...args: unknown[]) => complete(...args),
      },
    },
  },
}));

const survey = { id: 'survey-1', title: 't' } as unknown as Survey;
const step: RenderStep = {
  kind: 'group',
  rootGroupName: 'g',
  items: [],
} as unknown as RenderStep;

const emptyEvalCtx: BranchEvalCtx = {
  responses: {},
  contactAttrs: {},
  lookups: [],
} as unknown as BranchEvalCtx;

// 훅 인자 기본값. 각 테스트가 필요한 필드만 override 한다.
function baseArgs(over: Partial<Parameters<typeof useResponseLifecycle>[0]> = {}) {
  // 실제 컴포넌트는 매 렌더 visibleProgressRef.current 를 채우므로 기본값으로 채워둔다.
  const visibleProgressRef = createRef<{ index: number; total: number }>() as React.RefObject<{
    index: number;
    total: number;
  }>;
  visibleProgressRef.current = { index: 0, total: 0 };
  return {
    isAdminEdit: false,
    adminContext: undefined,
    inviteToken: null,
    testToken: null as string | null,
    isTestSession: false,
    testIdentity: null,
    hasTestAttemptOwnership: false,
    setHasTestAttemptOwnership: vi.fn(),
    loadedSurvey: survey,
    currentStep: step,
    currentStepIndex: 0,
    steps: [step] as RenderStep[],
    questions: [] as Question[],
    groups: [] as QuestionGroup[],
    visibleQuestions: [] as Question[],
    evalCtx: emptyEvalCtx,
    responses: {} as Record<string, unknown>,
    setResponses: vi.fn(),
    sessionId: 'session-abc',
    versionId: null as string | null,
    signals: null,
    honeypotRef: { current: null },
    currentResponseId: null as string | null,
    setCurrentResponseId: vi.fn(),
    setPendingResponse: vi.fn(),
    resetResponseState: vi.fn(),
    isRecovering: false,
    isQuestionAnswered: vi.fn(() => true),
    visibleProgressRef,
    setHighlightQuestionIds: vi.fn(),
    setDuplicateStatus: vi.fn(),
    setInviteIsInvalid: vi.fn(),
    setIsSubmitting: vi.fn(),
    setCurrentStepIndex: vi.fn(),
    setIsCompleted: vi.fn(),
    setNumericErrorStepIndex: vi.fn(),
    buildOptTextsPayload: vi.fn((_vq: Question[], r: Record<string, unknown>) => r),
    ...over,
  } satisfies Parameters<typeof useResponseLifecycle>[0];
}

describe('useResponseLifecycle - handleResponse INSERT 가드', () => {
  beforeEach(() => {
    createWithFirstAnswer.mockReset();
    createBlank.mockReset();
    complete.mockReset();
    createWithFirstAnswer.mockResolvedValue({ id: 'resp-1', contactTargetId: 'c1' });
    window.localStorage.clear();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('첫 답변(currentResponseId null + 가드 통과)이면 createWithFirstAnswer 를 1회 발사한다', async () => {
    const args = baseArgs();
    // ref 에 진척 미러값 채움 (실제 컴포넌트가 매 렌더 채우는 의미론)
    args.visibleProgressRef.current = { index: 2, total: 5 };
    const { result } = renderHook(() => useResponseLifecycle(args));

    act(() => {
      result.current.handleResponse('q1', 'v1');
    });

    expect(args.setResponses).toHaveBeenCalledTimes(1);
    expect(args.setPendingResponse).toHaveBeenCalledWith('q1', 'v1');
    expect(createWithFirstAnswer).toHaveBeenCalledTimes(1);
    expect(createWithFirstAnswer).toHaveBeenCalledWith(
      expect.objectContaining({
        surveyId: 'survey-1',
        sessionId: 'session-abc',
        questionId: 'q1',
        value: 'v1',
        visibleStepIndex: 2,
        visibleStepTotal: 5,
        clientSignals: null,
      }),
    );

    await waitFor(() => expect(args.setCurrentResponseId).toHaveBeenCalledWith('resp-1'));
  });

  it('admin-edit 모드면 INSERT 를 발사하지 않는다 (분기 5/8)', () => {
    const args = baseArgs({ isAdminEdit: true });
    const { result } = renderHook(() => useResponseLifecycle(args));
    act(() => {
      result.current.handleResponse('q1', 'v1');
    });
    // UI 즉시 반영은 동일하게 일어나되 DB 쓰기는 없음
    expect(args.setResponses).toHaveBeenCalledTimes(1);
    expect(args.setPendingResponse).toHaveBeenCalledTimes(1);
    expect(createWithFirstAnswer).not.toHaveBeenCalled();
  });

  it('preview 모드면 UI 상태만 반영하고 INSERT 를 발사하지 않는다', () => {
    const args = baseArgs({ isPreview: true });
    const { result } = renderHook(() => useResponseLifecycle(args));
    act(() => {
      result.current.handleResponse('q1', 'v1');
    });
    expect(args.setResponses).toHaveBeenCalledTimes(1);
    expect(args.setPendingResponse).toHaveBeenCalledWith('q1', 'v1');
    expect(createWithFirstAnswer).not.toHaveBeenCalled();
  });

  it('currentResponseId 가 이미 있으면 INSERT 를 발사하지 않는다', () => {
    const args = baseArgs({ currentResponseId: 'existing' });
    const { result } = renderHook(() => useResponseLifecycle(args));
    act(() => {
      result.current.handleResponse('q1', 'v1');
    });
    expect(createWithFirstAnswer).not.toHaveBeenCalled();
  });

  it('대상자 테스트 회복 응답은 첫 새 입력에서 attempt 소유권을 획득한다', async () => {
    createWithFirstAnswer.mockResolvedValue({
      kind: 'created',
      id: 'existing',
      contactTargetId: 'target-1',
    });
    const testIdentity = {
      attemptId: '77777777-8888-4999-8aaa-bbbbbbbbbbbb',
      sessionId: 'target-session',
    };
    const args = baseArgs({
      currentResponseId: 'existing',
      isTestSession: true,
      inviteToken: 'target-invite',
      testIdentity,
    });
    const { result } = renderHook(() => useResponseLifecycle(args));

    act(() => {
      result.current.handleResponse('q2', '새 입력');
    });

    expect(createWithFirstAnswer).toHaveBeenCalledWith(expect.objectContaining(testIdentity));
    await waitFor(() => expect(args.setHasTestAttemptOwnership).toHaveBeenCalledWith(true));
  });

  it('isRecovering 중이면 INSERT 를 발사하지 않는다 (I-1 가드)', () => {
    const args = baseArgs({ isRecovering: true });
    const { result } = renderHook(() => useResponseLifecycle(args));
    act(() => {
      result.current.handleResponse('q1', 'v1');
    });
    expect(createWithFirstAnswer).not.toHaveBeenCalled();
  });

  it('invite 토큰이 있는데 contactTargetId 매칭 실패면 setInviteIsInvalid 호출', async () => {
    createWithFirstAnswer.mockResolvedValue({ id: 'resp-2', contactTargetId: null });
    const args = baseArgs({ inviteToken: 'tok-1' });
    const { result } = renderHook(() => useResponseLifecycle(args));
    act(() => {
      result.current.handleResponse('q1', 'v1');
    });
    await waitFor(() => expect(args.setInviteIsInvalid).toHaveBeenCalledWith(true));
  });

  it('blocked 결과면 setDuplicateStatus(blocked) 만 호출하고 responseId 는 set 하지 않는다', async () => {
    createWithFirstAnswer.mockResolvedValue({ kind: 'blocked', reason: 'ip' });
    const args = baseArgs();
    const { result } = renderHook(() => useResponseLifecycle(args));
    act(() => {
      result.current.handleResponse('q1', 'v1');
    });
    await waitFor(() =>
      expect(args.setDuplicateStatus).toHaveBeenCalledWith({
        kind: 'blocked',
        reason: 'ip',
      }),
    );
    expect(args.setCurrentResponseId).not.toHaveBeenCalled();
  });

  it('대상자 테스트 링크가 저장 시 무효화되면 scoped 세션과 응답 상태를 지운다', async () => {
    createWithFirstAnswer.mockResolvedValue({
      kind: 'blocked',
      reason: 'invalid_test_token',
    });
    const inviteToken = 'target-invite';
    window.localStorage.setItem(`survey-session:survey-1:invite:${inviteToken}`, 'stale-session');
    const args = baseArgs({
      inviteToken,
      isTestSession: true,
      testIdentity: {
        attemptId: '77777777-8888-4999-8aaa-bbbbbbbbbbbb',
        sessionId: 'target-session',
      },
    });
    const { result } = renderHook(() => useResponseLifecycle(args));

    act(() => {
      result.current.handleResponse('q1', '응답');
    });

    await waitFor(() =>
      expect(args.setDuplicateStatus).toHaveBeenCalledWith({
        kind: 'blocked',
        reason: 'invalid_test_token',
      }),
    );
    expect(window.localStorage.getItem(`survey-session:survey-1:invite:${inviteToken}`)).toBeNull();
    expect(args.resetResponseState).toHaveBeenCalledTimes(1);
    expect(args.setResponses).toHaveBeenCalledWith({});
  });
});

describe('useResponseLifecycle - handleSubmit', () => {
  beforeEach(() => {
    createWithFirstAnswer.mockReset();
    createBlank.mockReset();
    complete.mockReset();
    complete.mockResolvedValue(undefined);
    window.localStorage.clear();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('currentResponseId 가 null 이면 blank fallback INSERT 후 complete 한다', async () => {
    createBlank.mockResolvedValue({ id: 'blank-1', contactTargetId: 'c1' });
    const args = baseArgs({ currentResponseId: null });
    const { result } = renderHook(() => useResponseLifecycle(args));

    await act(async () => {
      await result.current.handleSubmit();
    });

    expect(createBlank).toHaveBeenCalledTimes(1);
    expect(args.setCurrentResponseId).toHaveBeenCalledWith('blank-1');
    expect(complete).toHaveBeenCalledTimes(1);
    expect(complete).toHaveBeenCalledWith(expect.objectContaining({ responseId: 'blank-1' }));
    expect(args.setIsCompleted).toHaveBeenCalledWith(true);
  });

  it('currentResponseId 가 이미 있으면 blank INSERT 없이 바로 complete 한다', async () => {
    const args = baseArgs({ currentResponseId: 'resp-existing' });
    const { result } = renderHook(() => useResponseLifecycle(args));

    await act(async () => {
      await result.current.handleSubmit();
    });

    expect(createBlank).not.toHaveBeenCalled();
    expect(complete).toHaveBeenCalledWith(expect.objectContaining({ responseId: 'resp-existing' }));
    expect(args.setIsCompleted).toHaveBeenCalledWith(true);
  });

  it('대상자 테스트 회복 응답 제출은 같은 attempt로 소유권을 얻은 뒤 완료한다', async () => {
    createBlank.mockResolvedValue({
      kind: 'created',
      id: 'resp-existing',
      contactTargetId: 'target-1',
    });
    const testIdentity = {
      attemptId: '77777777-8888-4999-8aaa-bbbbbbbbbbbb',
      sessionId: 'target-session',
    };
    const args = baseArgs({
      currentResponseId: 'resp-existing',
      isTestSession: true,
      inviteToken: 'target-invite',
      testIdentity,
    });
    const { result } = renderHook(() => useResponseLifecycle(args));

    await act(async () => {
      await result.current.handleSubmit();
    });

    expect(createBlank).toHaveBeenCalledWith(expect.objectContaining(testIdentity));
    expect(complete).toHaveBeenCalledWith(
      expect.objectContaining({ responseId: 'resp-existing', ...testIdentity }),
    );
    expect(args.setHasTestAttemptOwnership).toHaveBeenCalledWith(true);
  });

  it('blank fallback 이 blocked 면 complete 없이 중단하고 setDuplicateStatus 호출', async () => {
    createBlank.mockResolvedValue({ kind: 'blocked', reason: 'fp' });
    const args = baseArgs({ currentResponseId: null });
    const { result } = renderHook(() => useResponseLifecycle(args));

    await act(async () => {
      await result.current.handleSubmit();
    });

    expect(args.setDuplicateStatus).toHaveBeenCalledWith({
      kind: 'blocked',
      reason: 'fp',
    });
    expect(complete).not.toHaveBeenCalled();
    expect(args.setIsCompleted).not.toHaveBeenCalled();
  });

  it('preview 모드 제출은 blank INSERT/complete 없이 완료 화면으로 전환한다', async () => {
    const args = baseArgs({ isPreview: true, currentResponseId: null });
    const { result } = renderHook(() => useResponseLifecycle(args));

    await act(async () => {
      await result.current.handleSubmit();
    });

    expect(createBlank).not.toHaveBeenCalled();
    expect(complete).not.toHaveBeenCalled();
    expect(args.resetResponseState).toHaveBeenCalledTimes(1);
    expect(args.setIsCompleted).toHaveBeenCalledWith(true);
  });

  it('admin-edit 모드면 onSubmit 으로 위임하고 새 INSERT/complete 를 하지 않는다 (분기 6/8)', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const adminContext = {
      responseId: 'r',
      surveyId: 's',
      initialResponses: {},
      versionSnapshot: null,
      initialContactAttrs: {},
      onSubmit,
    };
    const args = baseArgs({ isAdminEdit: true, adminContext });
    const { result } = renderHook(() => useResponseLifecycle(args));

    await act(async () => {
      await result.current.handleSubmit();
    });

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(createBlank).not.toHaveBeenCalled();
    expect(complete).not.toHaveBeenCalled();
    expect(args.resetResponseState).toHaveBeenCalledTimes(1);
    expect(args.setIsCompleted).not.toHaveBeenCalled();
  });

  it('숫자 차단형 검증 위반이면 제출을 진행하지 않고 setNumericErrorStepIndex 를 호출한다', async () => {
    const numQ = {
      id: 'q-num',
      type: 'text',
      title: '숫자',
      required: false,
      order: 0,
      inputType: 'number',
      numberFormat: { min: 10 },
    } as unknown as Question;
    const numStep: RenderStep = {
      kind: 'page',
      items: [{ question: numQ, rootGroupId: null, rootGroupName: null, subgroupName: null }],
    } as unknown as RenderStep;
    const args = baseArgs({
      questions: [numQ],
      steps: [numStep],
      currentStep: numStep,
      currentStepIndex: 0,
      // min 10 미달 — collectNumericIssues 가 range 위반을 반환한다
      responses: { 'q-num': '5' },
    });
    const { result } = renderHook(() => useResponseLifecycle(args));

    await act(async () => {
      await result.current.handleSubmit();
    });

    expect(args.setNumericErrorStepIndex).toHaveBeenCalledWith(0);
    expect(args.setIsSubmitting).toHaveBeenCalledWith(false);
    expect(createBlank).not.toHaveBeenCalled();
    expect(complete).not.toHaveBeenCalled();
    expect(args.setIsCompleted).not.toHaveBeenCalled();
  });
});
