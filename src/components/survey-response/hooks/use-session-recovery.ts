import { useCallback, useEffect, useState } from 'react';

import { client } from '@/shared/lib/rpc';
import type { Survey } from '@/types/survey';

import { sendVisibilitySegment, sessionStorageKey } from './session-helpers';

interface UseSessionRecoveryArgs {
  isAdminEdit: boolean;
  isPreview?: boolean;
  loadedSurvey: Survey | null;
  currentResponseId: string | null;
  inviteToken: string | null;
  /** 회복된 DB row 의 sessionId 로 컴포넌트 sessionId state 를 갱신 (소유권은 컴포넌트). */
  setSessionId: (sessionId: string) => void;
  /** 회복된 응답 row id 를 응답 스토어에 반영 (Zustand 액션). */
  setCurrentResponseId: (id: string) => void;
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
 * - 회복 effect 본문(localStorage 조회 → resume RPC → orphan/종결 정리 → sessionId/responseId 갱신 → show 세그먼트 → 토스트) 라인 단위 동일.
 * - 회복 effect deps = [isAdminEdit, loadedSurvey, currentResponseId, setCurrentResponseId, inviteToken] 그대로
 *   (sessionId 는 effect 내부에서 직접 set 하므로 deps 미포함 — 무한 루프 방지, 원본과 동일).
 * - 토스트 자동 dismiss 는 이 훅이 아니라 <ResumeToast> 가 자체 마운트 4초 타이머로 처리한다.
 *   (과거: 여기서 resumeMessage set 시점에 4초 타이머를 걸어, 로딩/중복확인 early-return 화면이
 *    떠 있는 동안 4초가 소진돼 메인 콘텐츠가 보일 땐 토스트가 이미 사라져 있었다.)
 */
export function useSessionRecovery({
  isAdminEdit,
  isPreview = false,
  loadedSurvey,
  currentResponseId,
  inviteToken,
  setSessionId,
  setCurrentResponseId,
}: UseSessionRecoveryArgs): UseSessionRecoveryResult {
  // recovery effect 가 resumeOrCreateResponse 를 await 하는 동안 true.
  // handleResponse 의 INSERT 가드에서 참조해 recovery 완료 전 신규 INSERT 발사를 차단한다 (I-1).
  const [isRecovering, setIsRecovering] = useState(false);
  const [resumeMessage, setResumeMessage] = useState<string | null>(null);

  // 운영 현황 콘솔(T6): localStorage 기반 응답 회복.
  // - 진입 시 1회 실행 (loadedSurvey 로드 완료 + currentResponseId 가 아직 null 일 때)
  // - localStorage에 saved sessionId 가 있으면 resumeOrCreateResponse 호출
  // - drop → in_progress 회복 시 sessionId/currentResponseId 갱신 + 토스트
  // - 종결 상태이거나 orphan(DB row 없음)이면 키 정리
  // - dep array에 sessionId 자체는 넣지 않는다 (saved 값을 effect 내부에서 직접 set → 무한 루프 방지)
  useEffect(() => {
    // admin-edit 분기 (4/8) — localStorage 회복은 응답자 세션 전용이므로 건너뜀.
    if (isAdminEdit || isPreview) return;
    if (!loadedSurvey || currentResponseId !== null) return;

    const key = sessionStorageKey(loadedSurvey.id);
    const savedSessionId = window.localStorage.getItem(key);
    if (!savedSessionId) return;

    // 원본(survey-response-flow) 의 회복 effect 와 동일하게 진입 직후 동기 set.
    // resume RPC await 동안 isRecovering=true 로 handleResponse INSERT 가드(I-1)를 막는다.
    setIsRecovering(true);
    client.surveyResponse.lifecycle.resume({
      surveyId: loadedSurvey.id,
      sessionId: savedSessionId,
      ...(inviteToken != null ? { inviteToken } : {}),
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
        // 회복 직후 새 visit 열기 — recordStepVisit은 동일 step 재진입 시 no-op이라 의존 불가.
        sendVisibilitySegment(result.id, 'show');
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
    // deps 는 원본과 1:1 동일. setSessionId 는 안정적 setter 라 의도적으로 제외(원본 동일),
    // sessionId 도 effect 내부에서 직접 set 하므로 deps 미포함(무한 루프 방지).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdminEdit, isPreview, loadedSurvey, currentResponseId, setCurrentResponseId, inviteToken]);

  // 토스트 dismiss 는 <ResumeToast> 가 자체 마운트 시점부터 4초 타이머로 호출한다.
  // 안정 참조라 ResumeToast 의 마운트 전용 effect deps 에서 안전하게 제외된다.
  const dismissResume = useCallback(() => setResumeMessage(null), []);

  return { isRecovering, resumeMessage, dismissResume };
}
