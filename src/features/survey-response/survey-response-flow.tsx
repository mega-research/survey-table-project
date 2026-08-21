'use client';

import {
  useCallback,
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { Dispatch, SetStateAction } from 'react';

import { useRouter } from 'next/navigation';

import { AlertCircle, ArrowLeft, ArrowRight } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';

import { Button } from '@/components/ui/button';
import {
  buildRowWiseCellInstanceIds,
  scrollToIssue,
} from '@/features/question-renderer/scroll-to-issue';
import { resolveResponseContainerWidth } from '@/features/question-renderer/utils/table-grid-utils';
import { AlreadyRespondedView } from '@/features/survey-response/already-responded-view';
import { HoneypotField } from '@/features/survey-response/honeypot-field';
import { sessionStorageKey } from '@/features/survey-response/hooks/session-helpers';
import { useClientSignals } from '@/features/survey-response/hooks/use-client-signals';
import { useDuplicateGuard } from '@/features/survey-response/hooks/use-duplicate-guard';
import { useKeyboardOpen } from '@/features/survey-response/hooks/use-keyboard-open';
import { useResponseLifecycle } from '@/features/survey-response/hooks/use-response-lifecycle';
import { useResponseTelemetry } from '@/features/survey-response/hooks/use-response-telemetry';
import { useSessionRecovery } from '@/features/survey-response/hooks/use-session-recovery';
import { useSurveyLoader } from '@/features/survey-response/hooks/use-survey-loader';
import { InviteRequiredScreen } from '@/features/survey-response/invite-required-screen';
import type { SaveAdminEditPayload } from '@/features/survey-response/lib/admin-edit';
import { MobileBottomNav } from '@/features/survey-response/mobile-bottom-nav';
import { ResumeToast } from '@/features/survey-response/resume-toast';
import { PageStepView } from '@/features/survey-response/step-views/page-step-view';
import { useSurveyResponseStore } from '@/features/survey-response/stores/survey-response-store';
import { SurveyResponseHeader } from '@/features/survey-response/survey-response-header';
import {
  InvalidTestLinkScreen,
  SurveyCompletedScreen,
  SurveyEmptyScreen,
  SurveyErrorScreen,
  SurveyLoadingScreen,
} from '@/features/survey-response/survey-response-screens';
import { useSyncLatestRef } from '@/hooks/use-latest-ref';
import { useMediaQuery } from '@/hooks/use-media-query';
import {
  type RenderStep,
  buildRenderSteps,
  resolveRestoreStepIndex,
  resolveStepBranch,
} from '@/lib/group-ordering';
import {
  collectTableQuestionOptions,
  filterOptionTextsForSubmission,
} from '@/lib/option-text-migration';
import { allQuotaQuestionsAnswered } from '@/lib/quota/gate';
import { applyStructuralSurvival } from '@/lib/survey-response/structural-survival';
import {
  buildAdminEmptyRequiredWarningMessage,
  classifyStepIssues,
  snapshotStepResponses,
} from '@/lib/survey/admin-edit-required-relax';
import { collectAnswerQuotes } from '@/lib/survey/answer-quote';
import { isQuestionAnswered as isQuestionAnsweredPure } from '@/lib/survey/answer-validation';
import { withCalcValues } from '@/lib/survey/cell-formula';
import type { FormulaEvalCtx } from '@/lib/survey/cell-formula';
import { ContactAttrsProvider } from '@/lib/survey/contact-attrs-context';
import { FormulaEvalProvider } from '@/lib/survey/formula-context';
import {
  type NumericIssue,
  collectNumericIssues,
  collectVisibleTableCells,
} from '@/lib/survey/numeric-validation';
import {
  collectRequiredOptionTextIssues,
  resolveEffectiveOptionTextsByQuestion,
} from '@/lib/survey/required-option-text-validation';
import { generateId } from '@/lib/utils';
import type { SurveyVersionSnapshot } from '@/shared/contracts/survey';
import { client } from '@/shared/lib/rpc';
import { DEFAULT_PAUSED_MESSAGE } from '@/shared/lib/survey-control';
import type { Question, QuestionGroup, Survey } from '@/types/survey';
import {
  type BranchEvalCtx,
  collectTraversedQuestionIds,
  collectTraversedStepPath,
  getBranchRuleForResponse,
  shouldDisplayQuestion,
} from '@/utils/branch-logic';

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
    const optionsForFilter = q.type === 'table' ? collectTableQuestionOptions(q) : q.options;
    const filtered = filterOptionTextsForSubmission(qValue, qOptTexts, optionsForFilter);
    if (filtered) {
      filteredOptTexts[q.id] = filtered;
    }
  }
  return {
    ...responses,
    ...(Object.keys(filteredOptTexts).length > 0 ? { __optTexts__: filteredOptTexts } : {}),
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
    // admin-edit 은 surveyIdentifier(=surveyId)가 같은 설문의 모든 응답에서 동일하므로
    // responseId 를 별도 축으로 포함한다. 이게 없으면 같은 마운트 트리에서 responseId 만
    // 바뀌는 경로(예: 응답 상세의 "다음 응답" 이동)가 optionTexts/currentStepIndex 를
    // 리셋하지 못해, 이전 응답자가 입력한 텍스트가 다음 응답자의 인용 재현에 새어 들어간다.
    // public/preview 는 adminContext 가 항상 없어 이 항목이 상수 ''로 고정되므로 기존
    // 키 계산에 영향이 없다.
    props.adminContext?.responseId ?? '',
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
  const inviteToken = isAdminEdit || isPreview ? null : (inviteTokenProp ?? null);
  // ?test=<token> — invite 와 동일하게 admin-edit/preview 에서는 무시(중단/무효 링크 게이트 비대상).
  const testToken = isAdminEdit || isPreview ? null : (testTokenProp ?? null);
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
  loader: { loadedSurvey, contactAttrs, versionId, control, refetchSnapshot },
  responses,
  setResponses,
}: SurveyResponseFlowActiveProps) {
  const router = useRouter();
  const isAdminEdit = mode === 'admin-edit';
  const isPreview = mode === 'preview';
  const inviteToken = isAdminEdit || isPreview ? null : (inviteTokenProp ?? null);
  const testToken = isAdminEdit || isPreview ? null : (testTokenProp ?? null);
  const [inviteIsInvalid, setInviteIsInvalid] = useState(false);

  // 응답 스토어 — 액션만 셀렉트 (전체 구독 → 불필요 리렌더 방지)
  const { setCurrentResponseId, setPendingResponse, resetResponseState } = useSurveyResponseStore(
    useShallow((s) => ({
      setCurrentResponseId: s.setCurrentResponseId,
      setPendingResponse: s.setPendingResponse,
      resetResponseState: s.resetResponseState,
    })),
  );
  const currentResponseId = useSurveyResponseStore((s) => s.currentResponseId);
  const optionTexts = useSurveyResponseStore((s) => s.optionTexts);
  const effectiveOptionTextsByQuestion = useMemo(
    () => resolveEffectiveOptionTextsByQuestion(responses, optionTexts),
    [responses, optionTexts],
  );

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

  // 제출 시도 후 하이라이트할 질문 ID 집합
  const [highlightQuestionIds, setHighlightQuestionIds] = useState<Set<string>>(() => new Set());

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
  // 무중단 갈아타기(티켓 04) 안내 문구 — 서버가 응답 행을 현재 버전으로 재핀한 것을 감지해
  // 최신 스냅샷 재취득이 끝난 뒤 한 줄 표시한다 (resume 토스트와 동일 패턴).
  const [rebaseMessage, setRebaseMessage] = useState<string | null>(null);

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

  // 응답 인용 — {{{이름}}} 채널로 소비되는 파생값. 저장하지 않는다.
  const answerQuotes = useMemo(
    () => collectAnswerQuotes(questions, responses, effectiveOptionTextsByQuestion),
    [questions, responses, effectiveOptionTextsByQuestion],
  );

  // calc 셀 수식 평가 컨텍스트 — responses 는 원본(cell-id 미평탄화) 형태를 그대로 넘긴다
  // (cell-formula.ts 가 questionId → cellId 중첩 객체 형태를 직접 기대함).
  const formulaCtx = useMemo<FormulaEvalCtx>(
    () => ({
      questions,
      responses,
      lookups: loadedSurvey?.lookups ?? [],
      contactAttrs,
    }),
    [questions, responses, loadedSurvey?.lookups, contactAttrs],
  );

  // calc 값이 주입된 응답 맵 — 분기/표시 조건 평가 전용 파생값.
  // calc 값은 저장 경계에서만 페이로드에 주입되고 로컬 responses 상태에는 없으므로,
  // 이것 없이 evalCtx 를 만들면 calc 셀을 참조하는 분기 조건이 항상 빈 값을 본다
  // (스펙 §4 가 보장한 "앞 페이지 calc 셀 참조"가 깨짐). 파생 주입이므로 같은 페이지
  // 참조도 라이브로 동작하지만, 보장 범위는 스펙대로 앞 페이지 참조다.
  const calcAwareResponses = useMemo(
    () => withCalcValues(responses, formulaCtx),
    [responses, formulaCtx],
  );

  // 분기/표시 평가 컨텍스트 — 우변 LUT 룩업 비교가 작동하려면 lookups + contactAttrs 가 필요.
  // responses 는 cell-id 평탄화 형태로 변환 (table 응답만 의미 있음, 비-table 은 LUT 좌변이 될 수 없음).
  // 인용값은 조건식의 attrsKey 피연산자가 채널을 구분하지 못하므로 여기서만 병합한다 (인용 우선).
  const evalCtx = useMemo<BranchEvalCtx>(
    () => ({
      responses: responsesToLookupShape(calcAwareResponses),
      contactAttrs: { ...contactAttrs, ...answerQuotes },
      lookups: loadedSurvey?.lookups ?? [],
    }),
    [calcAwareResponses, contactAttrs, answerQuotes, loadedSurvey?.lookups],
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

  // 재접속 회복 시 멈춘 스텝으로 초기 이동.
  // useSessionRecovery 가 deps 미포함 안정 참조를 요구하므로 최신 값은 ref 로 읽는다.
  // 재배포 등으로 스텝 id 가 현재 구조에 없으면 못 찾고(-1) 1페이지 유지.
  const restoreCtxRef = useRef({
    steps,
    questions,
    groups,
    contactAttrs: { ...contactAttrs, ...answerQuotes },
    lookups: loadedSurvey?.lookups ?? [],
  });
  useEffect(() => {
    restoreCtxRef.current = {
      steps,
      questions,
      groups,
      contactAttrs: { ...contactAttrs, ...answerQuotes },
      lookups: loadedSurvey?.lookups ?? [],
    };
  }, [steps, questions, groups, contactAttrs, answerQuotes, loadedSurvey?.lookups]);
  const restoreStepFromRecovery = useCallback(
    (stepId: string, restoredResponses: ResponsesMap, affectedQuestionIds?: string[]) => {
      const { steps, questions, groups, contactAttrs, lookups } = restoreCtxRef.current;
      // 응답 버전 이관(ADR-0014): 답이 폐기·제거된 질문이 있으면 그 가장 앞 페이지로 되돌린다
      const idx = resolveRestoreStepIndex(steps, stepId, affectedQuestionIds ?? []);
      if (idx <= 0) return;
      setCurrentStepIndex(idx);
      // 이전 버튼/브라우저 뒤로가기용 stepHistory 재구성 — 복원 응답 기준으로
      // 1페이지부터 실제 경로를 시뮬레이션한다 (handleNext 가 쌓는 스택과 동일 의미).
      // 경로상에 목표 스텝이 없으면(재배포로 구조 변경 등) 빈 스택 유지가 안전하다.
      setStepHistory(
        collectTraversedStepPath(steps, idx, restoredResponses, questions, groups, {
          responses: responsesToLookupShape(restoredResponses),
          contactAttrs,
          lookups,
        }),
      );
    },
    [],
  );

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
  useSyncLatestRef(visibleProgressRef, {
    index: currentVisibleStepNumber,
    total: totalVisibleStepCount,
  });

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

  // 스텝이 바뀌면 페이지 상단으로 이동한다.
  //
  // 스텝 전환 지점마다 scrollTo 를 부르지 않고 여기 한 곳으로 모은 이유:
  // (1) 전환 지점이 handleNext·handlePrevious·자동 스킵·재접속 복원·검증 점프로 5곳인데
  //     자동 스킵과 복원에는 호출이 아예 없어 페이지만 바뀌고 스크롤이 남아 있었다.
  // (2) 호출 지점에서 부르면 새 페이지가 커밋되기 전에 예약되는데, iOS WebKit 계열
  //     브라우저는 직후 DOM 이 통째로 교체되면 그 스크롤을 폐기한다. effect 는 커밋
  //     이후에 실행되므로 새 페이지 레이아웃 기준으로 확정 적용된다.
  //
  // behavior 는 'instant' 여야 한다 — globals.css 의 html { scroll-behavior: smooth }
  // 때문에 'auto' 는 즉시 이동이 아니라 스무스 애니메이션이 되고, 긴 페이지에서
  // 출발하면 다시 같은 취소 문제에 노출된다.
  const previousStepIndexRef = useRef(currentStepIndex);
  useEffect(() => {
    if (previousStepIndexRef.current === currentStepIndex) return;
    previousStepIndexRef.current = currentStepIndex;
    window.scrollTo({ top: 0, behavior: 'instant' });
  }, [currentStepIndex]);

  // 현재 step이 전부 숨겨지면 다음 표시 가능 step으로 자동 이동.
  // effect 대신 렌더 중 조정 — 커밋 후 이동하면 빈 스텝이 한 프레임 노출된다.
  // 인덱스가 단조 증가(currentStepIndex + 1 이후 탐색)하므로 재렌더 루프는 유한하다.
  if (loadedSurvey && currentStep && currentStepQuestions.length === 0) {
    const nextDisplayable = findNextDisplayableStepIndex(currentStepIndex + 1);
    if (nextDisplayable !== -1) {
      setCurrentStepIndex(nextDisplayable);
    }
  }

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
    onPausedDetected: (pausedMessage) => {
      // 세션 도중 중단 — 운영자 최신 문구를 폴백 체인 최우선 값으로 승격한다
      // (handlePausedMutationError 재조회 경로와 동일 의미론, 왕복은 없다).
      if (pausedMessage !== null) setRefetchedPausedMessage(pausedMessage);
      // 이미 다른 사유로 차단됐다면 그 사유를 유지한다.
      setDuplicateStatus((prev) =>
        prev.kind === 'blocked' ? prev : { kind: 'blocked', reason: 'survey_paused' },
      );
    },
  });

  // 이어하기 회복이 내려준 draftSeq — useResponseLifecycle 의 draftSeqRef seed 용.
  // onRestoreStep 과 동일하게 useSessionRecovery 콜백(onDraftSeqRecovered)으로 전달받아,
  // useResponseLifecycle 호출 시점(아래)에 prop 으로 넘긴다. 훅 호출 순서상 useSessionRecovery
  // 가 먼저이므로 콜백은 useResponseLifecycle 내부 값을 직접 참조하지 않고 이 state 를 경유한다.
  const [recoveredDraftSeq, setRecoveredDraftSeq] = useState<number | undefined>(undefined);

  // 운영 현황 콘솔(T6): localStorage 기반 응답 회복 + 회복 토스트 자동 dismiss.
  // 회복 effect + dismiss effect 와 isRecovering/resumeMessage state 를
  // useSessionRecovery 로 추출 (두 effect 등록 순서·deps 동일, 세터 전용이라 훅이 소유).
  // isRecovering 은 handleResponse 의 INSERT 가드(I-1)에서 참조한다.
  const { isRecovering, resumeMessage, dismissResume, reeditNotice } = useSessionRecovery({
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
    onRestoreStep: restoreStepFromRecovery,
    onDraftSeqRecovered: setRecoveredDraftSeq,
    setCurrentResponseId,
    setDuplicateStatus,
    setPausedMessage: setRefetchedPausedMessage,
  });

  const hasPreviousDisplayable = stepHistory.length > 0;

  const isQuestionRequired = useCallback(
    (question: Question) => question.required || quotaGateIds.has(question.id),
    [quotaGateIds],
  );

  // 타입별 응답 충족 판정은 순수 함수(isQuestionAnswered)로 추출.
  // 상세기입 필수 옵션은 선택값만으로 충족되지 않으며, 테이블은 실제 노출 셀만 검사한다.
  const isQuestionAnswered = useCallback(
    (question: Question) => {
      const response = responses[question.id];
      const visibleCellIds =
        question.type === 'table'
          ? new Set(
              collectVisibleTableCells(
                question,
                response && typeof response === 'object'
                  ? (response as Record<string, unknown>)
                  : {},
                { allResponses: responses, allQuestions: questions },
              ).map((cell) => cell.id),
            )
          : undefined;
      return (
        isQuestionAnsweredPure(question, response) &&
        !collectRequiredOptionTextIssues(
          question,
          response,
          effectiveOptionTextsByQuestion[question.id],
          visibleCellIds ? { visibleCellIds } : undefined,
        ).questionMissing
      );
    },
    [responses, effectiveOptionTextsByQuestion, questions],
  );

  // 다음 step 결정 (step 내 분기 규칙 평가)
  const resolveNextStepIndex = useCallback((): number => {
    if (!currentStep) return -1;

    // step 내 각 질문의 분기 규칙(end/goto)을 표시 순서대로 평가.
    // 같은 step(=같은 페이지) 또는 이전 step 을 가리키는 goto 는 전진 이동이 아니므로
    // resolveStepBranch 가 무시하고 fallthrough 시킨다 (제자리 no-op 트랩 방지).
    const rules = currentStepQuestions.map((q) => getBranchRuleForResponse(q, responses[q.id]));
    const outcome = resolveStepBranch(steps, currentStepIndex, rules);
    if (outcome.kind === 'end') return -1;
    if (outcome.kind === 'goto') return outcome.stepIndex;

    return findNextDisplayableStepIndex(currentStepIndex + 1);
  }, [
    currentStep,
    currentStepQuestions,
    responses,
    steps,
    currentStepIndex,
    findNextDisplayableStepIndex,
  ]);

  const isLastVisibleStep = useMemo(() => {
    if (!currentStep) return false;
    return resolveNextStepIndex() === -1;
  }, [currentStep, resolveNextStepIndex]);

  // 응답 완료 카운트 (피드백) — 실제 경로(분기 시뮬레이션) 기준.
  // 분기 규칙으로 건너뛰는 스텝의 질문을 세면 "필수 N개 남음"이 제출 버튼과 모순된다.
  const traversedQuestionIds = useMemo(
    () => collectTraversedQuestionIds(steps, responses, questions, groups, evalCtx),
    [steps, responses, questions, groups, evalCtx],
  );
  const answeredCount = useMemo(
    () =>
      visibleQuestions.filter((q) => traversedQuestionIds.has(q.id) && isQuestionAnswered(q))
        .length,
    [visibleQuestions, traversedQuestionIds, isQuestionAnswered],
  );
  const requiredRemaining = useMemo(
    () =>
      visibleQuestions.filter(
        (q) => traversedQuestionIds.has(q.id) && q.required && !isQuestionAnswered(q),
      ).length,
    [visibleQuestions, traversedQuestionIds, isQuestionAnswered],
  );

  // 숫자 차단형 검증 (min/합계/필수 셀) — 라이브 계산, 표시는 "다음"을 시도한 step 에서만
  const numericIssuesByQuestion = useMemo(() => {
    const map = new Map<string, NumericIssue[]>();
    for (const q of currentStepQuestions) {
      const issues = collectNumericIssues(q, responses[q.id], {
        allResponses: responses,
        allQuestions: questions,
        optionTexts: effectiveOptionTextsByQuestion[q.id],
        lookups: loadedSurvey?.lookups ?? [],
        contactAttrs,
      });
      if (issues.length > 0) map.set(q.id, issues);
    }
    return map;
  }, [
    currentStepQuestions,
    responses,
    questions,
    effectiveOptionTextsByQuestion,
    loadedSurvey?.lookups,
    contactAttrs,
  ]);
  const [numericErrorStepIndex, setNumericErrorStepIndex] = useState<number | null>(null);
  const showNumericErrors = numericErrorStepIndex === currentStepIndex;
  const focusedQuestionId = currentStepQuestions.find((q) => highlightQuestionIds.has(q.id))?.id;
  const visibleNumericIssues = useMemo(() => {
    if (!showNumericErrors) return EMPTY_ISSUES;
    if (!focusedQuestionId) return numericIssuesByQuestion;
    const focusedIssues = numericIssuesByQuestion.get(focusedQuestionId);
    return focusedIssues ? new Map([[focusedQuestionId, focusedIssues]]) : EMPTY_ISSUES;
  }, [showNumericErrors, focusedQuestionId, numericIssuesByQuestion]);

  // 하이라이트 중 "필수 미응답" 사유인 질문만 골라 안내 문구를 붙인다 — 숫자 검증
  // 위반 하이라이트에는 필수 문구를 섞지 않고, 응답이 채워지면 문구도 즉시 사라진다.
  const requiredMessageQuestionIds = new Set(
    currentStepQuestions
      .filter(
        (q) => highlightQuestionIds.has(q.id) && isQuestionRequired(q) && !isQuestionAnswered(q),
      )
      .map((q) => q.id),
  );

  const canProceed = () => {
    if (!currentStep) return false;
    // step 내 표시되는 필수 질문 전부가 답변되어야 함
    return currentStepQuestions.every((q) => !isQuestionRequired(q) || isQuestionAnswered(q));
  };

  // admin-edit 전용 — "빈 필수" 완화(경고 1회 후 통과). 응답자/미리보기/테스트 흐름은
  // isAdminEdit=false 라 아래 값들이 전혀 쓰이지 않는다(handleNext 분기에서 무시).
  //
  // 스텝의 질문 응답값 스냅샷 — 페이지(스텝) 이동 또는 값 변경 시 자연히 달라지므로
  // "경고 상태 리셋"(요구 4)은 이 스냅샷 불일치 자체로 성립한다. "스텝 이동" 케이스만
  // 별도 처리가 필요하다 — 같은 스텝으로 되돌아오면 스냅샷이 우연히 같아져 리셋 없이
  // 재클릭 한 번에 통과해버릴 수 있어서다. useEffect 대신 렌더 중 상태 조정(React 공식
  // 권장 "Adjusting state when a prop changes" 패턴)으로 처리 — setState-in-effect 경고 회피.
  const currentStepResponseSnapshot = useMemo(
    () =>
      snapshotStepResponses(
        currentStepQuestions.map((q) => q.id),
        responses,
      ),
    [currentStepQuestions, responses],
  );
  const [adminWarnedSnapshot, setAdminWarnedSnapshot] = useState<string | null>(null);
  const [adminWarnStepIndex, setAdminWarnStepIndex] = useState<number | null>(null);
  if (isAdminEdit && adminWarnStepIndex !== currentStepIndex) {
    setAdminWarnStepIndex(currentStepIndex);
    if (adminWarnedSnapshot !== null) setAdminWarnedSnapshot(null);
  }
  const adminStepClassification = useMemo(() => {
    if (!isAdminEdit) return null;
    const unansweredIds = currentStepQuestions
      .filter((q) => isQuestionRequired(q) && !isQuestionAnswered(q))
      .map((q) => q.id);
    return classifyStepIssues(unansweredIds, numericIssuesByQuestion);
  }, [
    isAdminEdit,
    numericIssuesByQuestion,
    currentStepQuestions,
    isQuestionAnswered,
    isQuestionRequired,
  ]);
  // 경고 배너 표시 조건: "방금 첫 클릭으로 경고했고, 그 이후 값/스텝이 그대로인 상태"
  // — 이 조건이 참인 동안에만 다음 클릭이 통과(bypass)로 이어진다(handleNext 참고).
  const showAdminEmptyRequiredWarning =
    isAdminEdit &&
    adminWarnedSnapshot !== null &&
    adminWarnedSnapshot === currentStepResponseSnapshot &&
    !!adminStepClassification &&
    !adminStepClassification.hasBlockingIssue &&
    adminStepClassification.emptyRequiredCount > 0;
  // 경고 배너의 "위치로 이동" 대상 — 첫 미응답 질문(전무) 우선, 없으면 첫 셀/상세 이슈.
  // handleNext 의 첫 클릭 자동 스크롤과 배너 클릭 스크롤이 같은 대상을 가리키도록 공유한다.
  const adminFirstEmptyRequiredTarget = useMemo(() => {
    if (!isAdminEdit) return null;
    const firstUnanswered = currentStepQuestions.find(
      (q) => isQuestionRequired(q) && !isQuestionAnswered(q),
    );
    // 비-테이블 상세기입 누락은 firstUnanswered(질문 단위)와 numericIssuesByQuestion(같은
    // 질문의 required-detail 이슈) 양쪽에 동시에 잡힌다 — 있으면 detailTargetIds 를 붙여
    // 질문 카드가 아니라 실제 입력란으로 정확히 스크롤한다(기존 Gate A 의 firstIssue 동일 패턴).
    if (firstUnanswered) {
      return {
        questionId: firstUnanswered.id,
        issue: numericIssuesByQuestion.get(firstUnanswered.id)?.[0],
      };
    }
    const firstViolatedQuestionId = numericIssuesByQuestion.keys().next().value;
    if (!firstViolatedQuestionId) return null;
    return {
      questionId: firstViolatedQuestionId,
      issue: numericIssuesByQuestion.get(firstViolatedQuestionId)?.[0],
    };
  }, [
    isAdminEdit,
    numericIssuesByQuestion,
    currentStepQuestions,
    isQuestionAnswered,
    isQuestionRequired,
  ]);

  // 무중단 갈아타기(티켓 04): create 결과의 versionId 가 알던 값과 다르면(서버 재핀) 호출된다.
  // 최신 스냅샷을 재취득하고(steps 는 loadedSurvey 파생이라 자동 재계산), 메모리의 응답 맵을
  // 구조 생존 판정(티켓 01)으로 걸러 신버전 구조와 비양립인 답만 버린 뒤 안내 문구를 띄운다.
  // 신버전 질문 목록은 state 커밋을 기다리지 않고 refetchSnapshot 의 반환값을 직접 쓴다.
  const handleVersionRebase = useCallback(() => {
    void (async () => {
      const refetched = await refetchSnapshot();
      if (!refetched) return; // 재취득 실패 — 기존 화면 유지 (fail-open, refetchSnapshot 이 로깅)
      setResponses(
        (prev) => applyStructuralSurvival(prev, refetched.survey.questions).survivingResponses,
      );
      setRebaseMessage('설문이 업데이트되어 최신 버전으로 이어집니다');
    })();
  }, [refetchSnapshot, setResponses]);

  // 첫 답변 INSERT 가드는 훅 내부 동기 ref 전용이라 컴포넌트가 볼 값이 없다(반환하지 않는다).
  const { handleResponse, flushPendingAnswersInBackground, waitForResponseId, handleSubmit } =
    useResponseLifecycle({
      isAdminEdit,
      isPreview,
      isCompleted,
      terminalBlocked: duplicateStatus.kind === 'blocked',
      adminContext,
      inviteToken,
      testToken,
      isTestSession,
      testIdentity,
      hasTestAttemptOwnership,
      setHasTestAttemptOwnership,
      loadedSurvey,
      contactAttrs,
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
      onVersionRebase: handleVersionRebase,
      signals,
      honeypotRef,
      currentResponseId,
      setCurrentResponseId,
      setPendingResponse,
      resetResponseState,
      isRecovering,
      recoveredDraftSeq,
      isQuestionAnswered,
      optionTextsByQuestion: effectiveOptionTextsByQuestion,
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

  // 기타/상세 기재(store.optionTexts)를 draft 파이프라인에 동기화한다.
  // 이게 없으면 사이드카는 최종 제출에만 실려, 제출 전 이탈 시 서버에 남지 않아
  // 재진입 복원(seedOptionTexts)이 되살릴 것이 없다. handleResponse('__optTexts__')는
  // 일반 답변과 같은 디바운스 draft·이탈 beacon 에 합류하고, '__' 키라 첫 답변
  // INSERT 트리거는 되지 않는다 (preview/admin-edit 은 flush 계층이 이미 걸러낸다).
  const lastSyncedOptionTextsRef = useRef(optionTexts);
  useEffect(() => {
    if (lastSyncedOptionTextsRef.current === optionTexts) return;
    lastSyncedOptionTextsRef.current = optionTexts;
    if (Object.keys(optionTexts).length === 0) return;
    handleResponse('__optTexts__', optionTexts);
  }, [optionTexts, handleResponse]);

  // iOS Safari 는 버튼을 탭해도 입력의 포커스를 빼앗지 않는다. 포커스가 남은
  // 입력이 스텝 전환으로 DOM 에서 제거되면 blur 이벤트 없이 사라져 소프트
  // 키보드가 닫히지 못하고 빈 패널로 고착된다 (레이아웃이 화면 절반에 갇히고
  // 아래가 빈 화면으로 남는 증상). 전환 전에 명시적으로 blur 해 키보드를
  // 정리한다 — 입력이 아직 DOM 에 있는 시점이어야 효과가 있다.
  const blurActiveInput = () => {
    const active = document.activeElement;
    if (active instanceof HTMLElement) active.blur();
  };

  const handleNext = async () => {
    blurActiveInput();
    const unansweredCurrent = currentStepQuestions.filter(
      (q) => isQuestionRequired(q) && !isQuestionAnswered(q),
    );

    // admin-edit 전용(요구 1~4/6) — 빈 필수만 있고(차단형 위반 없음) 있으면 경고 1회 후
    // 통과시킨다. isAdminEdit=false 인 응답자/미리보기/테스트 흐름은 이 블록이 항상
    // 스킵되어 아래 기존 Gate A/B 가 그대로(무변경) 적용된다.
    let bypassEmptyRequired = false;
    if (
      isAdminEdit &&
      adminStepClassification &&
      !adminStepClassification.hasBlockingIssue &&
      adminStepClassification.emptyRequiredCount > 0
    ) {
      if (adminWarnedSnapshot === currentStepResponseSnapshot) {
        // 같은 페이지, 값 변경 없이 연속 두 번째 클릭 — 완화하고 진행.
        bypassEmptyRequired = true;
        setAdminWarnedSnapshot(null);
      } else {
        // 첫 클릭(또는 스텝 이동·값 변경 뒤 재클릭) — 경고만 하고 막는다.
        setAdminWarnedSnapshot(currentStepResponseSnapshot);
        if (adminFirstEmptyRequiredTarget) {
          const { questionId: targetQuestionId, issue: targetIssue } =
            adminFirstEmptyRequiredTarget;
          setHighlightQuestionIds(new Set([targetQuestionId]));
          scrollToIssue({
            questionId: targetQuestionId,
            detailTargetIds: targetIssue?.detailTargetIds,
            cellInstanceIds: buildRowWiseCellInstanceIds(
              questions.find((question) => question.id === targetQuestionId)?.tableRowsData,
              targetIssue?.cellIds,
            ),
            cellIds: targetIssue?.cellIds,
          });
        }
        return;
      }
    } else if (isAdminEdit && adminWarnedSnapshot !== null) {
      // 차단형 위반이 새로 생겼거나 이슈가 모두 해소됨 — 경고 상태 정리.
      setAdminWarnedSnapshot(null);
    }

    if (!bypassEmptyRequired && unansweredCurrent.length > 0) {
      const firstUnanswered = unansweredCurrent[0];
      if (!firstUnanswered) return;
      setHighlightQuestionIds(new Set([firstUnanswered.id]));
      const firstIssue = numericIssuesByQuestion.get(firstUnanswered.id)?.[0];
      if (firstIssue) {
        setNumericErrorStepIndex(currentStepIndex);
      }
      scrollToIssue({
        questionId: firstUnanswered.id,
        detailTargetIds: firstIssue?.detailTargetIds,
        cellInstanceIds: buildRowWiseCellInstanceIds(
          firstUnanswered.tableRowsData,
          firstIssue?.cellIds,
        ),
        cellIds: firstIssue?.cellIds,
      });
      return;
    }

    // 숫자 차단형 검증 — 위반이 있으면 진행하지 않고 에러 배너만 표시한다.
    // 위반 셀 이동은 배너의 "위치로 이동" 버튼이 담당(자동 스크롤은 표가 커서 어중간하게 멈침).
    if (!bypassEmptyRequired && numericIssuesByQuestion.size > 0) {
      const firstViolatedQuestionId = numericIssuesByQuestion.keys().next().value;
      if (firstViolatedQuestionId) {
        setHighlightQuestionIds(new Set([firstViolatedQuestionId]));
        const firstIssue = numericIssuesByQuestion.get(firstViolatedQuestionId)?.[0];
        const violatedQuestion = questions.find(
          (question) => question.id === firstViolatedQuestionId,
        );
        scrollToIssue({
          questionId: firstViolatedQuestionId,
          detailTargetIds: firstIssue?.detailTargetIds,
          cellInstanceIds: buildRowWiseCellInstanceIds(
            violatedQuestion?.tableRowsData,
            firstIssue?.cellIds,
          ),
          cellIds: firstIssue?.cellIds,
        });
      }
      setNumericErrorStepIndex(currentStepIndex);
      return;
    }

    const nextIndex = resolveNextStepIndex();

    // 쿼터 게이트: 인구통계 문항 전부 답변 & 미체크 & responseId 확보 시 서버 확인.
    // fail-open: 오류/미설정은 통과. 판정을 받으면(blocked 여부 무관) 재발동 방지 플래그 set.
    // 아래 flush 와 병렬로 왕복시켜 전환 대기 시간이 직렬 2왕복이 되지 않게 한다 —
    // check 는 페이로드의 answers 로 판정하므로 flush 선행에 의존하지 않는다.
    let quotaPromise: Promise<{ blocked: boolean; closedMessage: string | null } | null> | null =
      null;
    if (!quotaCheckedRef.current && allQuotaQuestionsAnswered([...quotaGateIds], responses)) {
      // 재진입/중복 발동 방지 — await 완료 전에 먼저 플래그를 세워 재클릭 시에도
      // 서버 확인은 최대 1회만 시도된다.
      quotaCheckedRef.current = true;
      quotaPromise = (async () => {
        // 낙관 전환으로 응답 행 생성(첫 답변 시 백그라운드 시작)보다 먼저 이 클릭에
        // 도달할 수 있다 — id 가 없다고 판정을 건너뛰면 하드 쿼터가 우회되므로,
        // 응답당 최대 1회뿐인 이 판정 클릭에서만 생성 완료를 기다려 id 를 확보한다.
        const responseId = currentResponseId ?? (await waitForResponseId());
        if (!responseId) {
          // 생성이 시작조차 안 됐다(첫 답변 전) — 판정을 보류하고 플래그를 되돌려
          // 다음 클릭에서 재시도한다.
          quotaCheckedRef.current = false;
          return null;
        }
        // try 밖에서 계산 — React Compiler 는 try 블록 안의 값 블록(?. / ??)을 다루지 못한다.
        const quotaSurveyId = loadedSurvey?.id ?? '';
        try {
          return await client.quota.check({
            responseId,
            surveyId: quotaSurveyId,
            answers: responses,
          });
        } catch (err) {
          console.error('쿼터 확인 오류:', err); // fail-open: 플래그는 이미 위에서 세팅됨
          return null;
        }
      })();
    }

    // 마지막 제출은 complete가 전체 답을 저장한다. 중간 이동은 현재 페이지 변경분을
    // 백그라운드 체크포인트로 발사만 하고 전환은 기다리지 않는다(낙관 전환) —
    // 답변 직후 5초 디바운스 안에 "다음"을 누르는 지배적 패턴에서 매 스텝이
    // 저장 왕복만큼 느려지던 것을 없앤다. 실패해도 pending 이 유지되어 다음
    // flush/이탈 beacon/최종 complete 에 합류하므로 유실 경로가 없고,
    // enqueueFlush 직렬화 체인 + 서버 seq 가드가 순서/중복을 방어한다.
    if (nextIndex !== -1) void flushPendingAnswersInBackground();

    if (quotaPromise) {
      // 쿼터 판정(응답당 최대 1회)만은 기다린다 — 낙관 전환하면 마감 응답자에게
      // 다음 문항을 보여줬다가 차단 화면으로 갈아치우는 어색한 상태가 생긴다.
      const res = await quotaPromise;
      if (res?.blocked) {
        setQuotaClosedMessage(res.closedMessage);
        setDuplicateStatus({ kind: 'blocked', reason: 'quota_closed' });
        return;
      }
    }

    setStepHistory((prev) => [...prev, currentStepIndex]);

    if (nextIndex === -1) {
      handleSubmit();
      return;
    }

    setCurrentStepIndex(nextIndex);
  };

  const handlePrevious = useCallback(() => {
    if (stepHistory.length === 0) return;
    // handleNext 의 blurActiveInput 과 동일 사유 — 포커스 잔류 입력의 키보드 정리
    const active = document.activeElement;
    if (active instanceof HTMLElement) active.blur();
    const lastIndex = stepHistory.length - 1;
    const previousStepIndex = stepHistory[lastIndex];
    if (previousStepIndex !== undefined && steps[previousStepIndex]) {
      setCurrentStepIndex(previousStepIndex);
      setStepHistory((prev) => prev.slice(0, lastIndex));
    }
  }, [stepHistory, steps]);

  // 브라우저 뒤로가기 → 이전 step 이동
  const hasResponses = Object.keys(responses).length > 0;
  // popstate 시점의 최신 stepHistory/handlePrevious 를 읽는다 — deps 에 넣으면 stepHistory/steps
  // 변경마다 리스너가 재등록되고 pushState 가드가 재평가되므로 effect event 로 분리한다.
  const onPopState = useEffectEvent(() => {
    if (stepHistory.length > 0) {
      handlePrevious();
    }
  });
  useEffect(() => {
    if (!loadedSurvey || isCompleted) return;

    // 현재 엔트리가 이미 이 스텝이면 push 생략 — StrictMode(dev) 이중 실행이 같은 스텝
    // 엔트리를 2개 쌓아 첫 뒤로가기가 무반응이 되는 것과, popstate 복귀 직후 재실행이
    // 중복 엔트리를 다시 쌓는 것을 함께 막는다 (실행 횟수와 무관하게 스텝당 1개 보장).
    const currentState = window.history.state as { stepIndex?: number } | null;
    if (currentState?.stepIndex !== currentStepIndex) {
      window.history.pushState({ stepIndex: currentStepIndex }, '');
    }

    const handlePopState = () => onPopState();

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
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
      <div className="text-muted-foreground mx-auto flex min-h-screen items-center justify-center text-sm">
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
          isPreview ? '입력 내용은 저장되지 않았습니다.' : loadedSurvey.settings.thankYouMessage
        }
        showCompletedTime={!isPreview}
      />
    );
  }

  // 표가 그려지는 페이지는 표 총폭 기준 분기(718px 초과 → 1280px, 이하 → 896px), 아니면 896px (2026-07-27)
  // 판정 대상은 type='table' 뿐 아니라 표-소스 radio/checkbox·ranking 도 포함한다 (rendersAsTable)
  // 설문 설정 "화면 너비" 토글이 켜져 있으면 표 유무와 무관하게 항상 넓게 (0063)
  //
  // 아래 컨테이너의 폭 전환(300ms)은 max-width 를 애니메이션하므로 매 프레임 clientWidth 가
  // 바뀐다. 표의 useElementWidth 가 이를 그대로 setState 로 흘리면 표가 프레임마다 리렌더되어
  // 다음 버튼이 눌린 뒤 화면이 늦게 잡힌다. 그래서 그 훅에서 측정을 코얼레싱한다
  // (use-element-width.ts). 전환 시간을 늘릴 때 그쪽 창 크기도 함께 보라.
  const containerMaxWidth = resolveResponseContainerWidth(
    currentStep.items.map((i) => i.question),
    { forceWide: loadedSurvey.settings.forceWideLayout },
  );
  const showRequiredHighlight = highlightQuestionIds.size > 0;
  // 미리보기도 '다음'으로 통일 — '확인 완료' 라벨은 마지막 페이지에서만 나타나
  // 버튼이 바뀐 것처럼 보이는 혼란만 줬다 (2026-08-12 피드백).
  const submitLabel = '다음';
  const submittingLabel = '처리 중...';

  return (
    <ContactAttrsProvider attrs={contactAttrs} quotes={answerQuotes}>
      <FormulaEvalProvider value={formulaCtx}>
        <div className="min-h-dvh bg-gray-50">
          {/* 봇 방어 허니팟 — 화면에 안 보이는 입력. 봇이 채우면 서버가 차단 */}
          <HoneypotField ref={honeypotRef} />
          {/* 헤더 — 제목/로고/통계법만 (진행바·카운트는 아래 회색 영역으로 분리) */}
          <div className="border-b border-gray-200 bg-white">
            <div
              className={`${containerMaxWidth} mx-auto px-4 pt-2 pb-2 transition-all duration-300 md:px-6 md:pb-0`}
            >
              <SurveyResponseHeader
                title={loadedSurvey.title}
                description={loadedSurvey.description}
                responseHeader={loadedSurvey.settings.responseHeader}
                showBranding={currentVisibleStepNumber <= 1}
              />
            </div>
          </div>

          {/* 진행 현황 — 헤더 밖 회색 영역(콘텐츠 컨테이너 위) */}
          <div
            className={`${containerMaxWidth} mx-auto px-4 pt-1 transition-all duration-300 md:px-6`}
          >
            <div className="hidden items-center justify-end pr-2 text-sm text-gray-500 md:flex">
              {currentVisibleStepNumber || 1} / {Math.max(totalVisibleStepCount, 1)}
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
                    {answeredCount}/{traversedQuestionIds.size} 응답 완료
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
            {reeditNotice && (
              <div
                role="status"
                className="mb-4 flex items-start gap-2 rounded border border-blue-300 bg-blue-50 px-3 py-2 text-sm text-blue-900"
              >
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                <div>
                  재응답이 허용된 설문입니다. 답변을 수정한 뒤 <strong>끝까지 진행해 제출</strong>
                  해야 완료로 반영됩니다. 제출하지 않고 나가면 완료 처리되지 않습니다.
                </div>
              </div>
            )}
            {resumeMessage && <ResumeToast message={resumeMessage} onDismiss={dismissResume} />}
            {rebaseMessage && (
              <ResumeToast message={rebaseMessage} onDismiss={() => setRebaseMessage(null)} />
            )}
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
              requiredMessageQuestionIds={requiredMessageQuestionIds}
              numericIssues={visibleNumericIssues}
            />

            {/* 데스크톱 네비게이션 */}
            <div className="mt-8 hidden items-center justify-between md:flex">
              <Button variant="outline" onClick={handlePrevious} disabled={!hasPreviousDisplayable}>
                <ArrowLeft className="mr-2 h-4 w-4" />
                이전
              </Button>

              {/* 가운데 슬롯 — admin-edit 경고 1회 상태에선 빈 필수 통과 안내가 우선한다.
              상단 배너는 시야에서 벗어나 인지되지 않아(2026-08-14) 버튼 사이로 이동. */}
              <div
                className="px-4 text-sm text-gray-500"
                role={showAdminEmptyRequiredWarning ? 'alert' : undefined}
              >
                {showAdminEmptyRequiredWarning && adminStepClassification ? (
                  <span className="flex flex-wrap items-center justify-center gap-2 text-amber-700">
                    <span>
                      {buildAdminEmptyRequiredWarningMessage(
                        adminStepClassification.emptyRequiredCount,
                      )}
                    </span>
                    {adminFirstEmptyRequiredTarget && (
                      <button
                        type="button"
                        className="shrink-0 rounded border border-amber-300 bg-amber-50 px-2 py-0.5 text-xs text-amber-900 hover:bg-amber-100"
                        onClick={() => {
                          const { questionId: targetQuestionId, issue: targetIssue } =
                            adminFirstEmptyRequiredTarget;
                          scrollToIssue({
                            questionId: targetQuestionId,
                            detailTargetIds: targetIssue?.detailTargetIds,
                            cellInstanceIds: buildRowWiseCellInstanceIds(
                              questions.find((q) => q.id === targetQuestionId)?.tableRowsData,
                              targetIssue?.cellIds,
                            ),
                            cellIds: targetIssue?.cellIds,
                          });
                        }}
                      >
                        위치로 이동
                      </button>
                    )}
                  </span>
                ) : (
                  !canProceed() && <span className="text-red-500">* 필수 질문에 답변해주세요</span>
                )}
              </div>

              {isLastVisibleStep ? (
                <Button onClick={handleNext} disabled={isSubmitting}>
                  {isSubmitting ? submittingLabel : submitLabel}
                  {!isSubmitting && <ArrowRight className="ml-2 h-4 w-4" />}
                </Button>
              ) : (
                <Button onClick={handleNext}>
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
      </FormulaEvalProvider>
    </ContactAttrsProvider>
  );
}
