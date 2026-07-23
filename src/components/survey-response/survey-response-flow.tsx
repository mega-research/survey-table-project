'use client';

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';

import { useRouter } from 'next/navigation';

import { AlertCircle, ArrowLeft, ArrowRight } from 'lucide-react';

import { AlreadyRespondedView } from '@/components/survey/already-responded-view';
import { InviteRequiredScreen } from '@/components/survey-response/invite-required-screen';
import { MobileBottomNav } from '@/components/survey-response/mobile-bottom-nav';
import { SurveyResponseHeader } from '@/components/survey-response/survey-response-header';
import {
  SurveyCompletedScreen,
  SurveyEmptyScreen,
  SurveyErrorScreen,
  InvalidTestLinkScreen,
  SurveyLoadingScreen,
} from '@/components/survey-response/survey-response-screens';
import { PageStepView } from '@/components/survey-response/step-views/page-step-view';
import { ContactAttrsProvider } from '@/lib/survey/contact-attrs-context';
import { collectNumericIssues, type NumericIssue } from '@/lib/survey/numeric-validation';
import { Button } from '@/components/ui/button';

import { useClientSignals } from '@/hooks/use-client-signals';
import { HoneypotField } from '@/components/survey-response/honeypot-field';
import { useKeyboardOpen } from '@/hooks/use-keyboard-open';
import { useMediaQuery } from '@/hooks/use-media-query';
import {
  buildRenderSteps,
  resolveStepBranch,
  type RenderStep,
} from '@/lib/group-ordering';
import { isQuestionAnswered as isQuestionAnsweredPure } from '@/lib/survey/answer-validation';
import { useDuplicateGuard } from '@/components/survey-response/hooks/use-duplicate-guard';
import { useResponseLifecycle } from '@/components/survey-response/hooks/use-response-lifecycle';
import { useResponseTelemetry } from '@/components/survey-response/hooks/use-response-telemetry';
import { useSessionRecovery } from '@/components/survey-response/hooks/use-session-recovery';
import { sessionStorageKey } from '@/components/survey-response/hooks/session-helpers';
import { useSurveyLoader } from '@/components/survey-response/hooks/use-survey-loader';
import { ResumeToast } from '@/components/survey-response/resume-toast';
import { generateId } from '@/lib/utils';
import {
  collectTableQuestionOptions,
  filterOptionTextsForSubmission,
} from '@/lib/option-text-migration';
import { allQuotaQuestionsAnswered } from '@/lib/quota/gate';
import { client } from '@/shared/lib/rpc';
import { DEFAULT_PAUSED_MESSAGE } from '@/shared/lib/survey-control';

import { useSurveyResponseStore } from '@/stores/survey-response-store';
import { useShallow } from 'zustand/react/shallow';
import type { SurveyVersionSnapshot } from '@/db/schema';
import type { Question, QuestionGroup, Survey } from '@/types/survey';
import {
  getBranchRuleForResponse,
  shouldDisplayQuestion,
  type BranchEvalCtx,
} from '@/utils/branch-logic';
import type { SaveAdminEditPayload } from '@/features/survey-response/domain/response-edit';

type ResponsesMap = Record<string, unknown>;

const EMPTY_ISSUES = new Map<string, NumericIssue[]>();

export interface SurveyResponseFlowProps {
  mode?: 'public' | 'admin-edit' | 'preview';
  surveyIdentifier: string; // slug | uuid | privateToken (이미 decodeURIComponent 된 값)
  inviteToken?: string | null;
  // ?test=<token> — 운영 콘솔 발급 테스트 링크. public 모드에서만 의미가 있다(미전달 시 null).
  testToken?: string | null;
  // admin-edit 모드 전용 — Task 15 에서 활성화.
  adminContext?: {
    responseId: string;
    surveyId: string; // UUID
    initialResponses: ResponsesMap;
    // 응답이 작성된 시점의 설문 스냅샷. 응답이 published 이전이면 null.
    versionSnapshot: SurveyVersionSnapshot | null;
    // 응답자가 사용한 contact_targets.attrs — 조건/토큰 복원용.
    initialContactAttrs: Record<string, string>;
    onSubmit: (payload: SaveAdminEditPayload) => Promise<void>;
  };
  previewContext?: {
    survey: Survey;
    versionId: string | null;
  };
}

// step 내에서 표시 가능한 질문만 추린다.
function getDisplayableItemsOfStep(
  step: RenderStep,
  responses: ResponsesMap,
  allQuestions: Question[],
  allGroups: QuestionGroup[],
  evalCtx?: BranchEvalCtx,
): Question[] {
  return step.items
    .filter((i) => shouldDisplayQuestion(i.question, responses, allQuestions, allGroups, evalCtx))
    .map((i) => i.question);
}

/**
 * responses (Record<string, unknown>) → LookupEvalCtx 가 기대하는
 * Record<string, Record<string, string | undefined>> 형태로 변환.
 *
 * - table 질문은 응답이 object (cell-id → value) 형태 → 그대로 평탄화 가능.
 * - 비-table 응답은 LUT 비교 좌변이 CellRef 일 때만 의미가 있으므로 건너뜀.
 * - LUT 의 좌변/우변은 항상 table input 셀을 가리키므로 이 변환으로 충분.
 */
function responsesToLookupShape(
  responses: ResponsesMap,
): Record<string, Record<string, string | undefined>> {
  const out: Record<string, Record<string, string | undefined>> = {};
  for (const [qid, raw] of Object.entries(responses)) {
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
      const cells: Record<string, string | undefined> = {};
      for (const [cellId, cellVal] of Object.entries(raw as Record<string, unknown>)) {
        if (typeof cellVal === 'string') cells[cellId] = cellVal;
        else if (cellVal == null) cells[cellId] = undefined;
        // checkbox 배열 / object 응답은 numeric 비교 대상 아님 → skip
      }
      out[qid] = cells;
    }
  }
  return out;
}

/**
 * visibleQuestions 에서 미선택 옵션 텍스트를 drop 한 뒤 responses 와 병합한다.
 *
 * store.optionTexts(key=option.id)와 responses value(=option.value)가 다르므로
 * question.options 배열을 통해 value→id 변환 후 필터링.
 * 기존 분석 파이프라인(value가 string/array라는 가정)을 보존하기 위해
 * optionTexts는 "__optTexts__" 사이드카 key에 저장한다.
 *
 * admin-edit 경로와 public 제출 경로 양쪽에서 공유한다.
 */
function buildOptTextsPayload(
  visibleQuestions: Question[],
  responses: ResponsesMap,
): Record<string, unknown> {
  const storeOptTexts = useSurveyResponseStore.getState().optionTexts;
  const filteredOptTexts: Record<string, Record<string, string>> = {};
  for (const q of visibleQuestions) {
    const qOptTexts = storeOptTexts[q.id];
    if (!qOptTexts || Object.keys(qOptTexts).length === 0) continue;
    const qValue = responses[q.id];
    const optionsForFilter = q.type === 'table'
      ? collectTableQuestionOptions(q)
      : q.options;
    const filtered = filterOptionTextsForSubmission(qValue, qOptTexts, optionsForFilter);
    if (filtered) {
      filteredOptTexts[q.id] = filtered;
    }
  }
  return {
    ...responses,
    ...(Object.keys(filteredOptTexts).length > 0
      ? { __optTexts__: filteredOptTexts }
      : {}),
  };
}

interface SurveyResponseFlowActiveProps {
  flowProps: SurveyResponseFlowProps;
  loader: Omit<ReturnType<typeof useSurveyLoader>, 'loadedSurvey'> & { loadedSurvey: Survey };
  responses: ResponsesMap;
  setResponses: Dispatch<SetStateAction<ResponsesMap>>;
}

/**
 * URL 응답 identity 경계.
 *
 * 같은 React 인스턴스에서 invite/test token이 바뀌어도 key로 전체 응답 세션을 교체한다.
 * 자식 훅이 mount되기 전에 Zustand 응답 상태를 동기 정리하므로 이전 대상자의
 * currentResponseId를 새 대상자의 create/complete 경로가 관찰할 수 없다.
 */
export function SurveyResponseFlow(props: SurveyResponseFlowProps) {
  const identityKey = [
    props.mode ?? 'public',
    props.surveyIdentifier,
    props.inviteToken ?? '',
    props.testToken ?? '',
  ].join('\u0000');

  return <SurveyResponseIdentityBoundary key={identityKey} flowProps={props} />;
}

function SurveyResponseIdentityBoundary({ flowProps }: { flowProps: SurveyResponseFlowProps }) {
  const [ready, setReady] = useState(false);

  useLayoutEffect(() => {
    useSurveyResponseStore.getState().resetResponseState();
    // identity 전환 commit에서 store 정리가 끝난 뒤에만 실제 응답 훅 트리를 mount한다.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setReady(true);
    return () => {
      useSurveyResponseStore.getState().resetResponseState();
    };
  }, []);

  return ready ? <SurveyResponseFlowControl {...flowProps} /> : <SurveyLoadingScreen />;
}

function SurveyResponseFlowControl({
  surveyIdentifier,
  inviteToken: inviteTokenProp = null,
  testToken: testTokenProp = null,
  mode = 'public',
  adminContext,
  previewContext,
}: SurveyResponseFlowProps) {
  const router = useRouter();
  const identifier = surveyIdentifier;
  const isAdminEdit = mode === 'admin-edit';
  const isPreview = mode === 'preview';

  // ?invite=<token> — contact 매칭용. 없으면 익명 응답 흐름 그대로.
  // admin-edit 분기 (7/8) — admin-edit 모드에서는 invite 토큰 매칭/검증 자체를 건너뛴다.
  const inviteToken = isAdminEdit || isPreview ? null : inviteTokenProp ?? null;
  // ?test=<token> — invite 와 동일하게 admin-edit/preview 에서는 무시(중단/무효 링크 게이트 비대상).
  const testToken = isAdminEdit || isPreview ? null : testTokenProp ?? null;
  const [responses, setResponses] = useState<ResponsesMap>({});
  const clearResponses = useCallback(() => setResponses({}), []);
  const loader = useSurveyLoader({
    identifier,
    isAdminEdit,
    isPreview,
    adminContext,
    previewContext,
    inviteToken,
    testToken,
    setResponses,
  });

  if (loader.isLoading) return <SurveyLoadingScreen />;
  if (loader.showInviteRequired) return <InviteRequiredScreen />;
  if (loader.control?.testSession === 'invalid') {
    return (
      <InvalidTestLinkGate
        surveyId={loader.loadedSurvey?.id}
        inviteToken={inviteToken}
        clearResponses={clearResponses}
      />
    );
  }

  const isTestSession = loader.control?.testSession === 'valid';
  if (loader.control?.isPaused && !isTestSession) {
    return (
      <AlreadyRespondedView
        reason="survey_paused"
        surveyTitle={loader.loadedSurvey?.title ?? ''}
        contactEmail={loader.loadedSurvey?.contactEmail ?? null}
        customBody={loader.control.pausedMessage ?? DEFAULT_PAUSED_MESSAGE}
      />
    );
  }
  if (loader.loadError || !loader.loadedSurvey) {
    return <SurveyErrorScreen loadError={loader.loadError} onGoHome={() => router.push('/')} />;
  }

  return (
    <SurveyResponseFlowActive
      flowProps={{
        surveyIdentifier,
        inviteToken: inviteTokenProp,
        testToken: testTokenProp,
        mode,
        ...(adminContext ? { adminContext } : {}),
        ...(previewContext ? { previewContext } : {}),
      }}
      loader={{ ...loader, loadedSurvey: loader.loadedSurvey }}
      responses={responses}
      setResponses={setResponses}
    />
  );
}

function InvalidTestLinkGate({
  surveyId,
  inviteToken,
  clearResponses,
}: {
  surveyId: string | undefined;
  inviteToken: string | null;
  clearResponses: () => void;
}) {
  useLayoutEffect(() => {
    if (surveyId) window.localStorage.removeItem(sessionStorageKey(surveyId, inviteToken));
    useSurveyResponseStore.getState().resetResponseState();
    clearResponses();
  }, [surveyId, inviteToken, clearResponses]);

  return <InvalidTestLinkScreen />;
}

function SurveyResponseFlowActive({
  flowProps: {
    inviteToken: inviteTokenProp = null,
    testToken: testTokenProp = null,
    mode = 'public',
    adminContext,
  },
  loader: {
    loadedSurvey,
    contactAttrs,
    versionId,
    control,
  },
  responses,
  setResponses,
}: SurveyResponseFlowActiveProps) {
  const router = useRouter();
  const isAdminEdit = mode === 'admin-edit';
  const isPreview = mode === 'preview';
  const inviteToken = isAdminEdit || isPreview ? null : inviteTokenProp ?? null;
  const testToken = isAdminEdit || isPreview ? null : testTokenProp ?? null;
  const [inviteIsInvalid, setInviteIsInvalid] = useState(false);

  // 응답 스토어 — 액션만 셀렉트 (전체 구독 → 불필요 리렌더 방지)
  const { setCurrentResponseId, setPendingResponse, resetResponseState } =
    useSurveyResponseStore(
      useShallow((s) => ({
        setCurrentResponseId: s.setCurrentResponseId,
        setPendingResponse: s.setPendingResponse,
        resetResponseState: s.resetResponseState,
      })),
    );
  const currentResponseId = useSurveyResponseStore((s) => s.currentResponseId);

  // 유효 테스트 세션 — 중단 게이트 우회 + 중복검사 skip + create/resume 에 testToken 전달.
  const isTestSession = control?.testSession === 'valid';
  const isTargetTestSession = isTestSession && control?.testSessionKind === 'target';

  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isCompleted, setIsCompleted] = useState(false);
  const [stepHistory, setStepHistory] = useState<number[]>([]);

  // 페이지 진입 시 1회 생성된 세션 식별자. 컴포넌트 수명 동안 안정적.
  // - createResponseWithFirstAnswer의 멱등성 키 (surveyId, sessionId)
  // - 새 응답 행은 첫 답변 시점에만 INSERT (페이지 진입 시 X)
  // crypto.randomUUID 기반(generateId) — 예측 가능한 session-<Date.now()> 는
  // resume→updateQuestionResponse 의 in_progress 응답 변조 윈도를 열어준다.
  const [sessionId, setSessionId] = useState<string>(() => generateId());
  // 대상자 테스트 쓰기 소유권은 화면 마운트마다 새 attempt로 시작한다.
  // 리렌더 동안은 안정적이고, 새 탭/새로고침은 새 attempt가 이전 화면을 supersede할 수 있다.
  const [testAttemptId] = useState(() => crypto.randomUUID());
  const [hasTestAttemptOwnership, setHasTestAttemptOwnership] = useState(false);
  const testIdentity = useMemo(
    () => (isTargetTestSession ? { attemptId: testAttemptId, sessionId } : null),
    [isTargetTestSession, testAttemptId, sessionId],
  );

  // 첫 답변 INSERT 진행 플래그(isCreatingResponse)는 useResponseLifecycle 이 소유한다.
  // 제출 시도 후 하이라이트할 질문 ID 집합
  const [highlightQuestionIds, setHighlightQuestionIds] = useState<Set<string>>(
    () => new Set(),
  );

  // 쿼터 게이트 — 이 문항들은 런타임 필수로 취급하고, 전부 답변되면 checkQuota 1회 호출.
  const quotaGateIds = useMemo(
    () => new Set(loadedSurvey?.quotaGate?.questionIds ?? []),
    [loadedSurvey],
  );
  const quotaCheckedRef = useRef(false);
  const [quotaClosedMessage, setQuotaClosedMessage] = useState<string | null>(null);
  // 세션 도중 중단 감지 시 재조회한 최신 중단 문구 (handlePausedMutationError 가 승격).
  // 화면 폴백 체인: 재조회 문구 → 로드 시점 control.pausedMessage → DEFAULT_PAUSED_MESSAGE.
  const [refetchedPausedMessage, setRefetchedPausedMessage] = useState<string | null>(null);

  const keyboardOpen = useKeyboardOpen();

  // 클라이언트 신호 (deviceId, screen 등) — 마운트 시 한 번 수집
  // null 이면 아직 수집 전. 수집 완료 후 듀얼 effect (duplicate check, callsite) 재트리거
  const signals = useClientSignals();
  // 봇 방어 허니팟 입력 ref — create 시점에 값을 읽어 서버로 전달.
  const honeypotRef = useRef<HTMLInputElement>(null);

  // 진입 시 중복 감지 가드 — duplicateStatus state 초기화 + checkOnEntry effect 를
  // useDuplicateGuard 로 추출 (초기값 admin-edit 분기·effect 가드/페이로드/cleanup·deps 동일).
  // signals 는 컴포넌트가 소유(useResponseLifecycle 도 사용)하고 양쪽 훅에 인자로 전달한다.
  // 반환 setDuplicateStatus 는 useResponseLifecycle 에도 그대로 넘겨 INSERT blocked 결과를 set 한다.
  const { duplicateStatus, setDuplicateStatus } = useDuplicateGuard({
    isAdminEdit,
    isPreview,
    loadedSurvey,
    inviteToken,
    signals,
    // 유효 테스트 세션은 같은 브라우저로 반복 응답이 정상 → 진입 시 중복검사 skip.
    skip: isTestSession,
  });

  // 운영 현황 콘솔(T5): 페이지 진입 시 DB INSERT를 더 이상 하지 않는다.
  // 첫 답변 시점에 createResponseWithFirstAnswer로 행을 생성한다 (handleResponse 참고).
  // currentResponseId는 행 생성 후에만 set된다.

  // 현재 설문의 질문들
  const questions = useMemo(() => loadedSurvey?.questions || [], [loadedSurvey]);
  const groups = useMemo(() => loadedSurvey?.groups || [], [loadedSurvey]);

  // 분기/표시 평가 컨텍스트 — 우변 LUT 룩업 비교가 작동하려면 lookups + contactAttrs 가 필요.
  // responses 는 cell-id 평탄화 형태로 변환 (table 응답만 의미 있음, 비-table 은 LUT 좌변이 될 수 없음).
  const evalCtx = useMemo<BranchEvalCtx>(
    () => ({
      responses: responsesToLookupShape(responses),
      contactAttrs,
      lookups: loadedSurvey?.lookups ?? [],
    }),
    [responses, contactAttrs, loadedSurvey?.lookups],
  );

  // 상위그룹 단위 + 테이블 분리 렌더 스텝
  const steps = useMemo<RenderStep[]>(
    () => buildRenderSteps(questions, groups),
    [questions, groups],
  );

  // step 내 표시 가능한 질문이 하나라도 있는 step만 유지
  const visibleSteps = useMemo<RenderStep[]>(
    () =>
      steps.filter(
        (s) => getDisplayableItemsOfStep(s, responses, questions, groups, evalCtx).length > 0,
      ),
    [steps, responses, questions, groups, evalCtx],
  );

  const currentStep: RenderStep | undefined = steps[currentStepIndex];

  // 현재 step 내 표시 가능한 질문들
  const currentStepQuestions = useMemo<Question[]>(
    () =>
      currentStep
        ? getDisplayableItemsOfStep(currentStep, responses, questions, groups, evalCtx)
        : [],
    [currentStep, responses, questions, groups, evalCtx],
  );

  // 전역으로 표시되는 모든 질문 (노출 로깅용)
  const visibleQuestions = useMemo(
    () => questions.filter((q) => shouldDisplayQuestion(q, responses, questions, groups, evalCtx)),
    [questions, responses, groups, evalCtx],
  );

  // 모바일 화면 감지 (matchMedia — resize 루프 방지)
  const isMobile = useMediaQuery('(max-width: 767px)');

  // 진행도 — step 기반
  const currentVisibleStepNumber = useMemo(() => {
    if (!currentStep) return 0;
    const idx = visibleSteps.findIndex((s) => s === currentStep);
    return idx === -1 ? 0 : idx + 1;
  }, [currentStep, visibleSteps]);

  const totalVisibleStepCount = visibleSteps.length;

  // 운영 콘솔 진척 저장용 visible 진척 최신값. 콜백/effect 에서 stale 없이 참조하기 위해
  // ref 로 미러링한다 (deps/exhaustive-deps 영향 없음). 응답 페이지 헤더 26/28 과 동일 값.
  const visibleProgressRef = useRef({ index: 0, total: 0 });
  visibleProgressRef.current = { index: currentVisibleStepNumber, total: totalVisibleStepCount };

  const findNextDisplayableStepIndex = useCallback(
    (startIndex: number): number => {
      if (steps.length === 0) return -1;
      if (startIndex < 0) return -1;

      for (let i = startIndex; i < steps.length; i += 1) {
        const s = steps[i];
        if (!s) continue;
        if (getDisplayableItemsOfStep(s, responses, questions, groups, evalCtx).length > 0) {
          return i;
        }
      }

      return -1;
    },
    // evalCtx 누락 시 contactAttrs/lookups 가 비동기로 채워져도 콜백이 재생성되지 않아
    // stale 컨텍스트로 step 표시 여부를 계산한다 (visibleSteps 등 다른 소비자와 deps 정합).
    [steps, responses, questions, groups, evalCtx],
  );

  // 현재 step이 전부 숨겨지면 다음 표시 가능 step으로 자동 이동
  useEffect(() => {
    if (!loadedSurvey) return;
    if (!currentStep) return;

    if (currentStepQuestions.length > 0) return;

    const nextDisplayable = findNextDisplayableStepIndex(currentStepIndex + 1);
    if (nextDisplayable !== -1) {
      setCurrentStepIndex(nextDisplayable);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadedSurvey, currentStepIndex, currentStepQuestions.length]);

  // 운영 현황 콘솔(T5/세그먼트): 스텝 전환 추적 + Page Visibility 세그먼트.
  // 두 effect 를 useResponseTelemetry 로 추출 (등록 순서·deps 동일, 상태 미소유).
  useResponseTelemetry({
    enabled: !isTargetTestSession || hasTestAttemptOwnership,
    isAdminEdit,
    isPreview,
    currentResponseId,
    currentStep,
    isCompleted,
    visibleProgressRef,
    testIdentity,
  });

  // 운영 현황 콘솔(T6): localStorage 기반 응답 회복 + 회복 토스트 자동 dismiss.
  // 회복 effect + dismiss effect 와 isRecovering/resumeMessage state 를
  // useSessionRecovery 로 추출 (두 effect 등록 순서·deps 동일, 세터 전용이라 훅이 소유).
  // isRecovering 은 handleResponse 의 INSERT 가드(I-1)에서 참조한다.
  const { isRecovering, resumeMessage, dismissResume } = useSessionRecovery({
    enabled: !isCompleted,
    terminalBlocked: duplicateStatus.kind === 'blocked',
    isAdminEdit,
    isPreview,
    loadedSurvey,
    currentResponseId,
    inviteToken,
    testToken,
    isTestSession,
    isTargetTestSession,
    sessionId,
    setSessionId,
    setResponses,
    setCurrentResponseId,
    setDuplicateStatus,
    setPausedMessage: setRefetchedPausedMessage,
  });

  const hasPreviousDisplayable = stepHistory.length > 0;

  const isQuestionRequired = (question: Question) =>
    question.required || quotaGateIds.has(question.id);

  // 타입별 응답 충족 판정은 순수 함수(isQuestionAnswered)로 추출.
  // 원본 useCallback 의 [responses] deps 를 유지해 참조 안정성(answeredCount/requiredRemaining/handleSubmit) 보존.
  const isQuestionAnswered = useCallback(
    (question: Question) => isQuestionAnsweredPure(question, responses[question.id]),
    [responses],
  );

  // 다음 step 결정 (step 내 분기 규칙 평가)
  const resolveNextStepIndex = useCallback((): number => {
    if (!currentStep) return -1;

    // step 내 각 질문의 분기 규칙(end/goto)을 표시 순서대로 평가.
    // 같은 step(=같은 페이지) 또는 이전 step 을 가리키는 goto 는 전진 이동이 아니므로
    // resolveStepBranch 가 무시하고 fallthrough 시킨다 (제자리 no-op 트랩 방지).
    const rules = currentStepQuestions.map((q) =>
      getBranchRuleForResponse(q, responses[q.id]),
    );
    const outcome = resolveStepBranch(steps, currentStepIndex, rules);
    if (outcome.kind === 'end') return -1;
    if (outcome.kind === 'goto') return outcome.stepIndex;

    return findNextDisplayableStepIndex(currentStepIndex + 1);
  }, [currentStep, currentStepQuestions, responses, steps, currentStepIndex, findNextDisplayableStepIndex]);

  const isLastVisibleStep = useMemo(() => {
    if (!currentStep) return false;
    return resolveNextStepIndex() === -1;
  }, [currentStep, resolveNextStepIndex]);

  // 응답 완료 카운트 (피드백) — 전체 표시 질문 기준
  const answeredCount = useMemo(
    () => visibleQuestions.filter((q) => isQuestionAnswered(q)).length,
    [visibleQuestions, isQuestionAnswered],
  );
  const requiredRemaining = useMemo(
    () => visibleQuestions.filter((q) => q.required && !isQuestionAnswered(q)).length,
    [visibleQuestions, isQuestionAnswered],
  );

  // 숫자 차단형 검증 (min/합계/필수 셀) — 라이브 계산, 표시는 "다음"을 시도한 step 에서만
  const numericIssuesByQuestion = useMemo(() => {
    const map = new Map<string, NumericIssue[]>();
    for (const q of currentStepQuestions) {
      const issues = collectNumericIssues(q, responses[q.id], {
        allResponses: responses,
        allQuestions: questions,
      });
      if (issues.length > 0) map.set(q.id, issues);
    }
    return map;
  }, [currentStepQuestions, responses, questions]);
  const [numericErrorStepIndex, setNumericErrorStepIndex] = useState<number | null>(null);
  const showNumericErrors = numericErrorStepIndex === currentStepIndex;
  const visibleNumericIssues = showNumericErrors ? numericIssuesByQuestion : EMPTY_ISSUES;

  const canProceed = () => {
    if (!currentStep) return false;
    // step 내 표시되는 필수 질문 전부가 답변되어야 함
    return currentStepQuestions.every(
      (q) => !isQuestionRequired(q) || isQuestionAnswered(q),
    );
  };

  // isCreatingResponse 는 훅 내부 전용(첫 답변 INSERT 가드)이라 컴포넌트는 구조분해하지 않는다.
  const { handleResponse, handleSubmit } = useResponseLifecycle({
    isAdminEdit,
    isPreview,
    adminContext,
    inviteToken,
    testToken,
    isTestSession,
    testIdentity,
    hasTestAttemptOwnership,
    setHasTestAttemptOwnership,
    loadedSurvey,
    currentStep,
    currentStepIndex,
    steps,
    questions,
    groups,
    visibleQuestions,
    evalCtx,
    responses,
    setResponses,
    sessionId,
    versionId,
    signals,
    honeypotRef,
    currentResponseId,
    setCurrentResponseId,
    setPendingResponse,
    resetResponseState,
    isRecovering,
    isQuestionAnswered,
    visibleProgressRef,
    setHighlightQuestionIds,
    setDuplicateStatus,
    setPausedMessage: setRefetchedPausedMessage,
    setInviteIsInvalid,
    setIsSubmitting,
    setCurrentStepIndex,
    setIsCompleted,
    buildOptTextsPayload,
    setNumericErrorStepIndex,
  });

  const handleNext = async () => {
    // 숫자 차단형 검증 — 위반이 있으면 진행하지 않고 에러 배너만 표시한다.
    // 위반 셀 이동은 배너의 "위치로 이동" 버튼이 담당(자동 스크롤은 표가 커서 어중간하게 멈침).
    if (numericIssuesByQuestion.size > 0) {
      setNumericErrorStepIndex(currentStepIndex);
      return;
    }

    const nextIndex = resolveNextStepIndex();

    // 쿼터 게이트: 인구통계 문항 전부 답변 & 미체크 & responseId 확보 시 서버 확인.
    // fail-open: 오류/미설정은 통과. 판정을 받으면(blocked 여부 무관) 재발동 방지 플래그 set.
    if (
      !quotaCheckedRef.current &&
      currentResponseId &&
      allQuotaQuestionsAnswered([...quotaGateIds], responses)
    ) {
      // 재진입/중복 발동 방지 — await 완료 전에 먼저 플래그를 세워 재클릭 시에도
      // 서버 확인은 최대 1회만 시도된다.
      quotaCheckedRef.current = true;
      try {
        const res = await client.quota.check({
          responseId: currentResponseId,
          surveyId: loadedSurvey?.id ?? '',
          answers: responses,
        });
        if (res.blocked) {
          setQuotaClosedMessage(res.closedMessage);
          setDuplicateStatus({ kind: 'blocked', reason: 'quota_closed' });
          return;
        }
      } catch (err) {
        console.error('쿼터 확인 오류:', err); // fail-open: 플래그는 이미 위에서 세팅됨
      }
    }

    setStepHistory((prev) => [...prev, currentStepIndex]);

    if (nextIndex === -1) {
      handleSubmit();
      return;
    }

    setCurrentStepIndex(nextIndex);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handlePrevious = useCallback(() => {
    if (stepHistory.length === 0) return;
    const lastIndex = stepHistory.length - 1;
    const previousStepIndex = stepHistory[lastIndex];
    if (previousStepIndex !== undefined && steps[previousStepIndex]) {
      setCurrentStepIndex(previousStepIndex);
      setStepHistory((prev) => prev.slice(0, lastIndex));
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }, [stepHistory, steps]);

  // 브라우저 뒤로가기 → 이전 step 이동
  const hasResponses = Object.keys(responses).length > 0;
  useEffect(() => {
    if (!loadedSurvey || isCompleted) return;

    window.history.pushState({ stepIndex: currentStepIndex }, '');

    const handlePopState = () => {
      if (stepHistory.length > 0) {
        handlePrevious();
      }
    };

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadedSurvey, currentStepIndex, isCompleted]);

  // 페이지 이탈 시 경고
  useEffect(() => {
    if (isPreview || !hasResponses || isCompleted) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      // Chrome/Edge/Firefox 는 returnValue 를 요구
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [isPreview, hasResponses, isCompleted]);

  // 중복 검사 진행 중
  if (duplicateStatus.kind === 'checking') {
    return (
      <div className="mx-auto flex min-h-screen items-center justify-center text-sm text-muted-foreground">
        확인 중...
      </div>
    );
  }

  // 중복 응답 차단 화면
  if (duplicateStatus.kind === 'blocked') {
    if (duplicateStatus.reason === 'invalid_test_token') {
      return <InvalidTestLinkScreen />;
    }
    return (
      <AlreadyRespondedView
        reason={duplicateStatus.reason}
        surveyTitle={loadedSurvey?.title ?? ''}
        contactEmail={loadedSurvey?.contactEmail ?? null}
        customBody={
          duplicateStatus.reason === 'quota_closed'
            ? quotaClosedMessage
            : duplicateStatus.reason === 'survey_paused'
              ? (refetchedPausedMessage ?? control?.pausedMessage ?? DEFAULT_PAUSED_MESSAGE)
              : null
        }
      />
    );
  }

  if (questions.length === 0 || steps.length === 0 || !currentStep) {
    return <SurveyEmptyScreen onGoHome={() => router.push('/')} />;
  }

  // 완료 화면
  if (isCompleted) {
    return (
      <SurveyCompletedScreen
        {...(isPreview ? { title: '설문 확인 완료' } : {})}
        thankYouMessage={
          isPreview
            ? '입력 내용은 저장되지 않았습니다.'
            : loadedSurvey.settings.thankYouMessage
        }
        showCompletedTime={!isPreview}
      />
    );
  }

  const pageHasTable = currentStep.items.some((i) => i.question.type === 'table');
  const containerMaxWidth = pageHasTable ? 'max-w-7xl' : 'max-w-4xl';
  const showRequiredHighlight = highlightQuestionIds.size > 0;
  const submitLabel = isPreview ? '확인 완료' : '제출';
  const submittingLabel = isPreview ? '확인 중...' : '제출 중...';

  return (
    <ContactAttrsProvider attrs={contactAttrs}>
      <div className="min-h-dvh bg-gray-50">
      {/* 봇 방어 허니팟 — 화면에 안 보이는 입력. 봇이 채우면 서버가 차단 */}
      <HoneypotField ref={honeypotRef} />
      {/* 헤더 — 제목/로고/통계법만 (진행바·카운트는 아래 회색 영역으로 분리) */}
      <div className="border-b border-gray-200 bg-white">
        <div className={`${containerMaxWidth} mx-auto px-4 pt-2 pb-2 transition-all duration-300 md:px-6 md:pb-0`}>
          <SurveyResponseHeader
            title={loadedSurvey.title}
            description={loadedSurvey.description}
            responseHeader={loadedSurvey.settings.responseHeader}
            showBranding={currentVisibleStepNumber <= 1}
          />
        </div>
      </div>

      {/* 진행 현황 — 헤더 밖 회색 영역(콘텐츠 컨테이너 위) */}
      <div className={`${containerMaxWidth} mx-auto px-4 pt-1 transition-all duration-300 md:px-6`}>
        <div className="hidden items-center justify-end text-sm text-gray-500 md:flex">
          {currentVisibleStepNumber || 1} / {Math.max(totalVisibleStepCount, 1)}
          <span className="ml-2 text-xs text-gray-400">(전체 {questions.length}개 질문)</span>
        </div>
        {/* 연속형 프로그레스바 */}
        <div className="mt-2">
          <div className="relative h-1.5 w-full overflow-hidden rounded-full bg-gray-200">
            <div
              className="absolute inset-y-0 left-0 rounded-full bg-blue-500 transition-all duration-500"
              style={{
                width: `${
                  (currentVisibleStepNumber / Math.max(totalVisibleStepCount, 1)) * 100
                }%`,
              }}
            />
          </div>
          {isMobile && (
            <div className="mt-1.5 flex items-center justify-between text-xs text-gray-400">
              <span>
                {answeredCount}/{visibleQuestions.length} 응답 완료
              </span>
              {requiredRemaining > 0 && (
                <span className={showRequiredHighlight ? 'font-medium text-orange-500' : ''}>
                  필수 {requiredRemaining}개 남음
                </span>
              )}
            </div>
          )}
        </div>
      </div>

      {/* 메인 콘텐츠 */}
      <div
        className={`${containerMaxWidth} mx-auto px-4 pt-2 transition-all duration-300 md:px-6 md:pt-2 ${
          isMobile ? 'pb-28' : 'pb-16 md:pb-24'
        }`}
      >
        {resumeMessage && <ResumeToast message={resumeMessage} onDismiss={dismissResume} />}
        {inviteIsInvalid && (
          <div
            role="alert"
            className="mb-4 flex items-start gap-2 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900"
          >
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <div>초대 링크가 유효하지 않아 익명 응답으로 진행됩니다.</div>
          </div>
        )}
        <PageStepView
          step={currentStep}
          responses={responses}
          questions={questions}
          groups={groups}
          evalCtx={evalCtx}
          onResponse={handleResponse}
          highlightQuestionIds={highlightQuestionIds}
          numericIssues={visibleNumericIssues}
        />

        {/* 데스크톱 네비게이션 */}
        <div className="mt-8 hidden items-center justify-between md:flex">
          <Button variant="outline" onClick={handlePrevious} disabled={!hasPreviousDisplayable}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            이전
          </Button>

          <div className="text-sm text-gray-500">
            {!canProceed() && (
              <span className="text-red-500">* 필수 질문에 답변해주세요</span>
            )}
          </div>

          {isLastVisibleStep ? (
            <Button onClick={handleNext} disabled={!canProceed() || isSubmitting}>
              {isSubmitting ? submittingLabel : submitLabel}
            </Button>
          ) : (
            <Button onClick={handleNext} disabled={!canProceed()}>
              다음
              <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
          )}
        </div>
      </div>

      {isMobile && (
        <MobileBottomNav
          keyboardOpen={keyboardOpen}
          currentStepNumber={currentVisibleStepNumber}
          totalStepCount={totalVisibleStepCount}
          canProceed={canProceed()}
          hasPrevious={hasPreviousDisplayable}
          isLastStep={isLastVisibleStep}
          isSubmitting={isSubmitting}
          submitLabel={submitLabel}
          submittingLabel={submittingLabel}
          onPrevious={handlePrevious}
          onNext={handleNext}
        />
      )}
      </div>
    </ContactAttrsProvider>
  );
}
