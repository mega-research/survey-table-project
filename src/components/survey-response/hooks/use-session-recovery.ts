import { useCallback, useEffect, useRef, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';

import { client } from '@/shared/lib/rpc';
import type { Survey } from '@/types/survey';

import { sendVisibilitySegment, sessionStorageKey } from './session-helpers';
import { handlePausedMutationError, type DuplicateStatus } from './use-duplicate-guard';

interface UseSessionRecoveryArgs {
  /** false면 완료 등 종료 화면에서 recovery를 시작하거나 결과를 적용하지 않는다. */
  enabled?: boolean;
  /** 무효 테스트 링크나 중복·쿼터 등 terminal blocked 화면 여부. */
  terminalBlocked?: boolean;
  isAdminEdit: boolean;
  isPreview?: boolean;
  loadedSurvey: Survey | null;
  currentResponseId: string | null;
  inviteToken: string | null;
  /** ?test=<token>. isTestSession 일 때만 resume 게이트로 전달해 중단 우회 + isTest 유지. */
  testToken: string | null;
  /** control.testSession==='valid'. 유효 테스트 세션이면 중단 게이트를 우회한다. */
  isTestSession: boolean;
  /** invite가 테스트 대상자를 가리키는 세션. GET resume는 읽기만 하고 쓰기 소유권을 얻지 않는다. */
  isTargetTestSession?: boolean;
  /** 이 페이지 마운트에서 만든 세션 식별자. target은 저장 key가 없어도 resume 조회에 사용한다. */
  sessionId?: string;
  /** 회복된 DB row 의 sessionId 로 컴포넌트 sessionId state 를 갱신 (소유권은 컴포넌트). */
  setSessionId: (sessionId: string) => void;
  /** 같은 버전 target in_progress 응답값 복원용. */
  setResponses?: Dispatch<SetStateAction<Record<string, unknown>>>;
  /** 회복된 응답 row id 를 응답 스토어에 반영 (Zustand 액션). */
  setCurrentResponseId: (id: string) => void;
  /** resume 이 survey_paused 로 실패하면 중단 화면으로 전환 (공통 채널, use-duplicate-guard 소유). */
  setDuplicateStatus: Dispatch<SetStateAction<DuplicateStatus>>;
  /** 세션 도중 중단 감지 시 재조회한 최신 중단 문구 승격용 (handlePausedMutationError 로 전달). */
  setPausedMessage?: Dispatch<SetStateAction<string | null>>;
}

interface UseSessionRecoveryResult {
  /** recovery effect 가 resumeOrCreateResponse 를 await 하는 동안 true. handleResponse INSERT 가드(I-1)에서 참조. */
  isRecovering: boolean;
  /** 회복 토스트 메시지 (drop → in_progress 회복 시에만 set). */
  resumeMessage: string | null;
  /** 토스트 dismiss. <ResumeToast> 가 자체 마운트 4초 타이머에서 호출한다. */
  dismissResume: () => void;
}

/**
 * 운영 현황 콘솔(T6): localStorage 기반 응답 회복 훅.
 *
 * survey-response-flow.tsx 의 응답 회복 useEffect + isRecovering/resumeMessage state 를 이관했다.
 *
 * 동작 핵심:
 * - 일반 응답은 localStorage session으로 기존 회복과 show segment를 유지한다.
 * - 대상자 테스트는 key가 없어도 현재 session으로 읽기 전용 resume를 수행하고 답만 복원한다.
 * - target resume만으로는 쓰기 소유권이나 telemetry를 열지 않는다.
 * - 토스트 자동 dismiss 는 이 훅이 아니라 <ResumeToast> 가 자체 마운트 4초 타이머로 처리한다.
 *   (과거: 여기서 resumeMessage set 시점에 4초 타이머를 걸어, 로딩/중복확인 early-return 화면이
 *    떠 있는 동안 4초가 소진돼 메인 콘텐츠가 보일 땐 토스트가 이미 사라져 있었다.)
 */
export function useSessionRecovery({
  enabled = true,
  terminalBlocked = false,
  isAdminEdit,
  isPreview = false,
  loadedSurvey,
  currentResponseId,
  inviteToken,
  testToken,
  isTestSession,
  isTargetTestSession = false,
  sessionId,
  setSessionId,
  setResponses,
  setCurrentResponseId,
  setDuplicateStatus,
  setPausedMessage,
}: UseSessionRecoveryArgs): UseSessionRecoveryResult {
  // recovery effect 가 resumeOrCreateResponse 를 await 하는 동안 true.
  // handleResponse 의 INSERT 가드에서 참조해 recovery 완료 전 신규 INSERT 발사를 차단한다 (I-1).
  const [isRecovering, setIsRecovering] = useState(false);
  const [resumeMessage, setResumeMessage] = useState<string | null>(null);
  type ResumeResult = Awaited<ReturnType<typeof client.surveyResponse.lifecycle.resume>>;
  const pendingResumeRequestsRef = useRef(new Map<string, Promise<ResumeResult>>());
  const attemptedRecoveryKeysRef = useRef(new Set<string>());
  const requestGenerationRef = useRef(0);

  // 운영 현황 콘솔(T6): localStorage 기반 응답 회복.
  // - 진입 시 1회 실행 (loadedSurvey 로드 완료 + currentResponseId 가 아직 null 일 때)
  // - localStorage에 saved sessionId 가 있으면 resumeOrCreateResponse 호출
  // - drop → in_progress 회복 시 sessionId/currentResponseId 갱신 + 토스트
  // - 종결 상태이거나 orphan(DB row 없음)이면 키 정리
  // - dep array에 sessionId 자체는 넣지 않는다 (saved 값을 effect 내부에서 직접 set → 무한 루프 방지)
  useEffect(() => {
    const generation = ++requestGenerationRef.current;
    let cancelled = false;
    const isCurrentRequest = () =>
      !cancelled && requestGenerationRef.current === generation;

    // admin-edit 분기 (4/8) — localStorage 회복은 응답자 세션 전용이므로 건너뜀.
    if (!enabled || terminalBlocked || isAdminEdit || isPreview) return;
    if (!loadedSurvey || currentResponseId !== null) return;

    const key = sessionStorageKey(loadedSurvey.id, inviteToken);
    const savedSessionId = window.localStorage.getItem(key);
    const recoverySessionId = savedSessionId ?? (isTargetTestSession ? sessionId : null);
    if (!recoverySessionId) return;

    const requestKey = JSON.stringify([
      loadedSurvey.id,
      recoverySessionId,
      inviteToken,
      isTestSession ? testToken : null,
    ]);
    let request = pendingResumeRequestsRef.current.get(requestKey);
    if (!request) {
      // 같은 flow identity의 recovery는 hook 인스턴스 수명 동안 최초 1회만 허용한다.
      // identity boundary remount는 새 ref를 만들므로 새 recovery를 시작할 수 있다.
      if (attemptedRecoveryKeysRef.current.has(requestKey)) return;
      attemptedRecoveryKeysRef.current.add(requestKey);
      const rawRequest = client.surveyResponse.lifecycle.resume({
        surveyId: loadedSurvey.id,
        sessionId: recoverySessionId,
        ...(inviteToken != null ? { inviteToken } : {}),
        ...(isTestSession && testToken != null ? { testToken } : {}),
      });
      const trackedRequest = rawRequest.then(
        (result) => {
          if (pendingResumeRequestsRef.current.get(requestKey) === trackedRequest) {
            pendingResumeRequestsRef.current.delete(requestKey);
          }
          return result;
        },
        (error: unknown) => {
          if (pendingResumeRequestsRef.current.get(requestKey) === trackedRequest) {
            pendingResumeRequestsRef.current.delete(requestKey);
          }
          throw error;
        },
      );
      request = trackedRequest;
      pendingResumeRequestsRef.current.set(requestKey, request);
    }

    // 원본(survey-response-flow) 의 회복 effect 와 동일하게 진입 직후 동기 set.
    // resume RPC await 동안 isRecovering=true 로 handleResponse INSERT 가드(I-1)를 막는다.
    setIsRecovering(true);

    request
      .then((result) => {
        if (!isCurrentRequest()) return;
        if (!result) {
          // localStorage 키는 있는데 DB에 row 없음 — orphan, 정리
          window.localStorage.removeItem(key);
          if (isTargetTestSession) setResponses?.({});
          return;
        }
        // 종결 상태(completed/screened/quotaful/bad)면 회복 안 시키고 새 응답 흐름 둔다
        if (result.status !== 'in_progress') {
          window.localStorage.removeItem(key);
          if (isTargetTestSession) setResponses?.({});
          return;
        }
        // 응답 row 사용 — sessionId 를 saved 값으로 갱신해 DB row 와 일치시킨다
        if (!isTargetTestSession) setSessionId(recoverySessionId);
        if (isTargetTestSession) setResponses?.(result.questionResponses ?? {});
        // Zustand currentResponseId 갱신은 이 effect cleanup을 동기 유발할 수 있다.
        // 먼저 recovery gate를 닫아 stale finally가 무시돼도 true가 남지 않게 한다.
        setIsRecovering(false);
        setCurrentResponseId(result.id);
        // 회복 직후 새 visit 열기 — recordStepVisit은 동일 step 재진입 시 no-op이라 의존 불가.
        if (!isTargetTestSession) sendVisibilitySegment(result.id, 'show');
        // 회복된 경우(drop → in_progress)만 토스트
        if (result.resumed) {
          setResumeMessage('이전 응답을 이어서 진행합니다');
        }
      })
      .catch(async (err) => {
        if (!isCurrentRequest()) return;
        // 진입 시점에 이미 중단됐다면 resume 이 survey_paused throw → 중단 화면으로 전환.
        // (통상은 control.isPaused 렌더 게이트가 먼저 막지만, 채널을 일치시켜 둔다.)
        if (
          await handlePausedMutationError({
            err,
            surveyId: loadedSurvey.id,
            testToken,
            isTestSession,
            setDuplicateStatus: (value) => {
              if (isCurrentRequest()) setDuplicateStatus(value);
            },
            ...(setPausedMessage
              ? {
                  setPausedMessage: (value: SetStateAction<string | null>) => {
                    if (isCurrentRequest()) setPausedMessage(value);
                  },
                }
              : {}),
          })
        ) {
          return;
        }
        if (!isCurrentRequest()) return;
        console.error('응답 회복 실패:', err);
      })
      .finally(() => {
        if (isCurrentRequest()) setIsRecovering(false);
      });
    return () => {
      cancelled = true;
    };
    // deps 는 원본과 1:1 동일. setSessionId 는 안정적 setter 라 의도적으로 제외(원본 동일),
    // sessionId 도 effect 내부에서 직접 set 하므로 deps 미포함(무한 루프 방지).
    // testToken/isTestSession 은 세션 동안 안정적이나 클로저 정합을 위해 deps 에 포함한다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, terminalBlocked, isAdminEdit, isPreview, loadedSurvey, currentResponseId, setCurrentResponseId, inviteToken, testToken, isTestSession, isTargetTestSession, sessionId, setResponses]);

  // 토스트 dismiss 는 <ResumeToast> 가 자체 마운트 시점부터 4초 타이머로 호출한다.
  // 안정 참조라 ResumeToast 의 마운트 전용 effect deps 에서 안전하게 제외된다.
  const dismissResume = useCallback(() => setResumeMessage(null), []);

  return { isRecovering, resumeMessage, dismissResume };
}
