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
const saveDraft = vi.fn();

vi.mock('@/shared/lib/rpc', () => ({
  client: {
    surveyResponse: {
      response: {
        createWithFirstAnswer: (...args: unknown[]) => createWithFirstAnswer(...args),
        createBlank: (...args: unknown[]) => createBlank(...args),
        complete: (...args: unknown[]) => complete(...args),
        saveDraft: (...args: unknown[]) => saveDraft(...args),
      },
    },
  },
}));

// 백그라운드 자동 저장은 실패해도 토스트를 띄우지 않아야 한다 — 호출 여부 검증용 모킹.
const toastError = vi.fn();
vi.mock('sonner', () => ({
  toast: {
    error: (...args: unknown[]) => toastError(...args),
    success: vi.fn(),
    info: vi.fn(),
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
    contactAttrs: {} as Record<string, string | undefined>,
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
    recoveredDraftSeq: undefined as number | undefined,
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
    saveDraft.mockReset();
    createWithFirstAnswer.mockResolvedValue({ id: 'resp-1', contactTargetId: 'c1' });
    saveDraft.mockResolvedValue({ ok: true, applied: true });
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

  it('마운트 후 수집된 signals 를 첫 답변 INSERT 에 싣는다 (스테일 클로저 회귀 방지)', async () => {
    // 시나리오: signals=null 로 마운트 → 신호 수집 완료로 signals 만 채워진 리렌더 →
    // 다른 deps 는 전부 동일 참조 유지(실제 첫 페이지 상황) → 첫 답변 발사.
    // 클로저가 마운트 시점 null 을 캡처하면 서버 봇 가드가 익명 첫 답변을
    // device_already_responded 로 오차단한다 (2026-08-11 목재이용실태조사 테스트모드 사고).
    const initial = baseArgs();
    const collected = {
      deviceId: 'dev-collected',
      screen: '1512x982',
      tz: 'Asia/Seoul',
      lang: 'ko-KR',
      platform: 'MacIntel',
    };
    const { result, rerender } = renderHook((props) => useResponseLifecycle(props), {
      initialProps: initial,
    });

    // signals 외 모든 필드는 동일 참조 — deps 미변경 상태를 재현한다.
    rerender({ ...initial, signals: collected });

    act(() => {
      result.current.handleResponse('q1', 'v1');
    });

    await waitFor(() => expect(createWithFirstAnswer).toHaveBeenCalledTimes(1));
    expect(createWithFirstAnswer).toHaveBeenCalledWith(
      expect.objectContaining({ clientSignals: collected }),
    );
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

  it('루트 응답 사이드카만 바뀌면 첫 INSERT 없이도 중간 페이지 flush를 통과한다', async () => {
    const args = baseArgs();
    const { result } = renderHook(() => useResponseLifecycle(args));

    act(() => {
      result.current.handleResponse('__dynamicRowSelections__', {
        q1: ['dynamic-row'],
      });
    });

    expect(args.setResponses).toHaveBeenCalledTimes(1);
    expect(args.setPendingResponse).toHaveBeenCalledWith(
      '__dynamicRowSelections__',
      { q1: ['dynamic-row'] },
    );
    expect(createWithFirstAnswer).not.toHaveBeenCalled();
    await expect(result.current.flushPendingAnswers()).resolves.toBe(true);
    expect(saveDraft).not.toHaveBeenCalled();
  });

  it('currentResponseId 가 이미 있으면 INSERT 를 발사하지 않는다', () => {
    const args = baseArgs({ currentResponseId: 'existing' });
    const { result } = renderHook(() => useResponseLifecycle(args));
    act(() => {
      result.current.handleResponse('q1', 'v1');
    });
    expect(createWithFirstAnswer).not.toHaveBeenCalled();
  });

  it('기존 진행 응답의 현재 페이지 답변을 체크포인트로 저장한다', async () => {
    const args = baseArgs({ currentResponseId: 'existing' });
    const { result } = renderHook(() => useResponseLifecycle(args));

    act(() => {
      result.current.handleResponse('q2', '두 번째 답');
    });
    await act(async () => {
      await result.current.flushPendingAnswers();
    });

    expect(saveDraft).toHaveBeenCalledWith({
      responseId: 'existing',
      answers: { q2: '두 번째 답' },
      seq: expect.any(Number),
    });
  });

  it('첫 응답 생성 중 다음을 눌러도 생성 완료 뒤 현재 페이지 답변을 저장한다', async () => {
    let resolveCreate!: (value: { id: string; contactTargetId: string }) => void;
    createWithFirstAnswer.mockReturnValue(
      new Promise((resolve) => {
        resolveCreate = resolve;
      }),
    );
    const args = baseArgs();
    const { result } = renderHook(() => useResponseLifecycle(args));

    act(() => {
      result.current.handleResponse('q1', '첫 번째 답');
    });
    act(() => {
      result.current.handleResponse('q2', '두 번째 답');
    });
    let flushPromise!: Promise<boolean>;
    act(() => {
      flushPromise = result.current.flushPendingAnswers();
    });
    expect(saveDraft).not.toHaveBeenCalled();
    act(() => {
      resolveCreate({ id: 'resp-1', contactTargetId: 'c1' });
    });
    await act(async () => {
      await flushPromise;
    });

    expect(saveDraft).toHaveBeenCalledWith({
      responseId: 'resp-1',
      answers: {
        q1: '첫 번째 답',
        q2: '두 번째 답',
      },
      seq: expect.any(Number),
    });
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

  it('마운트 후 수집된 signals 를 blank fallback INSERT 에 싣는다 (스테일 클로저 회귀 방지)', async () => {
    createBlank.mockResolvedValue({ id: 'blank-2', contactTargetId: null });
    const initial = baseArgs({ currentResponseId: null });
    const collected = {
      deviceId: 'dev-collected',
      screen: '1512x982',
      tz: 'Asia/Seoul',
      lang: 'ko-KR',
      platform: 'MacIntel',
    };
    const { result, rerender } = renderHook((props) => useResponseLifecycle(props), {
      initialProps: initial,
    });
    rerender({ ...initial, signals: collected });

    await act(async () => {
      await result.current.handleSubmit();
    });

    expect(createBlank).toHaveBeenCalledWith(
      expect.objectContaining({ clientSignals: collected }),
    );
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

  it('현재 단계에서 통과한 필수 셀 상세기입을 전체 제출 검증에도 전달한다', async () => {
    const tableQuestion = {
      id: 'q-table',
      type: 'table',
      title: '선택 표',
      required: false,
      order: 0,
      tableRowsData: [
        {
          id: 'row-1',
          label: '행',
          cells: [
            {
              id: 'required-radio',
              type: 'radio',
              content: '',
              required: true,
              radioOptions: [
                {
                  id: 'detail-option',
                  value: 'detail-value',
                  label: '기타',
                  allowTextInput: true,
                },
              ],
            },
          ],
        },
      ],
    } as Question;
    const tableStep: RenderStep = {
      kind: 'page',
      items: [
        {
          question: tableQuestion,
          rootGroupId: null,
          rootGroupName: null,
          subgroupName: null,
        },
      ],
    } as RenderStep;
    const args = baseArgs({
      currentResponseId: 'response-with-detail',
      questions: [tableQuestion],
      visibleQuestions: [tableQuestion],
      steps: [tableStep],
      currentStep: tableStep,
      responses: {
        'q-table': {
          'required-radio': 'detail-value',
        },
      },
    });
    Object.assign(args, {
      optionTextsByQuestion: {
        'q-table': { 'detail-option': '유효한 상세기입' },
      },
    });
    const { result } = renderHook(() => useResponseLifecycle(args));

    await act(async () => {
      await result.current.handleSubmit();
    });

    expect(args.setNumericErrorStepIndex).not.toHaveBeenCalled();
    expect(complete).toHaveBeenCalledWith(
      expect.objectContaining({ responseId: 'response-with-detail' }),
    );
    expect(args.setIsCompleted).toHaveBeenCalledWith(true);
  });
});

describe('이탈 시점 draft beacon', () => {
  let sendBeacon: ReturnType<typeof vi.fn>;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    saveDraft.mockReset();
    sendBeacon = vi.fn(() => true);
    fetchMock = vi.fn(() => Promise.resolve(new Response(null, { status: 200 })));
    // jsdom navigator 에는 sendBeacon 이 없어 spyOn 이 불가하다.
    // navigator 전체를 stubGlobal 로 갈아끼우면 나머지 속성이 프로토타입에 있어 사라지므로
    // 속성만 직접 정의하고 afterEach 에서 지운다.
    Object.defineProperty(navigator, 'sendBeacon', {
      configurable: true,
      writable: true,
      value: sendBeacon,
    });
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    Reflect.deleteProperty(navigator, 'sendBeacon');
    // 다른 테스트로 hidden 상태가 새지 않도록 되돌린다.
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => 'visible',
    });
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  /** hidden 이벤트를 실제 리스너에 전달한다. */
  function fireHidden() {
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => 'hidden',
    });
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
  }

  /** sendBeacon 에 넘어간 Blob 본문을 파싱한다. */
  async function beaconBody(call: number) {
    const blob = sendBeacon.mock.calls[call]?.[1] as Blob;
    return JSON.parse(await blob.text()) as Record<string, unknown>;
  }

  it('hidden 시 미저장 답변을 /api/response/draft 로 전송한다', async () => {
    const { result } = renderHook(() =>
      useResponseLifecycle(baseArgs({ currentResponseId: 'r1' })),
    );
    act(() => result.current.handleResponse('q1', 'a'));
    fireHidden();

    expect(sendBeacon).toHaveBeenCalledTimes(1);
    expect(sendBeacon.mock.calls[0]?.[0]).toBe('/api/response/draft');
    expect(await beaconBody(0)).toEqual({
      responseId: 'r1',
      answers: { q1: 'a' },
      seq: expect.any(Number),
    });
  });

  it('같은 미저장 답변으로 다시 hidden 되면 재전송하지 않는다', () => {
    const { result } = renderHook(() =>
      useResponseLifecycle(baseArgs({ currentResponseId: 'r1' })),
    );
    act(() => result.current.handleResponse('q1', 'a'));
    fireHidden();
    fireHidden();

    expect(sendBeacon).toHaveBeenCalledTimes(1);
  });

  it('답변이 바뀌면 다시 전송한다', () => {
    const { result } = renderHook(() =>
      useResponseLifecycle(baseArgs({ currentResponseId: 'r1' })),
    );
    act(() => result.current.handleResponse('q1', 'a'));
    fireHidden();
    act(() => result.current.handleResponse('q1', 'b'));
    fireHidden();

    expect(sendBeacon).toHaveBeenCalledTimes(2);
  });

  it('응답 행이 아직 없으면 전송하지 않는다', () => {
    const { result } = renderHook(() =>
      useResponseLifecycle(baseArgs({ currentResponseId: null })),
    );
    // '__' 접두 사이드카는 첫 답변 INSERT 를 유발하지 않아 응답 행이 없는 상태를 만든다.
    act(() => result.current.handleResponse('__optTexts', { q1: 'x' }));
    fireHidden();

    expect(sendBeacon).not.toHaveBeenCalled();
  });

  it('완료 화면이면 전송하지 않는다', () => {
    const { result } = renderHook(() =>
      useResponseLifecycle(baseArgs({ currentResponseId: 'r1', isCompleted: true })),
    );
    act(() => result.current.handleResponse('q1', 'a'));
    fireHidden();

    expect(sendBeacon).not.toHaveBeenCalled();
  });

  it('중단·차단 화면이면 전송하지 않는다', () => {
    const { result } = renderHook(() =>
      useResponseLifecycle(baseArgs({ currentResponseId: 'r1', terminalBlocked: true })),
    );
    act(() => result.current.handleResponse('q1', 'a'));
    fireHidden();

    expect(sendBeacon).not.toHaveBeenCalled();
  });

  it('beacon 후에도 pending 이 남아 다음 flush 가 여전히 saveDraft 를 호출한다', async () => {
    saveDraft.mockResolvedValue({ ok: true, applied: true });
    const { result } = renderHook(() =>
      useResponseLifecycle(baseArgs({ currentResponseId: 'r1' })),
    );
    act(() => result.current.handleResponse('q1', 'a'));
    fireHidden();

    await act(async () => {
      await result.current.flushPendingAnswers();
    });

    expect(saveDraft).toHaveBeenCalledWith({
      responseId: 'r1',
      answers: { q1: 'a' },
      seq: expect.any(Number),
    });
  });

  it('sendBeacon 이 false 를 반환하면 keepalive fetch 로 폴백한다', () => {
    sendBeacon.mockReturnValue(false);
    const { result } = renderHook(() =>
      useResponseLifecycle(baseArgs({ currentResponseId: 'r1' })),
    );
    act(() => result.current.handleResponse('q1', 'a'));
    fireHidden();

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/response/draft',
      expect.objectContaining({ method: 'POST', keepalive: true }),
    );
  });

  it('fetch 폴백이 실패하면 지문이 되돌아가 다음 hidden 에서 재전송된다', async () => {
    sendBeacon.mockReturnValue(false);
    fetchMock.mockRejectedValue(new Error('network down'));
    const { result } = renderHook(() =>
      useResponseLifecycle(baseArgs({ currentResponseId: 'r1' })),
    );
    act(() => result.current.handleResponse('q1', 'a'));
    fireHidden();

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    // delivered promise 가 정착(reject → catch(false))해 지문이 되돌아갈 때까지
    // fireHidden 을 재시도하며 기다린다 — 되돌아간 뒤에는 재전송되어 호출이 2회가 된다.
    await waitFor(() => {
      fireHidden();
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });
  });

  it('fetch 폴백이 성공하면 지문이 유지돼 재전송되지 않는다', async () => {
    sendBeacon.mockReturnValue(false);
    fetchMock.mockResolvedValue(new Response(null, { status: 200 }));
    const { result } = renderHook(() =>
      useResponseLifecycle(baseArgs({ currentResponseId: 'r1' })),
    );
    act(() => result.current.handleResponse('q1', 'a'));
    fireHidden();

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    // delivered promise 정착까지 대기 (성공 시 지문을 건드리지 않는다는 것을 확인하는 목적).
    await act(async () => {});

    fireHidden();

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('sendBeacon 이 수락하면 fetch 를 쓰지 않고 지문이 유지된다', () => {
    const { result } = renderHook(() =>
      useResponseLifecycle(baseArgs({ currentResponseId: 'r1' })),
    );
    act(() => result.current.handleResponse('q1', 'a'));
    fireHidden();
    fireHidden();

    expect(sendBeacon).toHaveBeenCalledTimes(1);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('64KiB 를 넘는 payload 는 sendBeacon 을 건너뛰고 keepalive 없이 fetch 로 보낸다', () => {
    const oversized = 'x'.repeat(70_000);
    const { result } = renderHook(() =>
      useResponseLifecycle(baseArgs({ currentResponseId: 'r1' })),
    );
    act(() => result.current.handleResponse('q1', oversized));
    fireHidden();

    expect(sendBeacon).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(options.method).toBe('POST');
    expect(options.keepalive).not.toBe(true);
  });

  it('flush 왕복 중 값이 바뀐 잔여 pending 은 이후 이탈 시점에 다시 전송된다', async () => {
    let resolveSaveDraft!: (value: { ok: boolean; applied: boolean }) => void;
    saveDraft.mockReturnValue(
      new Promise((resolve) => {
        resolveSaveDraft = resolve;
      }),
    );
    const { result } = renderHook(() =>
      useResponseLifecycle(baseArgs({ currentResponseId: 'r1' })),
    );

    act(() => result.current.handleResponse('q1', 'a'));

    let flushPromise!: Promise<boolean>;
    act(() => {
      flushPromise = result.current.flushPendingAnswers();
    });
    // flush 는 직렬화 체인을 거쳐 microtask 뒤에 스냅샷을 뜬다 — 여기서 체인을 소진시켜
    // saveDraft 가 {q1:'a'} 스냅샷으로 발사된(in-flight) 상태를 만든다.
    await act(async () => {});

    // saveDraft 왕복 중 값이 바뀐다 — flush 요청은 이미 {q1:'a'} 스냅샷으로 나간 뒤다.
    act(() => result.current.handleResponse('q1', 'b'));

    act(() => {
      resolveSaveDraft({ ok: true, applied: true });
    });
    await act(async () => {
      await flushPromise;
    });

    fireHidden();

    expect(sendBeacon).toHaveBeenCalledTimes(1);
    expect(await beaconBody(0)).toEqual({
      responseId: 'r1',
      answers: { q1: 'b' },
      seq: expect.any(Number),
    });
  });

  it('소유권 없는 대상자 테스트 세션이면 beacon 을 발사하지 않는다', async () => {
    // 소유권 없는 상태에서도 handleResponse 는 INSERT 를 발사할 수 있다 — 노이즈 방지용 mock.
    createWithFirstAnswer.mockResolvedValue({ id: 'resp-owned', contactTargetId: null });
    const args = baseArgs({
      currentResponseId: 'r1',
      testIdentity: { attemptId: 'a1', sessionId: 's1' },
      hasTestAttemptOwnership: false,
    });
    const { result } = renderHook(() => useResponseLifecycle(args));

    act(() => result.current.handleResponse('q1', 'a'));
    await waitFor(() => expect(args.setCurrentResponseId).toHaveBeenCalledWith('resp-owned'));
    fireHidden();

    expect(sendBeacon).not.toHaveBeenCalled();
  });

  it('소유권을 얻은 대상자 테스트 세션이면 beacon 을 발사하고 identity 를 병합한다', async () => {
    const { result } = renderHook(() =>
      useResponseLifecycle(
        baseArgs({
          currentResponseId: 'r1',
          testIdentity: { attemptId: 'a1', sessionId: 's1' },
          hasTestAttemptOwnership: true,
        }),
      ),
    );

    act(() => result.current.handleResponse('q1', 'a'));
    fireHidden();

    expect(sendBeacon).toHaveBeenCalledTimes(1);
    expect(await beaconBody(0)).toEqual({
      responseId: 'r1',
      answers: { q1: 'a' },
      seq: expect.any(Number),
      attemptId: 'a1',
      sessionId: 's1',
    });
  });

  it('flush 요청이 단조 증가 seq 를 실어 보낸다', async () => {
    saveDraft.mockResolvedValue({ ok: true, applied: true });
    const args = baseArgs({ currentResponseId: 'existing' });
    const { result } = renderHook(() => useResponseLifecycle(args));

    act(() => result.current.handleResponse('q1', 'v1'));
    await act(async () => {
      await result.current.flushPendingAnswers();
    });

    expect(saveDraft).toHaveBeenCalledTimes(1);
    const call = saveDraft.mock.calls[0]?.[0] as { seq: number };
    expect(typeof call.seq).toBe('number');
    expect(call.seq).toBeGreaterThan(0);
  });

  it('beacon 이 이전 flush 보다 큰 seq 를 실어 보낸다 — 같은 카운터를 공유한다', async () => {
    saveDraft.mockResolvedValue({ ok: true, applied: true });
    const { result } = renderHook(() =>
      useResponseLifecycle(baseArgs({ currentResponseId: 'r1' })),
    );

    act(() => result.current.handleResponse('q1', 'a'));
    await act(async () => {
      await result.current.flushPendingAnswers();
    });
    const flushSeq = (saveDraft.mock.calls[0]?.[0] as { seq: number }).seq;

    act(() => result.current.handleResponse('q1', 'b'));
    fireHidden();

    const beaconSeq = (await beaconBody(0))['seq'] as number;
    expect(beaconSeq).toBeGreaterThan(flushSeq);
  });
});

describe('draft seq — 이어하기 seed 및 applied 가드', () => {
  beforeEach(() => {
    saveDraft.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('resume 이 내려준 draftSeq 로 카운터를 seed 해 첫 flush 의 seq 가 그보다 크다', async () => {
    saveDraft.mockResolvedValue({ ok: true, applied: true });
    const args = baseArgs({ currentResponseId: 'r1', recoveredDraftSeq: 5 });
    const { result } = renderHook(() => useResponseLifecycle(args));

    act(() => result.current.handleResponse('q1', 'a'));
    await act(async () => {
      await result.current.flushPendingAnswers();
    });

    const seq = (saveDraft.mock.calls[0]?.[0] as { seq: number }).seq;
    expect(seq).toBeGreaterThan(5);
  });

  it('이미 seed 된 더 큰 값을 이후 도착한 낮은 값이 덮어쓰지 않는다(내려가지 않는다)', async () => {
    saveDraft.mockResolvedValue({ ok: true, applied: true });
    // 먼저 높은 값(100)으로 seed 된 뒤, 레이스로 더 낮은 값(0)이 뒤늦게 도착하는 상황을 흉내낸다.
    const args = baseArgs({ currentResponseId: 'r1', recoveredDraftSeq: 100 });
    const { result, rerender } = renderHook(
      (props: Parameters<typeof useResponseLifecycle>[0]) => useResponseLifecycle(props),
      { initialProps: args },
    );

    act(() => {
      rerender({ ...args, recoveredDraftSeq: 0 });
    });

    act(() => result.current.handleResponse('q1', 'a'));
    await act(async () => {
      await result.current.flushPendingAnswers();
    });

    const seq = (saveDraft.mock.calls[0]?.[0] as { seq: number }).seq;
    // 내려갔다면(단순 덮어쓰기) seq 는 1(=0+1)이 된다 — Math.max 로 올리기만 해야 100 보다 커진다.
    expect(seq).toBeGreaterThan(100);
  });

  it('applied:false 면 pending 이 유지되고 flushPendingAnswers 가 false 를 반환하며, 재시도는 더 큰 seq 로 같은 내용을 다시 싣는다', async () => {
    saveDraft.mockResolvedValueOnce({ ok: true, applied: false });
    const args = baseArgs({ currentResponseId: 'r1' });
    const { result } = renderHook(() => useResponseLifecycle(args));

    act(() => result.current.handleResponse('q1', 'a'));
    let flushResult1: boolean | undefined;
    await act(async () => {
      flushResult1 = await result.current.flushPendingAnswers();
    });
    expect(flushResult1).toBe(false);
    expect(saveDraft).toHaveBeenCalledTimes(1);
    const firstCall = saveDraft.mock.calls[0]?.[0] as { seq: number };

    // pending 이 유지됐다면 두 번째 flush 도 여전히 saveDraft 를 호출한다(비워졌다면
    // pendingAnswerSavesRef.current.size === 0 이라 saveDraft 호출 없이 즉시 true 를 반환할 것).
    saveDraft.mockResolvedValueOnce({ ok: true, applied: true });
    let flushResult2: boolean | undefined;
    await act(async () => {
      flushResult2 = await result.current.flushPendingAnswers();
    });
    expect(flushResult2).toBe(true);
    expect(saveDraft).toHaveBeenCalledTimes(2);
    const secondCall = saveDraft.mock.calls[1]?.[0] as { seq: number; answers: unknown };
    expect(secondCall.answers).toEqual({ q1: 'a' });
    expect(secondCall.seq).toBeGreaterThan(firstCall.seq);
  });

  it('applied:true 면 pending 이 정상적으로 비워진다(회귀 방지)', async () => {
    saveDraft.mockResolvedValue({ ok: true, applied: true });
    const args = baseArgs({ currentResponseId: 'r1' });
    const { result } = renderHook(() => useResponseLifecycle(args));

    act(() => result.current.handleResponse('q1', 'a'));
    await act(async () => {
      await result.current.flushPendingAnswers();
    });
    expect(saveDraft).toHaveBeenCalledTimes(1);

    // pending 이 비워졌다면 두 번째 flush 는 saveDraft 를 다시 호출하지 않고 즉시 true.
    let flushResult: boolean | undefined;
    await act(async () => {
      flushResult = await result.current.flushPendingAnswers();
    });
    expect(flushResult).toBe(true);
    expect(saveDraft).toHaveBeenCalledTimes(1);
  });

  it('컨택 재사용으로 생성된 응답의 draftSeq 로 카운터가 seed 된다', async () => {
    // 컨택 재사용 경로(localStorage 없는 다른 기기·시크릿창 재진입) — 서버가 기존 행의
    // draftSeq=9 를 창조 응답에 실어 보낸다.
    createWithFirstAnswer.mockResolvedValue({ id: 'resp-1', contactTargetId: 'c1', draftSeq: 9 });
    saveDraft.mockResolvedValue({ ok: true, applied: true });
    const args = baseArgs();
    const { result } = renderHook(() => useResponseLifecycle(args));

    act(() => result.current.handleResponse('q1', 'v1'));
    await waitFor(() => expect(args.setCurrentResponseId).toHaveBeenCalledWith('resp-1'));

    await act(async () => {
      await result.current.flushPendingAnswers();
    });

    expect(saveDraft).toHaveBeenCalledTimes(1);
    const seq = (saveDraft.mock.calls[0]?.[0] as { seq: number }).seq;
    expect(seq).toBeGreaterThan(9);
  });

  it('생성 응답의 draftSeq 가 이미 seed 된 더 큰 값보다 작아도 내려가지 않는다', async () => {
    // resume 이 이미 50 까지 seed 해둔 상태에서, 컨택 재사용 창조 응답이 더 낮은 draftSeq(5)
    // 를 돌려주는 레이스를 흉내낸다 — Math.max 로 올리기만 해야 한다.
    createWithFirstAnswer.mockResolvedValue({ id: 'resp-1', contactTargetId: 'c1', draftSeq: 5 });
    saveDraft.mockResolvedValue({ ok: true, applied: true });
    const args = baseArgs({ recoveredDraftSeq: 50 });
    const { result } = renderHook(() => useResponseLifecycle(args));

    act(() => result.current.handleResponse('q1', 'v1'));
    await waitFor(() => expect(args.setCurrentResponseId).toHaveBeenCalledWith('resp-1'));

    await act(async () => {
      await result.current.flushPendingAnswers();
    });

    const seq = (saveDraft.mock.calls[0]?.[0] as { seq: number }).seq;
    expect(seq).toBeGreaterThan(50);
  });
});

// calc 셀(수식 기반 계산 셀)을 가진 질문. tests/unit/cell-formula-inject.test.ts 의
// calcTable 헬퍼와 동일 최소 구조 — 입력 셀 하나 + 그 값을 그대로 참조하는 calc 셀 하나.
function calcTableQuestion(id: string): Question {
  return {
    id,
    type: 'table',
    title: 'T',
    required: false,
    order: 1,
    tableRowsData: [
      {
        id: 'r1',
        label: 'r1',
        cells: [
          { id: `${id}-a`, content: '', type: 'input', inputType: 'number' },
          { id: `${id}-c`, content: '', type: 'calc', formula: { kind: 'cell', cellId: `${id}-a` } },
        ],
      },
    ],
  } as Question;
}

describe('draft flush — calc 셀 저장 주입', () => {
  beforeEach(() => {
    saveDraft.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // 회귀 방지 대상: withCalcValues 는 calc 셀을 가진 질문에 대해 매번 새 객체를 만들어낸다
  // (cell-formula.ts:173 out ??= {...payloadAnswers}). flushPendingAnswers 의 삭제 판정을
  // (rawSnapshot 이 아니라) 주입된 pendingSnapshot 기준으로 했다면, 이 새 객체 참조 때문에
  // Object.is 비교가 항상 실패해 calc 질문의 pending 항목이 영영 삭제되지 않는다 — 즉 매
  // flush 마다 saveDraft 가 불필요하게 재호출된다. 이 테스트는 두 번째 flush 가
  // saveDraft 를 다시 부르지 않는지(=pending 이 실제로 비워졌는지)로 그 회귀를 고정한다.
  //
  // 되돌림 확인: use-response-lifecycle.ts 의 flushPendingAnswers 에서
  //   const pendingSnapshot = injectCalc(rawSnapshot);
  //   ...
  //   for (const [questionId, savedValue] of Object.entries(rawSnapshot)) {
  // 를 각각
  //   const pendingSnapshot = injectCalc(Object.fromEntries(pendingAnswerSavesRef.current));
  //   ...
  //   for (const [questionId, savedValue] of Object.entries(pendingSnapshot)) {
  // 로 임시로 되돌려 실행한 결과, 아래 두 단언 모두 RED(두 번째 flush 도 saveDraft 를
  // 재호출 — toHaveBeenCalledTimes(1) 기대가 2 로 실패)로 확인했다. 확인 후 원복했다.
  it('calc 셀을 가진 질문도 draft flush 성공 후 pending 이 정상적으로 비워진다(회귀 방지)', async () => {
    saveDraft.mockResolvedValue({ ok: true, applied: true });
    const calcQuestion = calcTableQuestion('tq1');
    const args = baseArgs({
      currentResponseId: 'r1',
      questions: [calcQuestion],
      responses: { tq1: { 'tq1-a': '10' } },
    });
    const { result } = renderHook(() => useResponseLifecycle(args));

    act(() => result.current.handleResponse('tq1', { 'tq1-a': '10' }));
    await act(async () => {
      await result.current.flushPendingAnswers();
    });
    expect(saveDraft).toHaveBeenCalledTimes(1);

    // 서버로 나간 페이로드에 calc 값이 실제로 주입돼 있는지도 함께 확인한다.
    const firstAnswers = (saveDraft.mock.calls[0]?.[0] as { answers: Record<string, unknown> })
      .answers;
    expect((firstAnswers['tq1'] as Record<string, unknown>)['tq1-c']).toBe('10');

    // pending 이 비워졌다면 두 번째 flush 는 saveDraft 를 다시 호출하지 않고 즉시 true.
    let flushResult: boolean | undefined;
    await act(async () => {
      flushResult = await result.current.flushPendingAnswers();
    });
    expect(flushResult).toBe(true);
    expect(saveDraft).toHaveBeenCalledTimes(1);
  });
});

describe('디바운스 백그라운드 자동 저장', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    createWithFirstAnswer.mockReset();
    createBlank.mockReset();
    complete.mockReset();
    saveDraft.mockReset();
    toastError.mockReset();
    saveDraft.mockResolvedValue({ ok: true, applied: true });
    window.localStorage.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('답변 입력 후 5초가 지나면 백그라운드로 saveDraft 를 발사한다', async () => {
    const { result } = renderHook(() =>
      useResponseLifecycle(baseArgs({ currentResponseId: 'resp-1' })),
    );
    act(() => {
      result.current.handleResponse('q1', '답');
    });
    expect(saveDraft).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });

    expect(saveDraft).toHaveBeenCalledTimes(1);
    expect(saveDraft).toHaveBeenCalledWith({
      responseId: 'resp-1',
      answers: { q1: '답' },
      seq: expect.any(Number),
    });
  });

  it('연속 입력은 타이머를 리셋해 마지막 입력 후 5초에 최신 값으로 1회만 발사한다', async () => {
    const { result } = renderHook(() =>
      useResponseLifecycle(baseArgs({ currentResponseId: 'resp-1' })),
    );
    act(() => {
      result.current.handleResponse('q1', '안');
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    act(() => {
      result.current.handleResponse('q1', '안녕');
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    expect(saveDraft).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(16000);
    });
    expect(saveDraft).toHaveBeenCalledTimes(1);
    expect(
      (saveDraft.mock.calls[0]?.[0] as { answers: Record<string, unknown> }).answers,
    ).toEqual({ q1: '안녕' });
  });

  it('입력이 계속 이어져도 maxWait 15초에 한 번은 발사한다', async () => {
    const { result } = renderHook(() =>
      useResponseLifecycle(baseArgs({ currentResponseId: 'resp-1' })),
    );
    // 표 문항 연속 클릭 시나리오 — 4초 간격 입력은 트레일링 디바운스(5초)를 계속 리셋한다.
    act(() => {
      result.current.handleResponse('q1', '1');
    });
    for (const value of ['12', '123', '1234']) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(4000);
      });
      act(() => {
        result.current.handleResponse('q1', value);
      });
    }
    // 첫 입력 후 12초 — 디바운스만 있었다면 아직 무발사.
    expect(saveDraft).not.toHaveBeenCalled();

    // 첫 입력 + 15초 시점에 maxWait 이 최신 값으로 발사한다.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    expect(saveDraft).toHaveBeenCalledTimes(1);
    expect(
      (saveDraft.mock.calls[0]?.[0] as { answers: Record<string, unknown> }).answers,
    ).toEqual({ q1: '1234' });
  });

  it('백그라운드 저장 성공 후 다음 클릭 flush 는 추가 왕복 없이 통과한다', async () => {
    const { result } = renderHook(() =>
      useResponseLifecycle(baseArgs({ currentResponseId: 'resp-1' })),
    );
    act(() => {
      result.current.handleResponse('q1', '답');
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(saveDraft).toHaveBeenCalledTimes(1);

    let flushResult: boolean | undefined;
    await act(async () => {
      flushResult = await result.current.flushPendingAnswers();
    });
    expect(flushResult).toBe(true);
    expect(saveDraft).toHaveBeenCalledTimes(1);
  });

  it('백그라운드 저장 실패는 토스트 없이 pending 을 유지해 다음 flush 가 재시도한다', async () => {
    saveDraft.mockRejectedValueOnce(new Error('network down'));
    const { result } = renderHook(() =>
      useResponseLifecycle(baseArgs({ currentResponseId: 'resp-1' })),
    );
    act(() => {
      result.current.handleResponse('q1', '답');
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(saveDraft).toHaveBeenCalledTimes(1);
    expect(toastError).not.toHaveBeenCalled();

    let flushResult: boolean | undefined;
    await act(async () => {
      flushResult = await result.current.flushPendingAnswers();
    });
    expect(flushResult).toBe(true);
    expect(saveDraft).toHaveBeenCalledTimes(2);
    expect(
      (saveDraft.mock.calls[1]?.[0] as { answers: Record<string, unknown> }).answers,
    ).toEqual({ q1: '답' });
  });

  it('preview 모드는 백그라운드 발사를 하지 않는다', async () => {
    const { result } = renderHook(() =>
      useResponseLifecycle(baseArgs({ currentResponseId: 'resp-1', isPreview: true })),
    );
    act(() => {
      result.current.handleResponse('q1', '답');
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(16000);
    });
    expect(saveDraft).not.toHaveBeenCalled();
  });

  it('admin-edit 모드는 백그라운드 발사를 하지 않는다', async () => {
    const { result } = renderHook(() =>
      useResponseLifecycle(baseArgs({ currentResponseId: 'resp-1', isAdminEdit: true })),
    );
    act(() => {
      result.current.handleResponse('q1', '답');
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(16000);
    });
    expect(saveDraft).not.toHaveBeenCalled();
  });

  it('언마운트되면 예약된 백그라운드 저장을 취소한다', async () => {
    const { result, unmount } = renderHook(() =>
      useResponseLifecycle(baseArgs({ currentResponseId: 'resp-1' })),
    );
    act(() => {
      result.current.handleResponse('q1', '답');
    });
    unmount();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(16000);
    });
    expect(saveDraft).not.toHaveBeenCalled();
  });

  it('디바운스 flush 진행 중 다음 클릭 flush 는 직렬화되어 완료 후 잔여분만 보낸다', async () => {
    let resolveFirst!: (value: unknown) => void;
    saveDraft.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveFirst = resolve;
        }),
    );
    const { result } = renderHook(() =>
      useResponseLifecycle(baseArgs({ currentResponseId: 'resp-1' })),
    );
    act(() => {
      result.current.handleResponse('q1', 'a');
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(saveDraft).toHaveBeenCalledTimes(1);

    act(() => {
      result.current.handleResponse('q2', 'b');
    });
    let flushPromise!: Promise<boolean>;
    act(() => {
      flushPromise = result.current.flushPendingAnswers();
    });
    // 첫 flush 가 in-flight 인 동안 두 번째 saveDraft 는 나가지 않는다 (single-flight 직렬화).
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
    expect(saveDraft).toHaveBeenCalledTimes(1);

    let flushResult: boolean | undefined;
    await act(async () => {
      resolveFirst({ ok: true, applied: true });
      flushResult = await flushPromise;
    });
    expect(flushResult).toBe(true);
    expect(saveDraft).toHaveBeenCalledTimes(2);
    expect(
      (saveDraft.mock.calls[1]?.[0] as { answers: Record<string, unknown> }).answers,
    ).toEqual({ q2: 'b' });
  });
});
