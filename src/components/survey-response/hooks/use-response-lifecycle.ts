import { useCallback, useState } from 'react';
import type { Dispatch, RefObject, SetStateAction } from 'react';

import { toast } from 'sonner';

import { client } from '@/shared/lib/rpc';
import { findStepIndexOfQuestion, stepIdOf, type RenderStep } from '@/lib/group-ordering';
import type { ClientSignals } from '@/lib/duplicate-detection/types';
import { collectNumericIssues } from '@/lib/survey/numeric-validation';
import type { Question, QuestionGroup, Survey } from '@/types/survey';
import type { BranchEvalCtx } from '@/utils/branch-logic';
import {
  collectTraversedQuestionIds,
  shouldDisplayDynamicGroup,
  shouldDisplayRow,
} from '@/utils/branch-logic';
import type { SaveAdminEditPayload } from '@/features/survey-response/domain/response-edit';
import type { TestAttemptIdentity } from '@/shared/types/test-attempt';

import { sessionStorageKey } from './session-helpers';
import {
  handleInvalidTestLinkMutationError,
  handlePausedMutationError,
  type DuplicateStatus,
} from './use-duplicate-guard';

type ResponsesMap = Record<string, unknown>;

// DuplicateStatus 타입은 use-duplicate-guard 가 소유한다(진입 시 중복검사의 주 소유자).
// handleResponse/handleSubmit 가 blocked 로 set 하므로 여기서 re-export 해 기존 import 경로를 유지한다.
export type { DuplicateStatus };

/**
 * survey-response-flow.tsx 의 admin-edit 전용 컨텍스트. handleSubmit 의 admin-edit 분기에서 소비.
 * 컴포넌트 props 의 adminContext 와 동일 구조 (값만 전달).
 */
interface AdminContext {
  responseId: string;
  surveyId: string;
  initialResponses: ResponsesMap;
  versionSnapshot: unknown;
  initialContactAttrs: Record<string, string>;
  onSubmit: (payload: SaveAdminEditPayload) => Promise<void>;
}

interface UseResponseLifecycleArgs {
  // 모드/식별
  isAdminEdit: boolean;
  isPreview?: boolean;
  adminContext: AdminContext | undefined;
  inviteToken: string | null;
  /** ?test=<token>. isTestSession 일 때만 create/complete 게이트로 전달해 isTest 로 기록시킨다. */
  testToken: string | null;
  /** control.testSession==='valid'. 유효 테스트 세션이면 중단 게이트를 우회한다. */
  isTestSession: boolean;
  /** 대상자 테스트에서만 존재하는 현재 화면의 안정적인 attempt/session 식별자. */
  testIdentity: TestAttemptIdentity | null;
  /** 이 화면의 attempt가 첫 실제 입력으로 서버 쓰기 소유권을 얻었는지 여부. */
  hasTestAttemptOwnership: boolean;
  setHasTestAttemptOwnership: Dispatch<SetStateAction<boolean>>;

  // 설문/스텝 파생값
  loadedSurvey: Survey | null;
  currentStep: RenderStep | undefined;
  currentStepIndex: number;
  steps: RenderStep[];
  questions: Question[];
  groups: QuestionGroup[];
  visibleQuestions: Question[];
  evalCtx: BranchEvalCtx;

  // 응답 상태 (컴포넌트 소유)
  responses: ResponsesMap;
  setResponses: Dispatch<SetStateAction<ResponsesMap>>;

  // 세션/버전/신호
  sessionId: string;
  versionId: string | null;
  signals: ClientSignals | null;
  // 봇 방어 허니팟 입력 ref — create 시점에 .value 를 읽어 서버로 전달(봇이 채우면 차단).
  honeypotRef: RefObject<HTMLInputElement | null>;

  // 응답 스토어 액션 (컴포넌트 소유)
  currentResponseId: string | null;
  setCurrentResponseId: (id: string) => void;
  setPendingResponse: (questionId: string, value: unknown) => void;
  resetResponseState: () => void;

  // 회복 가드 (use-session-recovery 소유)
  isRecovering: boolean;

  // 검증 파생값 (컴포넌트 소유)
  isQuestionAnswered: (question: Question) => boolean;

  // 진척 미러 ref + UI 세터 (컴포넌트 소유)
  visibleProgressRef: RefObject<{ index: number; total: number }>;
  setHighlightQuestionIds: Dispatch<SetStateAction<Set<string>>>;
  setDuplicateStatus: Dispatch<SetStateAction<DuplicateStatus>>;
  /** 세션 도중 중단 감지 시 재조회한 최신 중단 문구 승격용 (handlePausedMutationError 로 전달). */
  setPausedMessage?: Dispatch<SetStateAction<string | null>>;
  setInviteIsInvalid: Dispatch<SetStateAction<boolean>>;
  setIsSubmitting: Dispatch<SetStateAction<boolean>>;
  setCurrentStepIndex: Dispatch<SetStateAction<number>>;
  setIsCompleted: Dispatch<SetStateAction<boolean>>;
  /** 숫자 차단형 검증 위반 시 에러를 표시할 step index (컴포넌트 소유). */
  setNumericErrorStepIndex: (idx: number | null) => void;

  // 제출 직전 옵션 텍스트 사이드카 병합 (module-level helper 를 컴포넌트에서 주입)
  buildOptTextsPayload: (
    visibleQuestions: Question[],
    responses: ResponsesMap,
  ) => Record<string, unknown>;
}

interface UseResponseLifecycleResult {
  handleResponse: (questionId: string, value: unknown) => void;
  handleSubmit: () => Promise<void>;
  /** 첫 답변 동시 발사 시 중복 INSERT 방어용 플래그. 이 훅이 소유. */
  isCreatingResponse: boolean;
}

/**
 * 응답 쓰기 경로(handleResponse / handleSubmit) 추출 훅.
 *
 * survey-response-flow.tsx 의 두 useCallback + isCreatingResponse state 를 라인 단위 그대로 이관했다.
 * 응답 손실은 실제 사용자 피해이므로 동작 보존이 절대적이다 — 가드/fallback/complete/에러/deps 를 1:1 유지한다.
 *
 * 동작 보존 핵심:
 * - isCreatingResponse 는 이 두 콜백 전용이라 훅이 소유하고 반환한다 (원본도 동일 용도).
 * - handleResponse INSERT 발사 가드(currentResponseId === null && !isCreatingResponse && !isRecovering(I-1)
 *   && loadedSurvey && currentStep && !isAdminEdit) 와 .then/.catch/.finally 순서, 멱등 키(surveyId, sessionId)
 *   를 그대로 둔다. deps 배열도 원본과 1:1 동일.
 * - handleSubmit 의 미응답 필수 하이라이트 분기, admin-edit 위임 분기(6/8), currentResponseId === null
 *   blank fallback INSERT 분기, exposedRowIds 동적 행 계산, complete() 페이로드, try/catch/finally,
 *   localStorage set/remove 타이밍을 라인 단위 그대로 둔다. deps 배열도 원본과 1:1 동일.
 * - isQuestionRequired(= question.required)는 원본에서 비메모 인라인 함수라 deps 에 없으므로
 *   여기서도 module-level 동등 함수로 두고 deps 에 넣지 않는다 (참조 안정성/의미론 동일).
 */
export function useResponseLifecycle({
  isAdminEdit,
  isPreview = false,
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
  setPausedMessage,
  setInviteIsInvalid,
  setIsSubmitting,
  setCurrentStepIndex,
  setIsCompleted,
  setNumericErrorStepIndex,
  buildOptTextsPayload,
}: UseResponseLifecycleArgs): UseResponseLifecycleResult {
  // INSERT 진행 중인지 추적 (첫 답변 동시 발사 시 중복 INSERT 방어).
  // ref가 아닌 state라도 OK — `handleResponse` 클로저에서 캡처되는 시점이 한 번이면 충분.
  const [isCreatingResponse, setIsCreatingResponse] = useState(false);

  const clearInvalidTargetTestSession = () => {
    if (!testIdentity) return;
    if (typeof window !== 'undefined' && loadedSurvey) {
      window.localStorage.removeItem(sessionStorageKey(loadedSurvey.id, inviteToken));
    }
    resetResponseState();
    setResponses({});
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
        !isPreview &&
        (currentResponseId === null || (testIdentity !== null && !hasTestAttemptOwnership)) &&
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
          sessionId: testIdentity?.sessionId ?? sessionId,
          versionId: versionId ?? null,
          questionId,
          value,
          currentStepId: stepIdOf(currentStep),
          visibleStepIndex: visibleProgressRef.current.index,
          visibleStepTotal: visibleProgressRef.current.total,
          ...(inviteToken != null ? { inviteToken } : {}),
          ...(isTestSession && testToken != null ? { testToken } : {}),
          ...(testIdentity?.attemptId ? { attemptId: testIdentity.attemptId } : {}),
          clientSignals: signals,
          ...(honeypotRef.current?.value ? { honeypot: honeypotRef.current.value } : {}),
        })
          .then((result) => {
            if (result.kind === 'blocked') {
              if (result.reason === 'invalid_test_token') clearInvalidTargetTestSession();
              setDuplicateStatus({ kind: 'blocked', reason: result.reason });
              return;
            }
            const { id, contactTargetId } = result;
            setCurrentResponseId(id);
            if (testIdentity) setHasTestAttemptOwnership(true);
            // invite 토큰이 있었는데 contactTargetId 매칭 실패 → 무효 토큰. 익명 응답으로 폴백 알림.
            if (inviteToken && !contactTargetId) {
              setInviteIsInvalid(true);
            }
            // 회복용 sessionId localStorage 저장 — 같은 브라우저에서 재진입 시 resumeOrCreate가 이 키로 row 조회
            if (typeof window !== 'undefined' && loadedSurvey) {
              window.localStorage.setItem(
                sessionStorageKey(loadedSurvey.id, inviteToken),
                sessionId,
              );
            }
          })
          .catch(async (err) => {
            if (
              await handleInvalidTestLinkMutationError({
                err,
                surveyId: loadedSurvey?.id,
                inviteToken,
                isTargetTestSession: testIdentity !== null,
                setDuplicateStatus,
                onInvalid: clearInvalidTargetTestSession,
              })
            ) {
              return;
            }
            // 첫 답변 직전에 설문이 중단된 경우 → 중단 화면으로 전환 (공통 헬퍼).
            if (
              await handlePausedMutationError({
                err,
                surveyId: loadedSurvey?.id,
                testToken,
                isTestSession,
                setDuplicateStatus,
                setPausedMessage,
              })
            ) {
              return;
            }
            console.error('응답 시작 오류:', err);
          })
          .finally(() => {
            setIsCreatingResponse(false);
          });
      }
    },
    // deps 는 원본 컴포넌트의 handleResponse useCallback 과 1:1 동일.
    // signals 는 원본에서도 의도적으로 제외돼 있었다(첫 답변 시점의 최신 신호를 클로저로 읽는 의미론).
    // 추출로 안정 세터/ref(setResponses/setHighlightQuestionIds/setDuplicateStatus/setInviteIsInvalid/
    // visibleProgressRef)가 props 가 되며 exhaustive-deps 가 추가로 경고하지만, 모두 안정 참조라 런타임 동작 불변.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      setPendingResponse,
      currentResponseId,
      isCreatingResponse,
      isRecovering,
      isAdminEdit,
      isPreview,
      loadedSurvey,
      currentStep,
      sessionId,
      versionId,
      setCurrentResponseId,
      inviteToken,
      testToken,
      isTestSession,
      testIdentity,
      hasTestAttemptOwnership,
    ],
  );

  const handleSubmit = useCallback(async () => {
    setIsSubmitting(true);

    try {
      // 분기 규칙(end/전진 goto)으로 건너뛴 스텝의 질문은 displayCondition 상 표시
      // 가능해도 응답자가 도달할 수 없다 — 실제 경로를 시뮬레이션해 그 안의 질문만
      // 검증한다 (traversed ⊆ displayable 이므로 별도 표시 조건 재확인 불필요).
      const traversedIds = collectTraversedQuestionIds(
        steps,
        responses,
        questions,
        groups,
        evalCtx,
      );
      const unansweredRequired = questions.filter((q) => {
        if (!traversedIds.has(q.id)) return false;
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
        const targetIdx = findStepIndexOfQuestion(steps, firstId);
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

      // 숫자 차단형 검증 — 실제 경로상 질문 전체 대상
      const numericViolated = questions.filter((q) => {
        if (!traversedIds.has(q.id)) return false;
        return (
          collectNumericIssues(q, responses[q.id], {
            allResponses: responses,
            allQuestions: questions,
          }).length > 0
        );
      });
      if (numericViolated.length > 0) {
        const firstId = numericViolated[0]!.id;
        const targetIdx = findStepIndexOfQuestion(steps, firstId);
        if (targetIdx !== -1) setNumericErrorStepIndex(targetIdx);
        // 다른 step 이면 그 step 으로 전환(상단 스크롤). 같은 step 이면 배너만 —
        // 위반 셀 이동은 배너의 "위치로 이동" 버튼이 담당.
        if (targetIdx !== -1 && targetIdx !== currentStepIndex) {
          setCurrentStepIndex(targetIdx);
          window.scrollTo({ top: 0, behavior: 'smooth' });
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

      if (isPreview) {
        resetResponseState();
        setIsCompleted(true);
        return;
      }

      // currentResponseId === null fallback —
      // notice-only / optional-only / 분기로 visible 질문 0 인 설문은
      // handleResponse 가 한 번도 트리거되지 않아 응답 row 가 만들어지지 않는다.
      // 그 상태로 제출이 통과하면 silent data loss 가 되므로 여기서 빈 응답을 INSERT 한다.
      let effectiveResponseId = currentResponseId;
      if (
        (!effectiveResponseId || (testIdentity !== null && !hasTestAttemptOwnership)) &&
        loadedSurvey &&
        currentStep
      ) {
        try {
          // signalsRef.current 가 null 이면 그대로 전달 — server action 이 신호 기반 검사 skip
          const created = await client.surveyResponse.response.createBlank({
            surveyId: loadedSurvey.id,
            sessionId: testIdentity?.sessionId ?? sessionId,
            versionId: versionId ?? null,
            currentStepId: stepIdOf(currentStep),
            ...(inviteToken != null ? { inviteToken } : {}),
            ...(isTestSession && testToken != null ? { testToken } : {}),
            ...(testIdentity?.attemptId ? { attemptId: testIdentity.attemptId } : {}),
            clientSignals: signals,
            ...(honeypotRef.current?.value ? { honeypot: honeypotRef.current.value } : {}),
          });
          if (created.kind === 'blocked') {
            if (created.reason === 'invalid_test_token') clearInvalidTargetTestSession();
            setDuplicateStatus({ kind: 'blocked', reason: created.reason });
            setIsSubmitting(false);
            return;
          } else {
            effectiveResponseId = created.id;
            setCurrentResponseId(created.id);
            if (testIdentity) setHasTestAttemptOwnership(true);
            if (inviteToken && !created.contactTargetId) {
              setInviteIsInvalid(true);
            }
            if (typeof window !== 'undefined') {
              window.localStorage.setItem(
                sessionStorageKey(loadedSurvey.id, inviteToken),
                sessionId,
              );
            }
          }
        } catch (err) {
          console.error('빈 응답 생성 오류:', err);
          // 빈 응답 INSERT 실패를 삼키면 effectiveResponseId 가 없는 채로 흐름이 진행돼
          // complete() 를 건너뛰고도 resetResponseState()+setIsCompleted(true) 가 실행되어
          // 응답이 저장되지 않았는데 완료 화면이 뜨는 silent data loss 가 된다.
          // 바깥 try/catch 로 전파해 에러 토스트만 띄우고 완료 처리를 막는다.
          throw err;
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
          ...(testIdentity ?? {}),
        });

        // 제출 성공 — 회복용 localStorage 키 정리 (재진입 시 새 응답 흐름)
        if (typeof window !== 'undefined' && loadedSurvey) {
          window.localStorage.removeItem(sessionStorageKey(loadedSurvey.id, inviteToken));
        }
      }

      resetResponseState();
      setIsCompleted(true);
    } catch (error) {
      if (
        await handleInvalidTestLinkMutationError({
          err: error,
          surveyId: loadedSurvey?.id,
          inviteToken,
          isTargetTestSession: testIdentity !== null,
          setDuplicateStatus,
          onInvalid: clearInvalidTargetTestSession,
        })
      ) {
        return;
      }
      // 세션 도중 설문이 중단된 경우(blank INSERT 또는 complete 가 survey_paused throw)
      // → 일반 에러 토스트 대신 중단 화면으로 전환 (공통 헬퍼). finally 가 isSubmitting 을 해제한다.
      if (
        await handlePausedMutationError({
          err: error,
          surveyId: loadedSurvey?.id,
          testToken,
          isTestSession,
          setDuplicateStatus,
          setPausedMessage,
        })
      ) {
        return;
      }
      console.error('응답 제출 오류:', error);
      toast.error('응답 제출 중 오류가 발생했습니다. 다시 시도해주세요.');
    } finally {
      setIsSubmitting(false);
    }
    // deps 는 원본 컴포넌트의 handleSubmit useCallback 과 1:1 동일.
    // 추출로 안정 세터(setHighlightQuestionIds/setCurrentStepIndex/setIsSubmitting/setIsCompleted/
    // setDuplicateStatus/setInviteIsInvalid)와 buildOptTextsPayload(module-level helper)가 props 가 되며
    // exhaustive-deps 가 추가로 경고하지만, 모두 안정 참조라 런타임 동작 불변.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    adminContext,
    currentResponseId,
    currentStep,
    currentStepIndex,
    evalCtx,
    groups,
    inviteToken,
    isAdminEdit,
    isPreview,
    isQuestionAnswered,
    loadedSurvey,
    questions,
    resetResponseState,
    responses,
    sessionId,
    setCurrentResponseId,
    setNumericErrorStepIndex,
    signals,
    steps,
    versionId,
    visibleQuestions,
    testToken,
    isTestSession,
    testIdentity,
    hasTestAttemptOwnership,
  ]);

  return { handleResponse, handleSubmit, isCreatingResponse };
}

// 타입별 응답 충족 판정과 무관한 단순 필수 여부. 원본 컴포넌트의 비메모 인라인 함수와 동등.
// deps 에 포함되지 않던 함수이므로 module-level 로 둬 참조 안정성을 유지한다.
function isQuestionRequired(question: Question): boolean {
  return question.required;
}
