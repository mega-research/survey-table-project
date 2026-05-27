'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

import { useParams, useRouter, useSearchParams } from 'next/navigation';

import { AlertCircle, ArrowLeft, ArrowRight, CheckCircle, Loader2, Lock } from 'lucide-react';

import {
  getSurveyByPrivateToken,
  getSurveyBySlug,
  getSurveyForResponse,
} from '@/actions/query-actions';
import {
  completeResponse,
  createBlankResponse,
  createResponseWithFirstAnswer,
  recordStepVisit,
  resumeOrCreateResponse,
} from '@/actions/response-actions';
import { lookupContactAttrs } from '@/actions/contact-attrs-actions';
import { checkDuplicateOnEntry } from '@/actions/duplicate-detection-actions';
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
  StepItem,
} from '@/lib/group-ordering';
import { parsesurveyIdentifier } from '@/lib/survey-url';
import { isEmptyHtml } from '@/lib/utils';
import { sanitizeRichHtml } from '@/lib/sanitize';
import {
  collectTableQuestionOptions,
  filterOptionTextsForSubmission,
} from '@/lib/option-text-migration';

import { useSurveyResponseStore } from '@/stores/survey-response-store';
import { useShallow } from 'zustand/react/shallow';
import { Question, QuestionGroup, Survey } from '@/types/survey';
import {
  getBranchRuleForResponse,
  shouldDisplayDynamicGroup,
  shouldDisplayQuestion,
  shouldDisplayRow,
  type BranchEvalCtx,
} from '@/utils/branch-logic';

type ResponsesMap = Record<string, unknown>;

/**
 * 운영 현황 콘솔용 step 고유 식별자.
 * - table step: 'table:<questionId>'
 * - group step: 'group:<rootGroupId | "root">' (ungrouped는 'root')
 *
 * 동일 RenderStep에 대해 항상 같은 문자열을 반환해야 recordStepVisit의
 * 멱등성(no-op when currentStepId === nextStepId)이 유지된다.
 */
function stepIdOf(step: RenderStep): string {
  if (step.kind === 'table') {
    return `table:${step.question.id}`;
  }
  return `group:${step.rootGroupId ?? 'root'}`;
}

/**
 * localStorage 키 — 회복용 sessionId 보관.
 * 첫 답변 INSERT 성공 후 SET, completeResponse 성공 후 DELETE.
 */
function sessionStorageKey(surveyId: string): string {
  return `survey-session:${surveyId}`;
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

export default function SurveyResponsePage() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  // URL 인코딩된 한글 slug를 디코딩
  const identifier = decodeURIComponent(params.id as string);

  // ?invite=<token> — contact 매칭용. 없으면 익명 응답 흐름 그대로.
  const inviteToken = searchParams?.get('invite') ?? null;
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

  // 설문 로딩 상태
  const [isLoading, setIsLoading] = useState(true);
  const [loadedSurvey, setLoadedSurvey] = useState<Survey | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  // attrs 토큰 prefill — invite 매칭 시 contact_targets.attrs 로드
  const [contactAttrs, setContactAttrs] = useState<Record<string, string>>({});
  // requireInviteToken=true 설문에 invite 없이 접근 시 차단
  const [showInviteRequired, setShowInviteRequired] = useState(false);

  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [responses, setResponses] = useState<ResponsesMap>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isCompleted, setIsCompleted] = useState(false);
  const [stepHistory, setStepHistory] = useState<number[]>([]);
  const [versionId, setVersionId] = useState<string | null>(null);

  // 페이지 진입 시 1회 생성된 세션 식별자. 컴포넌트 수명 동안 안정적.
  // - createResponseWithFirstAnswer의 멱등성 키 (surveyId, sessionId)
  // - 새 응답 행은 첫 답변 시점에만 INSERT (페이지 진입 시 X)
  const [sessionId, setSessionId] = useState<string>(() => `session-${Date.now()}`);

  // INSERT 진행 중인지 추적 (첫 답변 동시 발사 시 중복 INSERT 방어).
  // ref가 아닌 state라도 OK — `handleResponse` 클로저에서 캡처되는 시점이 한 번이면 충분.
  const [isCreatingResponse, setIsCreatingResponse] = useState(false);
  // recovery effect 가 resumeOrCreateResponse 를 await 하는 동안 true.
  // handleResponse 의 INSERT 가드에서 참조해 recovery 완료 전 신규 INSERT 발사를 차단한다 (I-1).
  const [isRecovering, setIsRecovering] = useState(false);
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
  const [duplicateStatus, setDuplicateStatus] = useState<DuplicateStatus>({ kind: 'checking' });

  // URL 식별자로 설문 조회
  useEffect(() => {
    const loadSurvey = async () => {
      setIsLoading(true);
      setLoadError(null);

      try {
        const { type, value } = parsesurveyIdentifier(identifier);

        let surveyId: string | null = null;

        switch (type) {
          case 'slug': {
            const dbSurvey = await getSurveyBySlug(value);
            if (dbSurvey) surveyId = dbSurvey.id;
            break;
          }
          case 'privateToken': {
            const dbSurvey = await getSurveyByPrivateToken(value);
            if (dbSurvey) {
              surveyId = dbSurvey.id;
            } else {
              // UUID 형태지만 private_token 매칭 실패 — surveys.id 로 직접 시도.
              // 단체 메일/컨택 응답 링크가 surveys.id 직접 URL을 사용하므로 호환 필요.
              surveyId = value;
            }
            break;
          }
          case 'id':
            surveyId = value;
            break;
        }

        if (!surveyId) {
          setLoadError('요청하신 설문을 찾을 수 없습니다.');
          setLoadedSurvey(null);
          return;
        }

        const result = await getSurveyForResponse(surveyId);

        if (!result) {
          setLoadError('요청하신 설문을 찾을 수 없습니다.');
          setLoadedSurvey(null);
        } else if (!result.survey.settings.isPublic && type === 'slug') {
          setLoadError('이 설문은 비공개 설문입니다. 올바른 링크로 접근해주세요.');
          setLoadedSurvey(null);
        } else {
          setLoadedSurvey(result.survey);
          setVersionId(result.versionId);

          // requireInviteToken 체크 + attrs 로드
          if (result.survey.settings.requireInviteToken && !inviteToken) {
            setShowInviteRequired(true);
          } else if (inviteToken) {
            const attrs = await lookupContactAttrs(surveyId, inviteToken);
            if (attrs) {
              setContactAttrs(attrs);
            } else if (result.survey.settings.requireInviteToken) {
              // 토큰 무효 + requireInviteToken → 차단
              setShowInviteRequired(true);
            }
            // 토큰 무효 + requireInviteToken=false → 기존 amber alert (inviteIsInvalid)
            // 만 노출. attrs 는 빈 Record 유지.
          }
        }
      } catch (error) {
        console.error('설문 로딩 오류:', error);
        setLoadError('설문을 불러오는 중 오류가 발생했습니다.');
        setLoadedSurvey(null);
      } finally {
        setIsLoading(false);
      }
    };

    loadSurvey();
  }, [identifier]);

  // 진입 시 중복 검사 — 설문 로드 + 신호 수집 완료 후 1회 실행
  // signals 가 null 인 동안 effect skip → state 채워지면 자동 재실행
  useEffect(() => {
    if (!loadedSurvey?.id || !signals) return;
    let cancelled = false;

    (async () => {
      try {
        const r = await checkDuplicateOnEntry({
          surveyId: loadedSurvey.id,
          inviteToken: inviteToken ?? undefined,
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
  }, [loadedSurvey?.id, inviteToken, signals]);

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

  // 운영 현황 콘솔(T5): 스텝 전환 추적.
  // - currentResponseId가 set된 이후(첫 답변 후)에만 동작
  // - 동일 stepId면 서버에서 no-op (멱등)
  // - 실패는 사용자 흐름을 막지 않고 콘솔에만 남긴다 (best-effort)
  useEffect(() => {
    if (currentResponseId === null) return;
    if (!currentStep) return;
    const nextStepId = stepIdOf(currentStep);
    recordStepVisit({ responseId: currentResponseId, nextStepId }).catch((err) => {
      console.error('recordStepVisit 실패:', err);
    });
  }, [currentResponseId, currentStep]);

  // 운영 현황 콘솔(T6): localStorage 기반 응답 회복.
  // - 진입 시 1회 실행 (loadedSurvey 로드 완료 + currentResponseId 가 아직 null 일 때)
  // - localStorage에 saved sessionId 가 있으면 resumeOrCreateResponse 호출
  // - drop → in_progress 회복 시 sessionId/currentResponseId 갱신 + 토스트
  // - 종결 상태이거나 orphan(DB row 없음)이면 키 정리
  // - dep array에 sessionId 자체는 넣지 않는다 (saved 값을 effect 내부에서 직접 set → 무한 루프 방지)
  const [resumeMessage, setResumeMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!loadedSurvey || currentResponseId !== null) return;

    const key = sessionStorageKey(loadedSurvey.id);
    const savedSessionId = window.localStorage.getItem(key);
    if (!savedSessionId) return;

    setIsRecovering(true);
    resumeOrCreateResponse({
      surveyId: loadedSurvey.id,
      sessionId: savedSessionId,
      inviteToken: inviteToken ?? undefined,
    })
      .then((result) => {
        if (!result) {
          // localStorage 키는 있는데 DB에 row 없음 — orphan, 정리
          window.localStorage.removeItem(key);
          return;
        }
        // 종결 상태(completed/screened/quotaful/bad)면 회복 안 시키고 새 응답 흐름 둔다
        if (result.status !== 'in_progress') {
          window.localStorage.removeItem(key);
          return;
        }
        // 응답 row 사용 — sessionId 를 saved 값으로 갱신해 DB row 와 일치시킨다
        setSessionId(savedSessionId);
        setCurrentResponseId(result.id);
        // 회복된 경우(drop → in_progress)만 토스트
        if (result.resumed) {
          setResumeMessage('이전 응답을 이어서 진행합니다');
        }
      })
      .catch((err) => {
        console.error('응답 회복 실패:', err);
      })
      .finally(() => {
        setIsRecovering(false);
      });
  }, [loadedSurvey, currentResponseId, setCurrentResponseId, inviteToken]);

  // 회복 토스트 자동 dismiss (4초)
  useEffect(() => {
    if (!resumeMessage) return;
    const timer = setTimeout(() => setResumeMessage(null), 4000);
    return () => clearTimeout(timer);
  }, [resumeMessage]);

  const hasPreviousDisplayable = stepHistory.length > 0;

  const isQuestionRequired = (question: Question) => question.required;

  const isQuestionAnswered = useCallback(
    (question: Question) => {
      const response = responses[question.id];
      if (response === undefined || response === null) return false;

      switch (question.type) {
        case 'notice':
          if (!question.requiresAcknowledgment) return true;
          if (
            response &&
            typeof response === 'object' &&
            'agreed' in (response as Record<string, unknown>)
          )
            return (response as { agreed: boolean }).agreed;
          return response === true;
        case 'text':
        case 'textarea':
          return typeof response === 'string' && response.trim().length > 0;
        case 'radio':
        case 'select':
          return response !== null && response !== undefined && response !== '';
        case 'checkbox':
          if (!Array.isArray(response) || response.length === 0) return false;
          if (question.minSelections !== undefined && question.minSelections > 0) {
            return response.length >= question.minSelections;
          }
          return true;
        case 'multiselect':
          return Array.isArray(response) && response.length > 0;
        case 'table':
          return (
            typeof response === 'object' &&
            response !== null &&
            Object.keys(response as Record<string, unknown>).length > 0
          );
        default:
          return true;
      }
    },
    [responses],
  );

  // 다음 step 결정 (step 내 분기 규칙 평가)
  const resolveNextStepIndex = useCallback((): number => {
    if (!currentStep) return -1;

    // step 내 각 질문의 분기 규칙 검사: end 또는 goto
    for (const q of currentStepQuestions) {
      const rule = getBranchRuleForResponse(q, responses[q.id]);
      if (!rule) continue;
      if (rule.action === 'end') return -1;
      if (rule.action === 'goto' && rule.targetQuestionId) {
        const targetIdx = steps.findIndex((s) => {
          if (s.kind === 'table') return s.question.id === rule.targetQuestionId;
          return s.items.some((it) => it.question.id === rule.targetQuestionId);
        });
        if (targetIdx !== -1) return targetIdx;
      }
    }

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
      if (
        currentResponseId === null &&
        !isCreatingResponse &&
        !isRecovering &&    // I-1 fix: 회복 진행 중에는 INSERT 발사 안 함
        loadedSurvey &&
        currentStep
      ) {
        setIsCreatingResponse(true);
        // signalsRef.current 가 null 이면 그대로 전달 — server action 이 신호 기반 검사 skip
        // (placeholder 신호로 hash 충돌 발생을 방지하기 위함)
        createResponseWithFirstAnswer({
          surveyId: loadedSurvey.id,
          sessionId,
          versionId: versionId ?? null,
          questionId,
          value,
          currentStepId: stepIdOf(currentStep),
          inviteToken: inviteToken ?? undefined,
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
        const firstId = unansweredRequired[0].id;
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

      // currentResponseId === null fallback —
      // notice-only / optional-only / 분기로 visible 질문 0 인 설문은
      // handleResponse 가 한 번도 트리거되지 않아 응답 row 가 만들어지지 않는다.
      // 그 상태로 제출이 통과하면 silent data loss 가 되므로 여기서 빈 응답을 INSERT 한다.
      let effectiveResponseId = currentResponseId;
      if (!effectiveResponseId && loadedSurvey && currentStep) {
        try {
          // signalsRef.current 가 null 이면 그대로 전달 — server action 이 신호 기반 검사 skip
          const created = await createBlankResponse({
            surveyId: loadedSurvey.id,
            sessionId,
            versionId: versionId ?? null,
            currentStepId: stepIdOf(currentStep),
            inviteToken: inviteToken ?? undefined,
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
        // store의 optionTexts(key=option.id)와 responses value(=option.value)가 다르므로
        // question.options 배열을 통해 value→id 변환 후 필터링.
        // 기존 분석 파이프라인(value가 string/array라는 가정)을 보존하기 위해
        // optionTexts는 "__optTexts__" 사이드카 key에 저장한다.
        const storeOptTexts = useSurveyResponseStore.getState().optionTexts;
        const filteredOptTexts: Record<string, Record<string, string>> = {};
        for (const q of visibleQuestions) {
          const qOptTexts = storeOptTexts[q.id];
          if (!qOptTexts || Object.keys(qOptTexts).length === 0) continue;
          const qValue = responses[q.id];
          // 테이블 질문은 셀 단위로 옵션이 흩어져 있으므로 모든 셀의 옵션을 모아 전달
          const optionsForFilter = q.type === 'table'
            ? collectTableQuestionOptions(q)
            : q.options;
          const filtered = filterOptionTextsForSubmission(qValue, qOptTexts, optionsForFilter);
          if (filtered) {
            filteredOptTexts[q.id] = filtered;
          }
        }
        const questionResponsesWithTexts: Record<string, unknown> = {
          ...responses,
          ...(Object.keys(filteredOptTexts).length > 0
            ? { __optTexts__: filteredOptTexts }
            : {}),
        };

        await completeResponse(effectiveResponseId, {
          questionResponses: questionResponsesWithTexts,
          exposedQuestionIds,
          exposedRowIds,
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
    currentResponseId,
    currentStep,
    currentStepIndex,
    groups,
    inviteToken,
    isQuestionAnswered,
    loadedSurvey,
    questions,
    resetResponseState,
    responses,
    sessionId,
    setCurrentResponseId,
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
      <div className="flex min-h-screen items-center justify-center bg-gray-50">
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
      <div className="flex min-h-screen items-center justify-center bg-gray-50">
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
      <div className="flex min-h-screen items-center justify-center bg-gray-50">
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
      <div className="flex min-h-screen items-center justify-center bg-gray-50">
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
            <Button onClick={() => router.push('/')} className="mt-6">
              홈으로 돌아가기
            </Button>
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
      <div className="min-h-screen bg-gray-50">
      {/* 헤더 */}
      <div className="border-b border-gray-200 bg-white">
        <div className={`${containerMaxWidth} mx-auto px-4 py-4 transition-all duration-300 md:px-6`}>
          <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
            <div>
              <h1 className="text-lg font-semibold text-gray-900 md:text-xl">{loadedSurvey.title}</h1>
              {!isEmptyHtml(loadedSurvey.description) && (
                <p className="mt-1 text-sm text-gray-600">{loadedSurvey.description}</p>
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
              <div className="mt-1.5 flex items-center justify-between text-[11px] text-gray-400">
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
        className={`${containerMaxWidth} mx-auto px-4 py-6 transition-all duration-300 md:px-6 md:py-8 ${
          isMobile ? 'pb-28' : ''
        }`}
      >
        {resumeMessage && (
          <div
            role="status"
            className="mb-3 rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-700"
          >
            {resumeMessage}
          </div>
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
              titleHasMultipleLines ? 'text-base' : 'text-lg'
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
            <div
              className="prose prose-sm max-h-[40vh] max-w-none overflow-auto leading-relaxed text-[13px] text-gray-500 [&_p]:min-h-[1.5em] [&_p]:leading-relaxed [&_table]:my-2 [&_table]:min-w-full [&_table]:table-auto [&_table]:border-collapse [&_table]:border [&_table]:border-gray-200 [&_table_p]:m-0 [&_table_td]:border [&_table_td]:border-gray-200 [&_table_td]:px-3 [&_table_td]:py-1.5 [&_table_th]:border [&_table_th]:border-gray-200 [&_table_th]:bg-gray-50 [&_table_th]:px-3 [&_table_th]:py-1.5 [&_table_th]:font-semibold"
              style={{ WebkitOverflowScrolling: 'touch' }}
              dangerouslySetInnerHTML={{ __html: descriptionHtml }}
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
                  <div
                    className="prose prose-base mt-3 max-h-[60vh] max-w-none overflow-auto text-base text-gray-600 [&_p]:min-h-[1.6em] [&_table]:my-2 [&_table]:min-w-full [&_table]:table-auto [&_table]:border-collapse [&_table]:border [&_table]:border-gray-200 [&_table_p]:m-0 [&_table_td]:border [&_table_td]:border-gray-200 [&_table_td]:px-4 [&_table_td]:py-2 [&_table_th]:border [&_table_th]:border-gray-200 [&_table_th]:bg-gray-50 [&_table_th]:px-4 [&_table_th]:py-2 [&_table_th]:font-semibold"
                    style={{ WebkitOverflowScrolling: 'touch' }}
                    dangerouslySetInnerHTML={{ __html: descriptionHtml }}
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
        <h3 className="mb-3 text-xs font-semibold tracking-[0.12em] text-gray-500 uppercase">
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
            className={`mt-0.5 flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full text-xs font-semibold tabular-nums ${
              isHighlighted ? 'bg-red-100 text-red-600' : 'bg-blue-100 text-blue-600'
            }`}
          >
            {itemIndex}
          </span>
          <label
            htmlFor={`q-${q.id}`}
            className={`text-base leading-snug font-semibold break-keep md:text-lg ${
              isHighlighted ? 'text-red-700' : 'text-gray-900'
            }`}
          >
            {titleText}
            {q.required && (
              <span className="ml-1 text-red-500" aria-label="필수 질문">
                *
              </span>
            )}
          </label>
        </div>
        {!isEmptyHtml(q.description) && (
          <div
            className="prose prose-sm ml-3 max-w-none text-xs text-gray-500 [&_p]:min-h-[1.3em] [&_table]:my-1.5 [&_table]:min-w-full [&_table]:table-auto [&_table]:border-collapse [&_table]:border [&_table]:border-gray-200 [&_table_p]:m-0 [&_table_td]:border [&_table_td]:border-gray-200 [&_table_td]:px-2.5 [&_table_td]:py-1 [&_table_th]:border [&_table_th]:border-gray-200 [&_table_th]:bg-gray-50 [&_table_th]:px-2.5 [&_table_th]:py-1 [&_table_th]:font-semibold"
            dangerouslySetInnerHTML={{ __html: descriptionHtml }}
          />
        )}
        <div id={`q-${q.id}`} className="mt-2 ml-3">
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
