'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useRouter } from 'next/navigation';

import { AlertCircle, ArrowLeft, ArrowRight } from 'lucide-react';

import { AlreadyRespondedView } from '@/components/survey/already-responded-view';
import { InviteRequiredScreen } from '@/components/survey-response/invite-required-screen';
import { MobileBottomNav } from '@/components/survey-response/mobile-bottom-nav';
import {
  SurveyCompletedScreen,
  SurveyEmptyScreen,
  SurveyErrorScreen,
  SurveyLoadingScreen,
} from '@/components/survey-response/survey-response-screens';
import { GroupStepView } from '@/components/survey-response/step-views/group-step-view';
import { TableStepView } from '@/components/survey-response/step-views/table-step-view';
import { ContactAttrsProvider } from '@/lib/survey/contact-attrs-context';
import { substituteTokens } from '@/lib/survey/substitute-tokens';
import { Button } from '@/components/ui/button';

import { useClientSignals } from '@/hooks/use-client-signals';
import { useKeyboardOpen } from '@/hooks/use-keyboard-open';
import { useMultiLineDetection } from '@/hooks/use-line-count-detection';
import { useMediaQuery } from '@/hooks/use-media-query';
import {
  buildRenderSteps,
  RenderStep,
  resolveStepBranch,
} from '@/lib/group-ordering';
import { isQuestionAnswered as isQuestionAnsweredPure } from '@/lib/survey/answer-validation';
import { useDuplicateGuard } from '@/components/survey-response/hooks/use-duplicate-guard';
import { useResponseLifecycle } from '@/components/survey-response/hooks/use-response-lifecycle';
import { useResponseTelemetry } from '@/components/survey-response/hooks/use-response-telemetry';
import { useSessionRecovery } from '@/components/survey-response/hooks/use-session-recovery';
import { useSurveyLoader } from '@/components/survey-response/hooks/use-survey-loader';
import { ResumeToast } from '@/components/survey-response/resume-toast';
import { generateId, isEmptyHtml } from '@/lib/utils';
import {
  collectTableQuestionOptions,
  filterOptionTextsForSubmission,
} from '@/lib/option-text-migration';

import { useSurveyResponseStore } from '@/stores/survey-response-store';
import { useShallow } from 'zustand/react/shallow';
import type { SurveyVersionSnapshot } from '@/db/schema';
import { Question, QuestionGroup } from '@/types/survey';
import {
  getBranchRuleForResponse,
  shouldDisplayQuestion,
  type BranchEvalCtx,
} from '@/utils/branch-logic';
import type { SaveAdminEditPayload } from '@/features/survey-response/domain/response-edit';

type ResponsesMap = Record<string, unknown>;

export interface SurveyResponseFlowProps {
  mode?: 'public' | 'admin-edit';
  surveyIdentifier: string; // slug | uuid | privateToken (이미 decodeURIComponent 된 값)
  inviteToken?: string | null;
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
}

// step 내에서 표시 가능한 질문만 추린 뒤 step-like 객체로 반환
function getDisplayableItemsOfStep(
  step: RenderStep,
  responses: ResponsesMap,
  allQuestions: Question[],
  allGroups: QuestionGroup[],
  evalCtx?: BranchEvalCtx,
): Question[] {
  if (step.kind === 'table') {
    return shouldDisplayQuestion(step.question, responses, allQuestions, allGroups, evalCtx)
      ? [step.question]
      : [];
  }
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

export function SurveyResponseFlow({
  surveyIdentifier,
  inviteToken: inviteTokenProp = null,
  mode = 'public',
  adminContext,
}: SurveyResponseFlowProps) {
  const router = useRouter();
  const identifier = surveyIdentifier;
  const isAdminEdit = mode === 'admin-edit';

  // ?invite=<token> — contact 매칭용. 없으면 익명 응답 흐름 그대로.
  // admin-edit 분기 (7/8) — admin-edit 모드에서는 invite 토큰 매칭/검증 자체를 건너뛴다.
  const inviteToken = isAdminEdit ? null : inviteTokenProp ?? null;
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

  // responses 는 loader prefill(admin-edit) + handleResponse/handleSubmit 가 공유하므로
  // 컴포넌트가 소유한다. loader 가 setResponses 를 인자로 받기 위해 loader 호출보다 먼저 선언.
  const [responses, setResponses] = useState<ResponsesMap>({});

  // 설문 로딩 상태 — loadedSurvey/loadError/isLoading/contactAttrs/showInviteRequired/versionId
  // 와 설문 로딩 effect 를 useSurveyLoader 로 추출 (세터가 loader effect 전용이라 훅이 소유).
  const {
    isLoading,
    loadedSurvey,
    loadError,
    contactAttrs,
    showInviteRequired,
    versionId,
  } = useSurveyLoader({
    identifier,
    isAdminEdit,
    adminContext,
    inviteToken,
    setResponses,
  });

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

  // 첫 답변 INSERT 진행 플래그(isCreatingResponse)는 useResponseLifecycle 이 소유한다.
  // 제출 시도 후 하이라이트할 질문 ID 집합
  const [highlightQuestionIds, setHighlightQuestionIds] = useState<Set<string>>(
    () => new Set(),
  );

  const keyboardOpen = useKeyboardOpen();

  // 클라이언트 신호 (deviceId, screen 등) — 마운트 시 한 번 수집
  // null 이면 아직 수집 전. 수집 완료 후 듀얼 effect (duplicate check, callsite) 재트리거
  const signals = useClientSignals();

  // 진입 시 중복 감지 가드 — duplicateStatus state 초기화 + checkOnEntry effect 를
  // useDuplicateGuard 로 추출 (초기값 admin-edit 분기·effect 가드/페이로드/cleanup·deps 동일).
  // signals 는 컴포넌트가 소유(useResponseLifecycle 도 사용)하고 양쪽 훅에 인자로 전달한다.
  // 반환 setDuplicateStatus 는 useResponseLifecycle 에도 그대로 넘겨 INSERT blocked 결과를 set 한다.
  const { duplicateStatus, setDuplicateStatus } = useDuplicateGuard({
    isAdminEdit,
    loadedSurvey,
    inviteToken,
    signals,
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

  // 테이블 step 단일 질문의 타이틀 줄 수 감지 (group step에선 사용 안 함)
  const currentTableQuestion =
    currentStep?.kind === 'table' ? currentStep.question : null;
  const currentTableTitleResolved = useMemo(
    () => substituteTokens(currentTableQuestion?.title ?? '', contactAttrs),
    [currentTableQuestion?.title, contactAttrs],
  );
  const titleHasMultipleLines = useMultiLineDetection(
    isMobile,
    currentTableTitleResolved,
  );

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
    isAdminEdit,
    currentResponseId,
    currentStep,
    isCompleted,
    visibleProgressRef,
  });

  // 운영 현황 콘솔(T6): localStorage 기반 응답 회복 + 회복 토스트 자동 dismiss.
  // 회복 effect + dismiss effect 와 isRecovering/resumeMessage state 를
  // useSessionRecovery 로 추출 (두 effect 등록 순서·deps 동일, 세터 전용이라 훅이 소유).
  // isRecovering 은 handleResponse 의 INSERT 가드(I-1)에서 참조한다.
  const { isRecovering, resumeMessage, dismissResume } = useSessionRecovery({
    isAdminEdit,
    loadedSurvey,
    currentResponseId,
    inviteToken,
    setSessionId,
    setCurrentResponseId,
  });

  const hasPreviousDisplayable = stepHistory.length > 0;

  const isQuestionRequired = (question: Question) => question.required;

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
    adminContext,
    inviteToken,
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
    currentResponseId,
    setCurrentResponseId,
    setPendingResponse,
    resetResponseState,
    isRecovering,
    isQuestionAnswered,
    visibleProgressRef,
    setHighlightQuestionIds,
    setDuplicateStatus,
    setInviteIsInvalid,
    setIsSubmitting,
    setCurrentStepIndex,
    setIsCompleted,
    buildOptTextsPayload,
  });

  const handleNext = () => {
    const nextIndex = resolveNextStepIndex();

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
    if (!hasResponses || isCompleted) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      // Chrome/Edge/Firefox 는 returnValue 를 요구
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [hasResponses, isCompleted]);

  // 차단 화면 — requireInviteToken=true 인데 invite 없거나 무효
  if (showInviteRequired) {
    return <InviteRequiredScreen />;
  }

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
    return (
      <AlreadyRespondedView
        reason={duplicateStatus.reason}
        surveyTitle={loadedSurvey?.title ?? ''}
        contactEmail={loadedSurvey?.contactEmail ?? null}
      />
    );
  }

  // 로딩 중
  if (isLoading) {
    return <SurveyLoadingScreen />;
  }

  // 에러 발생
  if (loadError || !loadedSurvey) {
    return <SurveyErrorScreen loadError={loadError} onGoHome={() => router.push('/')} />;
  }

  if (questions.length === 0 || steps.length === 0 || !currentStep) {
    return <SurveyEmptyScreen onGoHome={() => router.push('/')} />;
  }

  // 완료 화면
  if (isCompleted) {
    return (
      <SurveyCompletedScreen
        thankYouMessage={loadedSurvey.settings.thankYouMessage}
        questionCount={questions.length}
      />
    );
  }

  const isTableStep = currentStep.kind === 'table';
  const containerMaxWidth = isTableStep ? 'max-w-7xl' : 'max-w-4xl';
  const showRequiredHighlight = highlightQuestionIds.size > 0;

  return (
    <ContactAttrsProvider attrs={contactAttrs}>
      <div className="min-h-dvh bg-gray-50">
      {/* 헤더 */}
      <div className="border-b border-gray-200 bg-white">
        <div className={`${containerMaxWidth} mx-auto px-4 py-4 transition-all duration-300 md:px-6`}>
          <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
            <div>
              <h1 className="text-xl font-semibold text-gray-900 md:text-xl">{loadedSurvey.title}</h1>
              {!isEmptyHtml(loadedSurvey.description) && (
                <p className="mt-1 text-base text-gray-600 md:text-sm">{loadedSurvey.description}</p>
              )}
            </div>
            <div className="hidden self-start text-sm text-gray-500 md:block md:self-auto">
              {currentVisibleStepNumber || 1} / {Math.max(totalVisibleStepCount, 1)}
              <span className="ml-2 text-xs text-gray-400">(전체 {questions.length}개 질문)</span>
            </div>
          </div>

          {/* 연속형 프로그레스바 */}
          <div className="mt-3">
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
      </div>

      {/* 메인 콘텐츠 */}
      <div
        className={`${containerMaxWidth} mx-auto px-4 pt-6 transition-all duration-300 md:px-6 md:pt-8 ${
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
        {currentStep.kind === 'table' ? (
          <TableStepView
            step={currentStep}
            isMobile={isMobile}
            titleHasMultipleLines={titleHasMultipleLines}
            currentStepNumber={currentVisibleStepNumber}
            responses={responses}
            questions={questions}
            onResponse={handleResponse}
            highlightQuestionIds={highlightQuestionIds}
          />
        ) : (
          <GroupStepView
            step={currentStep}
            responses={responses}
            questions={questions}
            groups={groups}
            evalCtx={evalCtx}
            onResponse={handleResponse}
            highlightQuestionIds={highlightQuestionIds}
          />
        )}

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
              {isSubmitting ? '제출 중...' : '제출'}
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
          onPrevious={handlePrevious}
          onNext={handleNext}
        />
      )}
      </div>
    </ContactAttrsProvider>
  );
}
