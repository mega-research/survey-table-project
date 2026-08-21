import { useCallback, useEffect, useRef } from 'react';
import type { Dispatch, RefObject, SetStateAction } from 'react';

import { toast } from 'sonner';

import type { SaveAdminEditPayload } from '@/features/survey-response/lib/admin-edit';
import { resolveRebasedVersionId } from '@/features/survey-response/lib/version-rebase';
import type { ClientSignals } from '@/lib/duplicate-detection/types';
import { type RenderStep, findStepIndexOfQuestion, stepIdOf } from '@/utils/group-ordering';
import { isRelaxableRequiredIssueKind } from '@/features/survey-response/lib/admin-edit-required-relax';
import { type FormulaEvalCtx, withCalcValues } from '@/lib/survey/cell-formula';
import { collectNumericIssues } from '@/features/survey-response/lib/numeric-validation';
import { client } from '@/shared/lib/rpc';
import type { TestAttemptIdentity } from '@/shared/types/test-attempt';
import type { Question, QuestionGroup, Survey } from '@/types/survey';
import type { BranchEvalCtx } from '@/utils/branch-logic';
import {
  collectTraversedQuestionIds,
  shouldDisplayDynamicGroup,
  shouldDisplayRow,
} from '@/utils/branch-logic';

import { sendDraftBeacon, sessionStorageKey } from './session-helpers';
import {
  type DuplicateStatus,
  handleInvalidTestLinkMutationError,
  handlePausedMutationError,
} from './use-duplicate-guard';

type ResponsesMap = Record<string, unknown>;

/**
 * 미저장 답변의 안정적 지문. 키 순서에 흔들리지 않도록 정렬 후 직렬화한다.
 * 동일 내용으로 반복 발사되는 beacon 을 걸러내는 데 쓴다.
 */
function snapshotOfAnswers(answers: Record<string, unknown>): string {
  return JSON.stringify(
    Object.keys(answers)
      .sort()
      .map((key) => [key, answers[key]]),
  );
}

/**
 * 답변 입력 후 이 시간 동안 추가 입력이 없으면 백그라운드로 draft 를 저장한다 (trailing).
 * 타이핑 중에는 타이머가 계속 리셋되므로 발사 시점엔 항상 그 순간의 최신 값이 나간다.
 * 목표는 "다음" 클릭 시점에 pending 을 비워둬 전환이 서버 왕복 없이 즉시 일어나게 하는 것.
 *
 * 800ms 였을 때 표 문항(라디오 그리드)의 자연스러운 클릭 간격(1~2초)이 매 클릭을
 * saveDraft 1건으로 변환해 응답자 한 명이 분당 수십 건을 발사했다(8/10 리미터 사고).
 * 5초로 늘려 한 문항 안의 연속 입력을 한 요청으로 뭉친다. 입력이 계속 이어져 트레일링이
 * 영영 밀리는 경우를 대비해 MAX_WAIT 을 상한으로 둔다 — 어떤 입력 패턴에서도 세션당
 * 요청은 최대 12회/분(디바운스), 지속 입력 중에도 15초마다 1회 체크포인트가 보장된다.
 */
const DRAFT_AUTOSAVE_DEBOUNCE_MS = 5000;

/** 첫 미저장 입력 이후 이 시간이 지나면 입력이 계속돼도 draft 를 발사한다 (maxWait). */
const DRAFT_AUTOSAVE_MAX_WAIT_MS = 15000;

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
  /** 완료 화면 여부. 이탈 시점 draft beacon 게이트 전용 (다른 경로는 사용하지 않는다). */
  isCompleted?: boolean;
  /** 중복·쿼터·중단 등 terminal blocked 화면 여부. 이탈 시점 draft beacon 게이트 전용. */
  terminalBlocked?: boolean;
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
  /** calc 셀 수식 평가(LUT 참조)·저장 페이로드 주입용. survey-response-flow 의 formulaCtx 와 동일 소스(병합 전 원본). */
  contactAttrs: Record<string, string | undefined>;
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
  /**
   * 무중단 갈아타기(티켓 04) — create 결과의 versionId 가 알던 값과 다르면(서버 재핀) 호출된다.
   * 컴포넌트가 최신 스냅샷 재취득 + 구조 생존 필터 + 안내 문구 표시를 수행한다.
   */
  onVersionRebase?: (newVersionId: string) => void;
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
  /**
   * 이어하기 세션에서 서버가 응답 행에 마지막으로 적용한 draft seq(resume 응답의 draftSeq).
   * 매 페이지 로드마다 0 부터 다시 시작하는 draftSeqRef 를 이 값으로 올려, 2차 세션의 첫 flush
   * 가 1차 세션이 이미 적용한 seq 보다 낮아 stale 로 막히는 것을 방지한다. 값이 오르는 방향
   * (Math.max)으로만 반영되므로 회복 응답이 늦게 도착해도 이미 발급한 seq 를 되돌리지 않는다.
   */
  recoveredDraftSeq: number | undefined;

  // 검증 파생값 (컴포넌트 소유)
  isQuestionAnswered: (question: Question) => boolean;
  /** 질문별 유효 옵션 상세기입. 현재 편집값이 복구/관리자 저장값보다 우선한다. */
  optionTextsByQuestion?: Record<string, Record<string, string>>;

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
  /** 현재 페이지에서 바뀐 답을 저장한다. 첫 응답 생성 중이면 완료까지 기다린다. */
  flushPendingAnswers: () => Promise<boolean>;
  /**
   * 낙관 전환용 백그라운드 체크포인트 — 디바운스 자동 저장과 동일 의미론(실패 토스트 없음,
   * 실패 시 pending 유지). "다음" 클릭이 저장 왕복을 기다리지 않도록 발사만 한다.
   */
  flushPendingAnswersInBackground: () => Promise<boolean>;
  /**
   * 응답 행 id 확보 — 생성이 in-flight 면 완료를 기다린다. 낙관 전환으로 생성보다 먼저
   * 쿼터 판정 클릭에 도달했을 때 판정이 id 부재로 건너뛰어지는 것(하드 쿼터 우회)을 막는
   * 용도. 생성이 시작조차 안 됐으면 null.
   */
  waitForResponseId: () => Promise<string | null>;
  handleSubmit: () => Promise<void>;
}

/**
 * 응답 쓰기 경로(handleResponse / handleSubmit) 추출 훅.
 *
 * survey-response-flow.tsx 의 두 useCallback + 첫 답변 INSERT 가드를 라인 단위 그대로 이관했다.
 * 응답 손실은 실제 사용자 피해이므로 동작 보존이 절대적이다 — 가드/fallback/complete/에러/deps 를 1:1 유지한다.
 *
 * 동작 보존 핵심:
 * - 첫 답변 INSERT 가드는 이 두 콜백 전용이라 훅이 소유한다. 렌더 소비자가 없어 state 가 아니라
 *   동기 ref(isCreatingResponseRef)다 — 같은 커밋에서 발사된 두 호출도 즉시 막는다.
 * - handleResponse INSERT 발사 가드(currentResponseId === null && !isCreatingResponseRef.current && !isRecovering(I-1)
 *   && loadedSurvey && currentStep && !isAdminEdit) 와 .then/.catch/.finally 순서, 멱등 키(surveyId, sessionId)
 *   를 유지한다. 페이지 이동 전 flushPendingAnswers가 생성 완료를 기다린 뒤 변경 답을 저장한다.
 * - handleSubmit 의 미응답 필수 하이라이트 분기, admin-edit 위임 분기(6/8), currentResponseId === null
 *   blank fallback INSERT 분기, exposedRowIds 동적 행 계산, complete() 페이로드, try/catch/finally,
 *   localStorage set/remove 타이밍을 라인 단위 그대로 둔다. deps 배열도 원본과 1:1 동일.
 * - isQuestionRequired(= question.required)는 원본에서 비메모 인라인 함수라 deps 에 없으므로
 *   여기서도 module-level 동등 함수로 두고 deps 에 넣지 않는다 (참조 안정성/의미론 동일).
 */
export function useResponseLifecycle({
  isAdminEdit,
  isPreview = false,
  isCompleted = false,
  terminalBlocked = false,
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
  onVersionRebase,
  signals,
  honeypotRef,
  currentResponseId,
  setCurrentResponseId,
  setPendingResponse,
  resetResponseState,
  isRecovering,
  recoveredDraftSeq,
  isQuestionAnswered,
  optionTextsByQuestion = {},
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
  // state 로는 가드가 되지 않는다 — 같은 커밋에서 발사된 두 호출은 같은 클로저를 쓰므로
  // 둘 다 stale false 를 읽는다(한 페이지에 prefill 단답형이 2개면 두 mount effect 가
  // 그 형태로 handleResponse 를 두 번 부른다. StrictMode 이중 이펙트도 동형).
  // ref 는 동기 기록되어 같은 틱에서도 즉시 반영된다 — use-survey-sync 의 savingRef 와 같은 패턴.
  const isCreatingResponseRef = useRef(false);
  // 첫 답변 INSERT가 끝나기 전에 들어온 후속 답을 유실하지 않도록 응답 ID와 대기 답을 ref로 보관한다.
  const activeResponseIdRef = useRef<string | null>(currentResponseId);
  const pendingAnswerSavesRef = useRef(new Map<string, unknown>());
  // 직전 beacon 으로 보낸 미저장 답변의 지문. 동일 내용 반복 발사를 막는다.
  // beacon 후에도 pending 을 비우지 않기 때문에(전송 성공 확인 불가) 이 가드가 필요하다.
  const lastBeaconSnapshotRef = useRef<string | null>(null);
  // draft 쓰기 순서 보장용 단조 증가 카운터.
  // "다음" flush 와 이탈 beacon 이 같은 카운터를 쓰므로, 지연 도착한 오래된 쓰기를
  // 서버가 식별해 무시할 수 있다.
  const draftSeqRef = useRef(0);
  const responseCreationPromiseRef = useRef<Promise<string | null> | null>(null);
  // 클라이언트 신호는 마운트 직후 비동기로 수집된다(useClientSignals). handleResponse 는
  // deps 가 하나도 안 바뀐 첫 페이지에서 발사될 수 있어 prop 클로저 캡처로는 마운트 시점
  // null 이 그대로 나간다 — 익명(비초대) 첫 답변이 서버 봇 가드(isLikelyBot)에
  // device_already_responded 로 오차단되는 원인(2026-08-11). ref 로 항상 최신 신호를 읽는다.
  const signalsRef = useRef(signals);
  useEffect(() => {
    signalsRef.current = signals;
  }, [signals]);
  // 이어하기 회복이 서버 draftSeq 를 늦게 내려줘도 seed 는 올리는 방향으로만 반영한다 —
  // 이미 발급한(더 큰) seq 를 되돌리면 오히려 그 자체가 stale 로 막힌다.
  useEffect(() => {
    if (recoveredDraftSeq === undefined) return;
    draftSeqRef.current = Math.max(draftSeqRef.current, recoveredDraftSeq);
  }, [recoveredDraftSeq]);
  useEffect(() => {
    if (currentResponseId) activeResponseIdRef.current = currentResponseId;
  }, [currentResponseId]);

  // 저장 경계(draft flush / complete / beacon / admin-edit)에서 calc 셀 값을 페이로드에 주입.
  // 4지점이 각자 ctx 를 조립하면 한 곳만 어긋나는 버그가 생기므로 클로저 하나로 공유한다.
  const injectCalc = useCallback(
    (answers: Record<string, unknown>) => {
      const ctx: FormulaEvalCtx = {
        questions,
        responses,
        lookups: loadedSurvey?.lookups ?? [],
        contactAttrs,
      };
      return withCalcValues(answers, ctx);
    },
    [questions, responses, loadedSurvey?.lookups, contactAttrs],
  );
  // beacon 은 visibilitychange/pagehide 리스너 안에서 이탈 시점에 호출된다. 리스너 재등록을
  // (isAdminEdit 등) 몇 개 값에만 묶어두려는 기존 설계를 유지하려면 questions/responses/
  // contactAttrs 변화마다 effect 를 재실행할 수 없다 — ref 로 최신 injectCalc 를 따라가게 한다.
  const injectCalcRef = useRef(injectCalc);
  useEffect(() => {
    injectCalcRef.current = injectCalc;
  }, [injectCalc]);

  const clearInvalidTargetTestSession = () => {
    if (!testIdentity) return;
    if (typeof window !== 'undefined' && loadedSurvey) {
      window.localStorage.removeItem(sessionStorageKey(loadedSurvey.id, inviteToken));
    }
    activeResponseIdRef.current = null;
    pendingAnswerSavesRef.current.clear();
    // 세션이 바뀌면 직전 지문은 다른 responseId 의 것이라 무효다.
    lastBeaconSnapshotRef.current = null;
    resetResponseState();
    setResponses({});
  };

  /**
   * 실제 flush 본체. 반드시 enqueueFlush 를 거쳐 호출된다 — 디바운스 발사와 "다음" 클릭
   * flush 가 동시에 나가면 seq 왕복만 낭비되므로 체인으로 직렬화한다.
   * background=true(디바운스 자동 저장)면 실패 시 토스트를 띄우지 않는다 — pending 이
   * 유지되므로 다음 클릭 flush·이탈 beacon·최종 complete 가 안전망으로 남는다.
   */
  const runFlushPendingAnswers = async (background: boolean): Promise<boolean> => {
    if (isAdminEdit || isPreview || pendingAnswerSavesRef.current.size === 0) return true;
    // 완료·차단 전환 직후 늦게 발사된 백그라운드 저장은 스킵한다 (서버는 in_progress 행만 갱신).
    if (background && (isCompleted || terminalBlocked)) return true;

    const responseId = activeResponseIdRef.current ?? (await responseCreationPromiseRef.current);
    if (!responseId) {
      const hasOnlyRootSidecars = [...pendingAnswerSavesRef.current.keys()].every((key) =>
        key.startsWith('__'),
      );
      // 루트 사이드카만 바뀐 선택적 문항은 아직 실제 질문 답변이 없으므로 응답 행을
      // 만들지 않는다. 로컬 pending은 유지해 이후 실제 첫 답변 또는 최종 complete에 합친다.
      return hasOnlyRootSidecars;
    }

    // rawSnapshot: pending 맵의 원본 스냅샷(참조 동일성 비교용, 아래 삭제 루프 전용).
    // pendingSnapshot: 서버로 실제 전송하는 값 — calc 셀을 가진 질문은 raw 스냅샷에 없어도
    // withCalcValues 가 ctx.responses 와 병합해 포함시킨다(항상 최신 계산값 재주입).
    // 삭제 루프는 반드시 rawSnapshot 기준으로 비교해야 한다 — injectCalc 는 calc 를 가진
    // 모든 질문에 대해 매번 새 객체를 만들어내므로, pendingSnapshot 기준으로 비교하면
    // Object.is 가 항상 실패해 calc 테이블 질문의 pending 항목이 영영 삭제되지 않는다.
    const rawSnapshot = Object.fromEntries(pendingAnswerSavesRef.current);
    const pendingSnapshot = injectCalc(rawSnapshot);
    try {
      const result = await client.surveyResponse.response.saveDraft({
        responseId,
        answers: pendingSnapshot,
        seq: ++draftSeqRef.current,
        ...(testIdentity ?? {}),
      });
      if (result.concluded) {
        // 이 응답은 이미 (다른 화면에서) 완료됐다 — 조용한 실패로 끝까지 진행시키는 대신
        // "이미 완료된 설문입니다" 안내로 접는다 (동시 세션 정책 G1). pending 은 어떤
        // 재시도로도 적용될 수 없으므로 비워 이탈 beacon 재발사도 멈춘다.
        pendingAnswerSavesRef.current.clear();
        setDuplicateStatus({ kind: 'blocked', reason: 'response_concluded' });
        return false;
      }
      if (!result.applied) {
        // 서버가 stale seq 로 판정해 답변을 쓰지 않았다. pending 을 비우면 서버에 반영되지
        // 않은 값을 "저장됨" 으로 착각해 유실하므로, 삭제 루프와 지문 초기화를 모두 건너뛴다.
        // 다음 재시도는 더 큰 seq 로 나가 통과한다.
        console.error('응답 임시 저장 오류: 서버가 stale seq 로 판정해 적용하지 않음');
        if (!background) {
          toast.error('응답 임시 저장에 실패했습니다. 잠시 후 다시 시도해주세요.');
        }
        return false;
      }
      for (const [questionId, savedValue] of Object.entries(rawSnapshot)) {
        if (Object.is(pendingAnswerSavesRef.current.get(questionId), savedValue)) {
          pendingAnswerSavesRef.current.delete(questionId);
        }
      }
      // flush 성공 후 dedupe 캐시 무효화.
      // 잔여 pending 은 서버에 없는 값이므로 다음 이탈 시점에 반드시 발사돼야 한다.
      lastBeaconSnapshotRef.current = null;
      return true;
    } catch (err) {
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
        return false;
      }
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
        return false;
      }
      console.error('응답 임시 저장 오류:', err);
      if (!background) {
        toast.error('응답 임시 저장에 실패했습니다. 잠시 후 다시 시도해주세요.');
      }
      return false;
    }
  };

  // 타이머 콜백이 예약 시점 렌더의 stale 클로저(isCompleted 등)를 잡지 않도록
  // 최신 본체를 ref 로 따라간다 (injectCalcRef 와 같은 패턴).
  const runFlushRef = useRef(runFlushPendingAnswers);
  useEffect(() => {
    runFlushRef.current = runFlushPendingAnswers;
  });

  // flush 직렬화 체인. 이전 flush 가 in-flight 면 완료를 기다렸다가 잔여 pending 만 이어 보낸다.
  const flushChainRef = useRef<Promise<unknown>>(Promise.resolve());
  const enqueueFlush = (background: boolean): Promise<boolean> => {
    const run = flushChainRef.current.then(() => runFlushRef.current(background));
    // runFlush 는 모든 에러를 내부에서 잡아 boolean 을 반환하지만, 체인 자체는 방어적으로
    // 실패를 삼켜 후속 flush 가 영구히 막히지 않게 한다.
    flushChainRef.current = run.catch(() => false);
    return run;
  };

  const flushPendingAnswers = (): Promise<boolean> => enqueueFlush(false);
  const flushPendingAnswersInBackground = (): Promise<boolean> => enqueueFlush(true);
  const waitForResponseId = async (): Promise<string | null> =>
    activeResponseIdRef.current ?? (await responseCreationPromiseRef.current) ?? null;

  // 답변 입력 디바운스 자동 저장 타이머. 리셋은 clearTimeout + 재예약이라 동시 타이머는 항상 1개.
  const draftAutosaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // maxWait 마감 시각. 저장이 한 번도 안 나간 미저장 입력 구간의 시작 + MAX_WAIT.
  // 발사(또는 의도적 취소) 시 null 로 돌아가 다음 입력 구간에서 새로 시작한다.
  const draftAutosaveDeadlineRef = useRef<number | null>(null);
  const clearDraftAutosave = () => {
    if (draftAutosaveTimerRef.current !== null) {
      clearTimeout(draftAutosaveTimerRef.current);
      draftAutosaveTimerRef.current = null;
    }
    draftAutosaveDeadlineRef.current = null;
  };
  const scheduleDraftAutosave = () => {
    if (isAdminEdit || isPreview) return;
    // 재예약 시 타이머만 리셋한다 — 마감(deadline)까지 리셋하면 입력이 이어지는 동안
    // maxWait 이 함께 밀려 상한이 무의미해진다.
    if (draftAutosaveTimerRef.current !== null) {
      clearTimeout(draftAutosaveTimerRef.current);
      draftAutosaveTimerRef.current = null;
    }
    const now = Date.now();
    if (draftAutosaveDeadlineRef.current === null) {
      draftAutosaveDeadlineRef.current = now + DRAFT_AUTOSAVE_MAX_WAIT_MS;
    }
    const delay = Math.max(
      0,
      Math.min(DRAFT_AUTOSAVE_DEBOUNCE_MS, draftAutosaveDeadlineRef.current - now),
    );
    draftAutosaveTimerRef.current = setTimeout(() => {
      draftAutosaveTimerRef.current = null;
      draftAutosaveDeadlineRef.current = null;
      void enqueueFlush(true);
    }, delay);
  };

  // 언마운트 시 예약된 백그라운드 저장 취소 — 화면을 떠난 뒤의 유령 saveDraft 를 막는다.
  useEffect(
    () => () => {
      if (draftAutosaveTimerRef.current !== null) {
        clearTimeout(draftAutosaveTimerRef.current);
      }
    },
    [],
  );

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

      pendingAnswerSavesRef.current.set(questionId, value);
      // 입력이 잦아들면 백그라운드로 체크포인트 저장 — "다음" 클릭 시 대기 왕복을 없앤다.
      scheduleDraftAutosave();

      // 운영 현황 콘솔(T5): 첫 답변 시점에 응답 행을 INSERT.
      // - currentResponseId가 null & 진행 중 INSERT가 없을 때만 트리거
      // - createResponseWithFirstAnswer는 (surveyId, sessionId) 멱등 — 더블 클릭 방어
      // - 후속 답변은 별도 DB 쓰기 없음 (제출 시 completeResponse가 일괄 저장)
      // admin-edit 분기 (5/8) — 어드민 수정은 자동 저장 없음. 마지막 submit 시점에 일괄 갱신.
      if (
        !questionId.startsWith('__') &&
        !isAdminEdit &&
        !isPreview &&
        (currentResponseId === null || (testIdentity !== null && !hasTestAttemptOwnership)) &&
        !isCreatingResponseRef.current &&
        !isRecovering && // I-1 fix: 회복 진행 중에는 INSERT 발사 안 함
        loadedSurvey &&
        currentStep
      ) {
        isCreatingResponseRef.current = true;
        // signalsRef.current 가 null 이면 그대로 전달 — server action 이 신호 기반 검사 skip
        // (placeholder 신호로 hash 충돌 발생을 방지하기 위함)
        const creationRequest = client.surveyResponse.response.createWithFirstAnswer({
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
          clientSignals: signalsRef.current,
          ...(honeypotRef.current?.value ? { honeypot: honeypotRef.current.value } : {}),
        });
        const trackedCreation: Promise<string | null> = creationRequest
          .then((result) => {
            if (result.kind === 'blocked') {
              if (result.reason === 'invalid_test_token') clearInvalidTargetTestSession();
              setDuplicateStatus({ kind: 'blocked', reason: result.reason });
              return null;
            }
            const { id, contactTargetId } = result;
            // 무중단 갈아타기(티켓 04): 서버가 구버전 versionId 를 현재 버전으로 재핀했으면
            // 결과 versionId 가 알던 값과 다르다 — 최신 스냅샷 재취득을 트리거한다.
            const rebasedVersionId = resolveRebasedVersionId(result.versionId, versionId);
            if (rebasedVersionId && onVersionRebase) onVersionRebase(rebasedVersionId);
            activeResponseIdRef.current = id;
            // 컨택 재사용으로 기존 행을 물려받았을 수 있다(resume 이 호출되지 않는 경로 —
            // localStorage 없는 다른 기기·시크릿창 재진입). resume seed 와 동일 의미론으로
            // 올리는 방향으로만 반영한다.
            draftSeqRef.current = Math.max(draftSeqRef.current, result.draftSeq ?? 0);
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
            return id;
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
              return null;
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
              return null;
            }
            console.error('응답 시작 오류:', err);
            return null;
          })
          .finally(() => {
            if (responseCreationPromiseRef.current === trackedCreation) {
              responseCreationPromiseRef.current = null;
            }
            // 가드 해제는 이 finally 단 하나다 — 성공/blocked/reject/핸들러 내부 throw 를 모두
            // 지난다. 여기서 빠지면 이후 모든 입력이 응답 행을 만들지 못하고 영구 정지한다.
            isCreatingResponseRef.current = false;
          });
        responseCreationPromiseRef.current = trackedCreation;
      }
    },
    // deps 는 원본 컴포넌트의 handleResponse useCallback 과 1:1 동일하되, isCreatingResponse 만
    // 빠졌다 — 동기 ref 로 바뀌어 발사 시점에 .current 를 읽으므로 deps 대상이 아니다.
    // signals 는 deps 대상이 아니다 — 클로저 캡처가 아니라 signalsRef 로 발사 시점 최신값을 읽는다
    // (prop 캡처는 deps 미변경 첫 페이지에서 마운트 시점 null 이 그대로 나가는 스테일 클로저였다).
    // 추출로 안정 세터/ref(setResponses/setHighlightQuestionIds/setDuplicateStatus/setInviteIsInvalid/
    // visibleProgressRef)가 props 가 되며 exhaustive-deps 가 추가로 경고하지만, 모두 안정 참조라 런타임 동작 불변.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      setPendingResponse,
      currentResponseId,
      isRecovering,
      isAdminEdit,
      isPreview,
      loadedSurvey,
      currentStep,
      sessionId,
      versionId,
      onVersionRebase,
      setCurrentResponseId,
      inviteToken,
      testToken,
      isTestSession,
      testIdentity,
      hasTestAttemptOwnership,
    ],
  );

  /**
   * 이탈 시점 미저장 답변 flush.
   *
   * "다음" 클릭 시에만 saveDraft 가 나가므로, 현재 페이지에서 입력하다 탭을 닫거나
   * 백그라운드로 보내면 그 페이지분이 메모리에서 사라진다. hidden/pagehide 에서 beacon 으로
   * 넘겨 복원 기준을 마지막 입력까지 끌어올린다.
   *
   * pending 은 비우지 않는다 — sendBeacon 은 전송 성공을 반환하지 않아, 낙관적으로 비웠다가
   * 실패하면 사용자가 돌아와 "다음"을 눌러도 올릴 것이 없다. 대신 지문 비교로 중복을 막는다.
   *
   * 게이트는 use-response-telemetry 의 visibility effect 와 같은 기준이다. 종결·차단 화면은
   * 렌더 early-return 이라 훅은 계속 마운트돼 있으므로 값으로 막아야 한다.
   */
  useEffect(() => {
    if (isAdminEdit || isPreview || isCompleted || terminalBlocked) return;
    // 대상자 테스트는 쓰기 소유권을 얻기 전까지 서버에 흔적을 남기지 않는다.
    if (testIdentity !== null && !hasTestAttemptOwnership) return;

    const flushViaBeacon = () => {
      const responseId = activeResponseIdRef.current;
      if (!responseId) return;
      if (pendingAnswerSavesRef.current.size === 0) return;
      const answers = Object.fromEntries(pendingAnswerSavesRef.current);
      // 중복 발사 방지 지문은 raw 답변 기준(사용자가 실제로 바꾼 값)으로 유지한다 —
      // calc 주입은 매번 새 객체를 만들어내므로 지문에 넣으면 항상 새 지문이 되어 dedupe 가 무력화된다.
      const snapshot = snapshotOfAnswers(answers);
      if (snapshot === lastBeaconSnapshotRef.current) return;
      const attempt = sendDraftBeacon(
        responseId,
        injectCalcRef.current(answers),
        ++draftSeqRef.current,
        testIdentity,
      );
      // 낙관적으로 확정한다. 브라우저가 인수했으면 그대로 두고,
      // fetch 폴백이 실패로 확인되면 되돌려 다음 이탈 시점에 재시도되게 한다.
      lastBeaconSnapshotRef.current = snapshot;
      attempt.delivered?.then((ok) => {
        // 그 사이 더 새로운 beacon 이 지문을 갱신했으면 건드리지 않는다.
        if (!ok && lastBeaconSnapshotRef.current === snapshot) {
          lastBeaconSnapshotRef.current = null;
        }
      });
    };

    const onVisibility = () => {
      if (document.visibilityState === 'hidden') flushViaBeacon();
    };

    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', flushViaBeacon);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', flushViaBeacon);
    };
    // activeResponseIdRef / pendingAnswerSavesRef / lastBeaconSnapshotRef 는 이벤트 발생
    // 시점에 .current 를 읽으므로 deps 에 넣지 않는다 (리스너 재등록 불필요).
  }, [isAdminEdit, isPreview, isCompleted, terminalBlocked, testIdentity, hasTestAttemptOwnership]);

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
      // admin-edit(요구 5/6) — "빈 필수"는 이미 handleNext 가 페이지 단위로 경고 1회 후
      // 통과시켰으므로 여기서 다시 막지 않는다(응답자 흐름은 traversedIds 전체를 그대로
      // 검사 — 무변경). 이관으로 비워진 신규 필수 셀은 관리자가 값을 알 수 없어 채울
      // 수 없다(설계 결정 6) — 다른 스텝에 남아있어도 최종 저장을 막지 않는다.
      if (!isAdminEdit) {
        const unansweredRequired = questions.filter((q) => {
          if (!traversedIds.has(q.id)) return false;
          return isQuestionRequired(q) && !isQuestionAnswered(q);
        });

        if (unansweredRequired.length > 0) {
          // 첫 번째 미응답 필수 질문이 속한 step으로 이동
          const firstRequired = unansweredRequired[0];
          if (!firstRequired) return;
          const firstId = firstRequired.id;
          setHighlightQuestionIds(new Set([firstId]));
          const targetIdx = findStepIndexOfQuestion(steps, firstId);
          const hasBlockingDetailIssue = collectNumericIssues(firstRequired, responses[firstId], {
            allResponses: responses,
            allQuestions: questions,
            optionTexts: optionTextsByQuestion[firstId],
            lookups: loadedSurvey?.lookups ?? [],
            contactAttrs,
          }).some((issue) => issue.kind === 'required-detail' || issue.kind === 'required-cells');
          if (hasBlockingDetailIssue && targetIdx !== -1) {
            setNumericErrorStepIndex(targetIdx);
          }
          if (targetIdx !== -1 && targetIdx !== currentStepIndex) {
            // 상단 스크롤은 flow 의 스텝 변경 effect 가 커밋 이후에 일괄 처리한다.
            setCurrentStepIndex(targetIdx);
          } else {
            // 이미 해당 step이면 카드로 스크롤
            const el = document.querySelector<HTMLElement>(`[data-question-id="${firstId}"]`);
            el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
          }
          setIsSubmitting(false);
          return;
        }
      }

      // 숫자 차단형 검증 — 실제 경로상 질문 전체 대상.
      // admin-edit 은 값이 들어간 칸의 차단형 위반(range/sum/formula)만 다시 확인한다 —
      // "빈 필수"(required-cells/required-detail)는 위에서 이미 의도적으로 건너뛰었다.
      // 응답자 흐름은 collectNumericIssues 의 모든 kind 를 그대로 차단(무변경).
      const numericViolated = questions.filter((q) => {
        if (!traversedIds.has(q.id)) return false;
        const issues = collectNumericIssues(q, responses[q.id], {
          allResponses: responses,
          allQuestions: questions,
          optionTexts: optionTextsByQuestion[q.id],
          lookups: loadedSurvey?.lookups ?? [],
          contactAttrs,
        });
        return isAdminEdit
          ? issues.some((issue) => !isRelaxableRequiredIssueKind(issue.kind))
          : issues.length > 0;
      });
      if (numericViolated.length > 0) {
        const firstId = numericViolated[0]!.id;
        setHighlightQuestionIds(new Set([firstId]));
        const targetIdx = findStepIndexOfQuestion(steps, firstId);
        if (targetIdx !== -1) setNumericErrorStepIndex(targetIdx);
        // 다른 step 이면 그 step 으로 전환(상단 스크롤). 같은 step 이면 배너만 —
        // 위반 셀 이동은 배너의 "위치로 이동" 버튼이 담당.
        if (targetIdx !== -1 && targetIdx !== currentStepIndex) {
          // 상단 스크롤은 flow 의 스텝 변경 effect 가 커밋 이후에 일괄 처리한다.
          setCurrentStepIndex(targetIdx);
        }
        setIsSubmitting(false);
        return;
      }

      setHighlightQuestionIds(new Set());

      // 제출 확정 경로 진입 — 예약된 백그라운드 draft 저장은 취소한다.
      // complete 가 전체 답을 저장하므로 늦게 발사되면 완료된 행에 saveDraft 만 실패한다.
      clearDraftAutosave();

      // admin-edit 분기 (6/8) — 새 응답 INSERT 없이 onSubmit 으로 위임.
      if (isAdminEdit && adminContext) {
        // 옵션 텍스트(__optTexts__) 사이드카 — 응답자 흐름과 동일하게 합쳐서 보낸다.
        // calc 셀 값도 저장 경계에서 함께 주입한다(표시는 파생 계산이라 별도로 저장되지 않음).
        const questionResponses = injectCalc(buildOptTextsPayload(visibleQuestions, responses));

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
            visibleStepIndex: visibleProgressRef.current.index,
            visibleStepTotal: visibleProgressRef.current.total,
            ...(inviteToken != null ? { inviteToken } : {}),
            ...(isTestSession && testToken != null ? { testToken } : {}),
            ...(testIdentity?.attemptId ? { attemptId: testIdentity.attemptId } : {}),
            clientSignals: signalsRef.current,
            ...(honeypotRef.current?.value ? { honeypot: honeypotRef.current.value } : {}),
          });
          if (created.kind === 'blocked') {
            if (created.reason === 'invalid_test_token') clearInvalidTargetTestSession();
            setDuplicateStatus({ kind: 'blocked', reason: created.reason });
            setIsSubmitting(false);
            return;
          } else {
            // 무중단 갈아타기(티켓 04): blank INSERT 경로도 재핀 감지를 동일하게 처리한다.
            const rebasedVersionId = resolveRebasedVersionId(created.versionId, versionId);
            if (rebasedVersionId && onVersionRebase) onVersionRebase(rebasedVersionId);
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
            // 테이블 응답은 셀 id 키의 동적 객체 — 객체 여부를 좁힌 뒤 선택 행 id 를 꺼낸다
            const qResponseRaw = responses[q.id];
            const qResponse =
              typeof qResponseRaw === 'object' && qResponseRaw !== null
                ? (qResponseRaw as Record<string, unknown>)
                : undefined;
            const selectedDynamicIds = new Set<string>(
              (qResponse?.['__selectedRowIds'] as string[] | undefined) ?? [],
            );
            const enabledGroupIds = new Set(
              (q.dynamicRowConfigs ?? [])
                .filter(
                  (g) =>
                    g.enabled &&
                    shouldDisplayDynamicGroup(
                      g,
                      responses as Record<string, unknown>,
                      questions,
                      evalCtx,
                    ),
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

            return q
              .tableRowsData!.filter((row) => {
                if (
                  !shouldDisplayRow(row, responses as Record<string, unknown>, questions, evalCtx)
                )
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

        // 제출 직전 — 미선택 옵션의 텍스트 drop 후 questionResponses에 병합. calc 셀 값도 함께 주입.
        const questionResponsesWithTexts = injectCalc(
          buildOptTextsPayload(visibleQuestions, responses),
        );

        const completed = await client.surveyResponse.response.complete({
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

        if (completed?.alreadyCompleted) {
          // 이미 완료된 행에 대한 늦은 complete(다른 화면이 먼저 제출했거나 본인 재시도) —
          // 이번 페이로드는 서버가 버렸으므로 가짜 감사 화면 대신 안내로 접는다 (정책 G1).
          resetResponseState();
          setDuplicateStatus({ kind: 'blocked', reason: 'response_concluded' });
          return;
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
    // deps 는 원본 컴포넌트의 handleSubmit useCallback 과 1:1 동일 + contactAttrs(Task 7 추가).
    // 추출로 안정 세터(setHighlightQuestionIds/setCurrentStepIndex/setIsSubmitting/setIsCompleted/
    // setDuplicateStatus/setInviteIsInvalid)와 buildOptTextsPayload(module-level helper)가 props 가 되며
    // exhaustive-deps 가 추가로 경고하지만, 모두 안정 참조라 런타임 동작 불변.
    // contactAttrs 는 injectCalc/collectNumericIssues 의 LUT 검증 컨텍스트로 새로 쓰이므로 추가했다
    // (questions/responses/loadedSurvey 는 이미 아래 목록에 있어 injectCalc 의 나머지 의존성은 충족됨).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    contactAttrs,
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
    optionTextsByQuestion,
    loadedSurvey,
    questions,
    resetResponseState,
    responses,
    sessionId,
    setCurrentResponseId,
    setNumericErrorStepIndex,
    steps,
    versionId,
    onVersionRebase,
    visibleQuestions,
    testToken,
    isTestSession,
    testIdentity,
    hasTestAttemptOwnership,
  ]);

  return {
    handleResponse,
    flushPendingAnswers,
    flushPendingAnswersInBackground,
    waitForResponseId,
    handleSubmit,
  };
}

// 타입별 응답 충족 판정과 무관한 단순 필수 여부. 원본 컴포넌트의 비메모 인라인 함수와 동등.
// deps 에 포함되지 않던 함수이므로 module-level 로 둬 참조 안정성을 유지한다.
function isQuestionRequired(question: Question): boolean {
  return question.required;
}
