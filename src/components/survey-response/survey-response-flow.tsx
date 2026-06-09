'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useRouter } from 'next/navigation';

import { AlertCircle, ArrowLeft, ArrowRight, CheckCircle, Loader2, Lock } from 'lucide-react';

import { client } from '@/shared/lib/rpc';
import { AlreadyRespondedView } from '@/components/survey/already-responded-view';
import { InviteRequiredScreen } from '@/components/survey-response/invite-required-screen';
import { MobileBottomNav } from '@/components/survey-response/mobile-bottom-nav';
import { QuestionInput } from '@/components/survey-response/question-input';
import { formatLocalDateTime } from '@/lib/date-formatters';
import { ContactAttrsProvider, useContactAttrs } from '@/lib/survey/contact-attrs-context';
import { substituteTokens } from '@/lib/survey/substitute-tokens';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

import { useClientSignals } from '@/hooks/use-client-signals';
import type { BlockReason } from '@/lib/duplicate-detection/types';
import { useKeyboardOpen } from '@/hooks/use-keyboard-open';
import { useMultiLineDetection } from '@/hooks/use-line-count-detection';
import { useMediaQuery } from '@/hooks/use-media-query';
import {
  buildRenderSteps,
  RenderStep,
  resolveStepBranch,
  StepItem,
  stepIdOf,
} from '@/lib/group-ordering';
import { isQuestionAnswered as isQuestionAnsweredPure } from '@/lib/survey/answer-validation';
import { sessionStorageKey } from '@/components/survey-response/hooks/session-helpers';
import { useResponseTelemetry } from '@/components/survey-response/hooks/use-response-telemetry';
import { useSessionRecovery } from '@/components/survey-response/hooks/use-session-recovery';
import { useSurveyLoader } from '@/components/survey-response/hooks/use-survey-loader';
import { ResumeToast } from '@/components/survey-response/resume-toast';
import { cn, isEmptyHtml } from '@/lib/utils';
import { sanitizeRichHtml } from '@/lib/sanitize';
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
  shouldDisplayDynamicGroup,
  shouldDisplayQuestion,
  shouldDisplayRow,
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
  const [sessionId, setSessionId] = useState<string>(() => `session-${Date.now()}`);

  // INSERT 진행 중인지 추적 (첫 답변 동시 발사 시 중복 INSERT 방어).
  // ref가 아닌 state라도 OK — `handleResponse` 클로저에서 캡처되는 시점이 한 번이면 충분.
  const [isCreatingResponse, setIsCreatingResponse] = useState(false);
  // 제출 시도 후 하이라이트할 질문 ID 집합
  const [highlightQuestionIds, setHighlightQuestionIds] = useState<Set<string>>(
    () => new Set(),
  );

  const keyboardOpen = useKeyboardOpen();

  // 클라이언트 신호 (deviceId, screen 등) — 마운트 시 한 번 수집
  // null 이면 아직 수집 전. 수집 완료 후 듀얼 effect (duplicate check, callsite) 재트리거
  const signals = useClientSignals();

  type DuplicateStatus =
    | { kind: 'checking' }
    | { kind: 'blocked'; reason: BlockReason }
    | { kind: 'ok' };
  // admin-edit 분기 (8/8) — 어드민 수정은 중복검사 대상이 아니므로 초기값부터 ok.
  const [duplicateStatus, setDuplicateStatus] = useState<DuplicateStatus>(() =>
    isAdminEdit ? { kind: 'ok' } : { kind: 'checking' },
  );

  // 진입 시 중복 검사 — 설문 로드 + 신호 수집 완료 후 1회 실행
  // signals 가 null 인 동안 effect skip → state 채워지면 자동 재실행
  // admin-edit 분기 (2/8) — 어드민 수정 모드에서는 검사 자체를 건너뜀 (초기값이 이미 ok)
  useEffect(() => {
    if (isAdminEdit) return;
    if (!loadedSurvey?.id || !signals) return;
    let cancelled = false;

    (async () => {
      try {
        const r = await client.surveyResponse.duplicate.checkOnEntry({
          surveyId: loadedSurvey.id,
          ...(inviteToken != null ? { inviteToken } : {}),
          clientSignals: signals,
        });
        if (cancelled) return;
        if (r.blocked) {
          setDuplicateStatus({ kind: 'blocked', reason: r.reason });
        } else {
          setDuplicateStatus({ kind: 'ok' });
        }
      } catch (err) {
        // 검사 실패 시 통과 가정 (best-effort) — 첫 답변에서 다시 검사됨
        console.error('checkDuplicateOnEntry 실패', err);
        if (!cancelled) setDuplicateStatus({ kind: 'ok' });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [isAdminEdit, loadedSurvey?.id, inviteToken, signals]);

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
    [steps, responses, questions, groups],
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

  const handleResponse = useCallback(
    (questionId: string, value: unknown) => {
      // UI는 즉시 반영 (로컬 응답 맵 + 펜딩 스토어 + 하이라이트 제거)
      setResponses((prev) => ({ ...prev, [questionId]: value }));
      setPendingResponse(questionId, value);
      setHighlightQuestionIds((prev) => {
        if (!prev.has(questionId)) return prev;
        const next = new Set(prev);
        next.delete(questionId);
        return next;
      });

      // 운영 현황 콘솔(T5): 첫 답변 시점에 응답 행을 INSERT.
      // - currentResponseId가 null & 진행 중 INSERT가 없을 때만 트리거
      // - createResponseWithFirstAnswer는 (surveyId, sessionId) 멱등 — 더블 클릭 방어
      // - 후속 답변은 별도 DB 쓰기 없음 (제출 시 completeResponse가 일괄 저장)
      // admin-edit 분기 (5/8) — 어드민 수정은 자동 저장 없음. 마지막 submit 시점에 일괄 갱신.
      if (
        !isAdminEdit &&
        currentResponseId === null &&
        !isCreatingResponse &&
        !isRecovering &&    // I-1 fix: 회복 진행 중에는 INSERT 발사 안 함
        loadedSurvey &&
        currentStep
      ) {
        setIsCreatingResponse(true);
        // signalsRef.current 가 null 이면 그대로 전달 — server action 이 신호 기반 검사 skip
        // (placeholder 신호로 hash 충돌 발생을 방지하기 위함)
        client.surveyResponse.response.createWithFirstAnswer({
          surveyId: loadedSurvey.id,
          sessionId,
          versionId: versionId ?? null,
          questionId,
          value,
          currentStepId: stepIdOf(currentStep),
          visibleStepIndex: visibleProgressRef.current.index,
          visibleStepTotal: visibleProgressRef.current.total,
          ...(inviteToken != null ? { inviteToken } : {}),
          clientSignals: signals,
        })
          .then((result) => {
            if (result.kind === 'blocked') {
              setDuplicateStatus({ kind: 'blocked', reason: result.reason });
              return;
            }
            const { id, contactTargetId } = result;
            setCurrentResponseId(id);
            // invite 토큰이 있었는데 contactTargetId 매칭 실패 → 무효 토큰. 익명 응답으로 폴백 알림.
            if (inviteToken && !contactTargetId) {
              setInviteIsInvalid(true);
            }
            // 회복용 sessionId localStorage 저장 — 같은 브라우저에서 재진입 시 resumeOrCreate가 이 키로 row 조회
            if (typeof window !== 'undefined' && loadedSurvey) {
              window.localStorage.setItem(sessionStorageKey(loadedSurvey.id), sessionId);
            }
          })
          .catch((err) => {
            console.error('응답 시작 오류:', err);
          })
          .finally(() => {
            setIsCreatingResponse(false);
          });
      }
    },
    [
      setPendingResponse,
      currentResponseId,
      isCreatingResponse,
      isRecovering,
      isAdminEdit,
      loadedSurvey,
      currentStep,
      sessionId,
      versionId,
      setCurrentResponseId,
      inviteToken,
    ],
  );

  const handleSubmit = useCallback(async () => {
    setIsSubmitting(true);

    try {
      const unansweredRequired = questions.filter((q) => {
        if (!shouldDisplayQuestion(q, responses, questions, groups, evalCtx)) return false;
        return isQuestionRequired(q) && !isQuestionAnswered(q);
      });

      if (unansweredRequired.length > 0) {
        // 미응답 필수 질문을 전부 하이라이트
        const highlight = new Set(unansweredRequired.map((q) => q.id));
        setHighlightQuestionIds(highlight);

        // 첫 번째 미응답 필수 질문이 속한 step으로 이동
        const firstRequired = unansweredRequired[0];
        if (!firstRequired) return;
        const firstId = firstRequired.id;
        const targetIdx = steps.findIndex((s) => {
          if (s.kind === 'table') return s.question.id === firstId;
          return s.items.some((it) => it.question.id === firstId);
        });
        if (targetIdx !== -1 && targetIdx !== currentStepIndex) {
          setCurrentStepIndex(targetIdx);
          window.scrollTo({ top: 0, behavior: 'smooth' });
        } else {
          // 이미 해당 step이면 카드로 스크롤
          const el = document.querySelector<HTMLElement>(
            `[data-question-id="${firstId}"]`,
          );
          el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
        setIsSubmitting(false);
        return;
      }

      setHighlightQuestionIds(new Set());

      // admin-edit 분기 (6/8) — 새 응답 INSERT 없이 onSubmit 으로 위임.
      if (isAdminEdit && adminContext) {
        // 옵션 텍스트(__optTexts__) 사이드카 — 응답자 흐름과 동일하게 합쳐서 보낸다.
        const questionResponses = buildOptTextsPayload(visibleQuestions, responses);

        // onSubmit 안에서 router.push 처리 — 본 컴포넌트는 thank-you 화면을 띄우지 않는다.
        await adminContext.onSubmit({ questionResponses });
        resetResponseState();
        return;
      }

      // currentResponseId === null fallback —
      // notice-only / optional-only / 분기로 visible 질문 0 인 설문은
      // handleResponse 가 한 번도 트리거되지 않아 응답 row 가 만들어지지 않는다.
      // 그 상태로 제출이 통과하면 silent data loss 가 되므로 여기서 빈 응답을 INSERT 한다.
      let effectiveResponseId = currentResponseId;
      if (!effectiveResponseId && loadedSurvey && currentStep) {
        try {
          // signalsRef.current 가 null 이면 그대로 전달 — server action 이 신호 기반 검사 skip
          const created = await client.surveyResponse.response.createBlank({
            surveyId: loadedSurvey.id,
            sessionId,
            versionId: versionId ?? null,
            currentStepId: stepIdOf(currentStep),
            ...(inviteToken != null ? { inviteToken } : {}),
            clientSignals: signals,
          });
          if (created.kind === 'blocked') {
            setDuplicateStatus({ kind: 'blocked', reason: created.reason });
            setIsSubmitting(false);
            return;
          } else {
            effectiveResponseId = created.id;
            setCurrentResponseId(created.id);
            if (inviteToken && !created.contactTargetId) {
              setInviteIsInvalid(true);
            }
            if (typeof window !== 'undefined') {
              window.localStorage.setItem(sessionStorageKey(loadedSurvey.id), sessionId);
            }
          }
        } catch (err) {
          console.error('빈 응답 생성 오류:', err);
        }
      }

      if (effectiveResponseId) {
        const exposedQuestionIds = visibleQuestions.map((q) => q.id);

        const exposedRowIds = visibleQuestions
          .filter((q) => q.type === 'table' && q.tableRowsData)
          .flatMap((q) => {
            const qResponse = (responses as Record<string, any>)?.[q.id];
            const selectedDynamicIds = new Set<string>(
              (qResponse?.__selectedRowIds as string[]) ?? [],
            );
            const enabledGroupIds = new Set(
              (q.dynamicRowConfigs ?? [])
                .filter(
                  (g) =>
                    g.enabled &&
                    shouldDisplayDynamicGroup(g, responses as Record<string, unknown>, questions, evalCtx),
                )
                .map((g) => g.groupId),
            );
            const hasDynamic =
              enabledGroupIds.size > 0 && q.tableRowsData!.some((r) => r.dynamicGroupId);

            const groupsWithSelections = new Set<string>();
            if (hasDynamic) {
              for (const row of q.tableRowsData!) {
                if (row.dynamicGroupId && selectedDynamicIds.has(row.id)) {
                  groupsWithSelections.add(row.dynamicGroupId);
                }
              }
            }

            return q.tableRowsData!
              .filter((row) => {
                if (!shouldDisplayRow(row, responses as Record<string, unknown>, questions, evalCtx))
                  return false;
                if (hasDynamic) {
                  if (row.dynamicGroupId && enabledGroupIds.has(row.dynamicGroupId)) {
                    return selectedDynamicIds.has(row.id);
                  }
                  if (
                    row.showWhenDynamicGroupId &&
                    enabledGroupIds.has(row.showWhenDynamicGroupId)
                  ) {
                    return groupsWithSelections.has(row.showWhenDynamicGroupId);
                  }
                }
                return true;
              })
              .map((row) => row.id);
          });

        // 제출 직전 — 미선택 옵션의 텍스트 drop 후 questionResponses에 병합.
        const questionResponsesWithTexts = buildOptTextsPayload(visibleQuestions, responses);

        await client.surveyResponse.response.complete({
          responseId: effectiveResponseId,
          data: {
            questionResponses: questionResponsesWithTexts,
            exposedQuestionIds,
            exposedRowIds,
          },
        });

        // 제출 성공 — 회복용 localStorage 키 정리 (재진입 시 새 응답 흐름)
        if (typeof window !== 'undefined' && loadedSurvey) {
          window.localStorage.removeItem(sessionStorageKey(loadedSurvey.id));
        }
      }

      resetResponseState();
      setIsCompleted(true);
    } catch (error) {
      console.error('응답 제출 오류:', error);
      alert('응답 제출 중 오류가 발생했습니다. 다시 시도해주세요.');
    } finally {
      setIsSubmitting(false);
    }
  }, [
    adminContext,
    currentResponseId,
    currentStep,
    currentStepIndex,
    evalCtx,
    groups,
    inviteToken,
    isAdminEdit,
    isQuestionAnswered,
    loadedSurvey,
    questions,
    resetResponseState,
    responses,
    sessionId,
    setCurrentResponseId,
    signals,
    steps,
    versionId,
    visibleQuestions,
  ]);

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
    return (
      <div className="flex min-h-dvh items-center justify-center bg-gray-50">
        <Card className="mx-auto max-w-md">
          <CardContent className="p-8 text-center">
            <Loader2 className="mx-auto mb-4 h-12 w-12 animate-spin text-blue-500" />
            <h2 className="mb-2 text-xl font-semibold text-gray-900">설문을 불러오는 중...</h2>
            <p className="text-gray-600">잠시만 기다려주세요.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  // 에러 발생
  if (loadError || !loadedSurvey) {
    const isPrivateError = loadError?.includes('비공개');

    return (
      <div className="flex min-h-dvh items-center justify-center bg-gray-50">
        <Card className="mx-auto max-w-md">
          <CardContent className="p-8 text-center">
            {isPrivateError ? (
              <Lock className="mx-auto mb-4 h-12 w-12 text-yellow-500" />
            ) : (
              <AlertCircle className="mx-auto mb-4 h-12 w-12 text-red-500" />
            )}
            <h2 className="mb-2 text-xl font-semibold text-gray-900">
              {isPrivateError ? '접근이 제한된 설문입니다' : '설문을 찾을 수 없습니다'}
            </h2>
            <p className="mb-4 text-gray-600">
              {loadError || '요청하신 설문이 존재하지 않거나 삭제되었습니다.'}
            </p>
            <Button onClick={() => router.push('/')}>
              <ArrowLeft className="mr-2 h-4 w-4" />
              홈으로 돌아가기
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (questions.length === 0 || steps.length === 0 || !currentStep) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-gray-50">
        <Card className="mx-auto max-w-md">
          <CardContent className="p-8 text-center">
            <AlertCircle className="mx-auto mb-4 h-12 w-12 text-yellow-500" />
            <h2 className="mb-2 text-xl font-semibold text-gray-900">아직 질문이 없습니다</h2>
            <p className="mb-4 text-gray-600">이 설문에는 아직 질문이 등록되지 않았습니다.</p>
            <Button onClick={() => router.push('/')}>
              <ArrowLeft className="mr-2 h-4 w-4" />
              홈으로 돌아가기
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // 완료 화면
  if (isCompleted) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-gray-50">
        <Card className="mx-auto max-w-md">
          <CardContent className="p-8 text-center">
            <CheckCircle className="mx-auto mb-4 h-16 w-16 text-green-500" />
            <h2 className="mb-2 text-2xl font-semibold text-gray-900">응답 완료!</h2>
            <p className="mb-6 text-gray-600">
              {loadedSurvey.settings.thankYouMessage || '설문에 참여해주셔서 감사합니다!'}
            </p>
            <div className="space-y-2 text-sm text-gray-500">
              <p>총 {questions.length}개 질문</p>
              <p>응답 완료 시간: {formatLocalDateTime(new Date())}</p>
            </div>
          </CardContent>
        </Card>
      </div>
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

// ── 서브 컴포넌트 ──

/**
 * TipTap이 출력한 sanitized HTML을 prose 스타일로 렌더.
 * 모바일 표 길들이기는 globals.css의 `.tiptap-mobile-tame`이 담당하므로
 * 여기선 데스크탑용 prose + 표 외형만 정의한다.
 */
function RichDescription({
  html,
  size = 'sm',
  className,
}: {
  html: string;
  size?: 'sm' | 'base';
  className?: string;
}) {
  return (
    <div
      className={cn(
        'tiptap-mobile-tame prose min-w-0 max-w-none [&_a]:break-all [&_p]:break-words',
        '[&_table]:max-w-full [&_table]:table-auto [&_table]:border-collapse [&_table]:border [&_table]:border-gray-200 [&_table_p]:m-0',
        '[&_table_td]:border [&_table_td]:border-gray-200 [&_table_td]:break-words',
        '[&_table_th]:border [&_table_th]:border-gray-200 [&_table_th]:bg-gray-50 [&_table_th]:break-words [&_table_th]:font-semibold',
        size === 'base' ? 'prose-base' : 'prose-sm',
        className,
      )}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

function TableStepView({
  step,
  isMobile,
  titleHasMultipleLines,
  currentStepNumber,
  responses,
  questions,
  onResponse,
  highlightQuestionIds,
}: {
  step: Extract<RenderStep, { kind: 'table' }>;
  isMobile: boolean;
  titleHasMultipleLines: boolean;
  currentStepNumber: number;
  responses: ResponsesMap;
  questions: Question[];
  onResponse: (questionId: string, value: unknown) => void;
  highlightQuestionIds: Set<string>;
}) {
  const q = step.question;
  const isHighlighted = highlightQuestionIds.has(q.id);
  const onChange = useCallback((value: unknown) => onResponse(q.id, value), [onResponse, q.id]);
  const attrs = useContactAttrs();
  const titleText = useMemo(
    () => substituteTokens(q.title ?? '', attrs),
    [q.title, attrs],
  );
  const descriptionHtml = useMemo(
    () => sanitizeRichHtml(substituteTokens(q.description ?? '', attrs)),
    [q.description, attrs],
  );

  return (
    <>
      {/* 모바일: 제목/설명을 카드 밖으로 분리 */}
      {isMobile && (
        <div className="mb-4 space-y-2.5" data-question-id={q.id}>
          {(step.rootGroupName || step.subgroupName) && (
            <div className="flex flex-wrap items-center gap-2">
              {step.rootGroupName && (
                <span className="inline-block rounded-full bg-blue-50 px-3 py-1 text-xs font-medium text-blue-700">
                  {step.rootGroupName}
                </span>
              )}
              {step.subgroupName && step.subgroupName !== step.rootGroupName && (
                <span className="inline-block rounded-full bg-gray-100 px-3 py-1 text-xs font-medium text-gray-700">
                  {step.subgroupName}
                </span>
              )}
            </div>
          )}
          <h2
            className={`${
              titleHasMultipleLines ? 'text-lg' : 'text-xl'
            } leading-[1.6] font-bold break-keep text-gray-900`}
          >
            {titleText}
            {q.required && (
              <span className="ml-1 align-top text-sm text-red-500" aria-label="필수 질문">
                *
              </span>
            )}
          </h2>
          {!isEmptyHtml(q.description) && (
            <RichDescription
              html={descriptionHtml}
              size="base"
              className="max-h-[40vh] overflow-y-auto leading-relaxed text-base text-gray-500 [&_p]:min-h-[1.5em] [&_p]:leading-relaxed [&_table]:my-2 [&_table_td]:px-3 [&_table_td]:py-1.5 [&_table_th]:px-3 [&_table_th]:py-1.5"
            />
          )}
        </div>
      )}

      <Card
        key={q.id}
        className={`animate-in fade-in duration-200 ${
          isHighlighted ? 'border-red-300 ring-2 ring-red-100' : ''
        }`}
        data-question-id={q.id}
      >
        {!isMobile && (
          <CardHeader className="pb-4">
            {(step.rootGroupName || step.subgroupName) && (
              <div className="mb-2 flex flex-wrap items-center gap-2">
                {step.rootGroupName && (
                  <span className="inline-block rounded-full bg-blue-50 px-3 py-1 text-xs font-medium text-blue-700">
                    {step.rootGroupName}
                  </span>
                )}
                {step.subgroupName && step.subgroupName !== step.rootGroupName && (
                  <span className="inline-block rounded-full bg-gray-100 px-3 py-1 text-xs font-medium text-gray-700">
                    {step.subgroupName}
                  </span>
                )}
              </div>
            )}
            <div className="flex items-start gap-4">
              <span className="mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-blue-100 text-sm font-semibold text-blue-600 shadow-sm">
                {currentStepNumber || 1}
              </span>
              <div className="min-w-0 flex-1">
                <CardTitle className="text-2xl leading-relaxed font-semibold break-keep text-gray-900">
                  {titleText}
                  {q.required && (
                    <span className="ml-1.5 align-top text-sm text-red-500" aria-label="필수 질문">
                      *
                    </span>
                  )}
                </CardTitle>
                {!isEmptyHtml(q.description) && (
                  <RichDescription
                    html={descriptionHtml}
                    size="base"
                    className="mt-3 max-h-[60vh] overflow-y-auto text-base text-gray-600 [&_p]:min-h-[1.6em] [&_table]:my-2 [&_table_td]:px-4 [&_table_td]:py-2 [&_table_th]:px-4 [&_table_th]:py-2"
                  />
                )}
              </div>
            </div>
          </CardHeader>
        )}

        <CardContent className={isMobile ? 'p-4' : ''}>
          <div className="space-y-4">
            <QuestionInput
              question={q}
              value={responses[q.id]}
              onChange={onChange}
              allResponses={responses as Record<string, unknown>}
              allQuestions={questions}
            />
          </div>
        </CardContent>
      </Card>
    </>
  );
}

function GroupStepView({
  step,
  responses,
  questions,
  groups,
  evalCtx,
  onResponse,
  highlightQuestionIds,
}: {
  step: Extract<RenderStep, { kind: 'group' }>;
  responses: ResponsesMap;
  questions: Question[];
  groups: QuestionGroup[];
  evalCtx: BranchEvalCtx;
  onResponse: (questionId: string, value: unknown) => void;
  highlightQuestionIds: Set<string>;
}) {
  // 표시 가능한 items만 필터 (원래 subgroupName 유지)
  const visibleItems: StepItem[] = useMemo(
    () =>
      step.items.filter((it) =>
        shouldDisplayQuestion(it.question, responses, questions, groups, evalCtx),
      ),
    [step.items, responses, questions, groups, evalCtx],
  );

  return (
    <Card className="animate-in fade-in duration-200">
      <CardHeader className="pb-6">
        {step.rootGroupName && (
          <span className="inline-block w-fit rounded-md bg-blue-50 px-3.5 py-2 text-base font-semibold tracking-wide text-blue-700">
            {step.rootGroupName}
          </span>
        )}
      </CardHeader>
      <CardContent className="md:px-8">
        <div className="divide-y divide-gray-100">
          {visibleItems.map((item, idx) => (
            <GroupStepItem
              key={item.question.id}
              item={item}
              itemIndex={idx + 1}
              showSubgroupHeading={
                !!item.subgroupName && item.subgroupName !== step.rootGroupName
              }
              responses={responses}
              questions={questions}
              onResponse={onResponse}
              isHighlighted={highlightQuestionIds.has(item.question.id)}
            />
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function GroupStepItem({
  item,
  itemIndex,
  showSubgroupHeading,
  responses,
  questions,
  onResponse,
  isHighlighted,
}: {
  item: StepItem;
  itemIndex: number;
  showSubgroupHeading: boolean;
  responses: ResponsesMap;
  questions: Question[];
  onResponse: (questionId: string, value: unknown) => void;
  isHighlighted: boolean;
}) {
  const q = item.question;
  const onChange = useCallback(
    (value: unknown) => onResponse(q.id, value),
    [onResponse, q.id],
  );
  const attrs = useContactAttrs();
  const titleText = useMemo(
    () => substituteTokens(q.title ?? '', attrs),
    [q.title, attrs],
  );
  const descriptionHtml = useMemo(
    () => sanitizeRichHtml(substituteTokens(q.description ?? '', attrs)),
    [q.description, attrs],
  );

  return (
    <div className="py-5 first:pt-0 last:pb-0">
      {showSubgroupHeading && (
        <h3 className="mb-3 text-sm font-semibold tracking-[0.12em] text-gray-500 uppercase md:text-xs">
          {item.subgroupName}
        </h3>
      )}
      <div
        data-question-id={q.id}
        className={`space-y-2 ${
          isHighlighted ? '-mx-3 rounded-md bg-red-50/40 p-3 ring-1 ring-red-200' : ''
        }`}
      >
        <div className="flex items-start gap-2.5">
          <span
            className={`mt-0.5 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full text-sm font-semibold tabular-nums md:h-6 md:w-6 md:text-xs ${
              isHighlighted ? 'bg-red-100 text-red-600' : 'bg-blue-100 text-blue-600'
            }`}
          >
            {itemIndex}
          </span>
          <div
            id={`q-label-${q.id}`}
            className={`text-lg leading-snug font-semibold break-keep ${
              isHighlighted ? 'text-red-700' : 'text-gray-900'
            }`}
          >
            {titleText}
            {q.required && (
              <span className="ml-1 text-red-500" aria-label="필수 질문">
                *
              </span>
            )}
          </div>
        </div>
        {!isEmptyHtml(q.description) && (
          <RichDescription
            html={descriptionHtml}
            size="sm"
            className="ml-3 md:overflow-x-auto text-sm text-gray-500 md:text-xs [&_p]:min-h-[1.3em] [&_table]:my-1.5 [&_table_td]:px-2.5 [&_table_td]:py-1 [&_table_th]:px-2.5 [&_table_th]:py-1"
          />
        )}
        <div
          role="group"
          aria-labelledby={`q-label-${q.id}`}
          className="mt-2 ml-3"
        >
          <QuestionInput
            question={q}
            value={responses[q.id]}
            onChange={onChange}
            allResponses={responses as Record<string, unknown>}
            allQuestions={questions}
          />
        </div>
      </div>
    </div>
  );
}
