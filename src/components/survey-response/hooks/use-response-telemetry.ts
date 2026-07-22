import { useEffect } from 'react';
import type { RefObject } from 'react';

import { client } from '@/shared/lib/rpc';
import { type RenderStep, stepIdOf } from '@/lib/group-ordering';
import type { TestAttemptIdentity } from '@/shared/types/test-attempt';

import { sendVisibilitySegment } from './session-helpers';

interface UseResponseTelemetryArgs {
  enabled?: boolean;
  isAdminEdit: boolean;
  isPreview?: boolean;
  currentResponseId: string | null;
  currentStep: RenderStep | undefined;
  isCompleted: boolean;
  /**
   * visible 진척 최신값 미러 ref (소유권은 컴포넌트).
   * stepVisit RPC 가 stale 없이 visibleStepIndex/Total 을 읽기 위해 사용.
   */
  visibleProgressRef: RefObject<{ index: number; total: number }>;
  testIdentity?: TestAttemptIdentity | null;
}

/**
 * 운영 현황 콘솔(T5/세그먼트): 스텝 전환 추적 + Page Visibility 세그먼트 훅.
 *
 * survey-response-flow.tsx 의 stepVisit useEffect 와 Page Visibility useEffect 를
 * 등록 순서(stepVisit → visibility)를 유지한다. 상태는 소유하지 않는다.
 *
 * 동작 보존 핵심:
 * - enabled=false이면 두 telemetry effect 모두 등록하지 않는다.
 * - visibleProgressRef.current 를 effect 실행 시점에 읽는 의미론을 유지한다.
 * - target identity를 stepVisit과 visibility segment에 함께 전달한다.
 * - 두 effect 가 원본처럼 인접 등록되어 상대 순서가 보존된다.
 */
export function useResponseTelemetry({
  enabled = true,
  isAdminEdit,
  isPreview = false,
  currentResponseId,
  currentStep,
  isCompleted,
  visibleProgressRef,
  testIdentity = null,
}: UseResponseTelemetryArgs): void {
  // 운영 현황 콘솔(T5): 스텝 전환 추적.
  // - currentResponseId가 set된 이후(첫 답변 후)에만 동작
  // - 동일 stepId면 서버에서 no-op (멱등)
  // - 실패는 사용자 흐름을 막지 않고 콘솔에만 남긴다 (best-effort)
  // admin-edit 분기 (3/8) — 어드민 수정은 lastActivityAt 의미가 없고
  // saveAdminEdit 이 currentStepId 를 null 로 재설정하므로 step 추적 자체를 끈다.
  useEffect(() => {
    if (!enabled || isAdminEdit || isPreview) return;
    if (currentResponseId === null) return;
    if (!currentStep) return;
    const nextStepId = stepIdOf(currentStep);
    client.surveyResponse.lifecycle
      .stepVisit({
        responseId: currentResponseId,
        nextStepId,
        visibleStepIndex: visibleProgressRef.current.index,
        visibleStepTotal: visibleProgressRef.current.total,
        ...(testIdentity ?? {}),
      })
      .catch((err) => {
        console.error('recordStepVisit 실패:', err);
      });
    // deps 는 원본과 1:1 동일. visibleProgressRef 는 안정적 ref 라 의도적으로 제외(원본 동일,
    // effect 실행 시점의 .current 최신값을 읽는 의미론 유지).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, isAdminEdit, isPreview, currentResponseId, currentStep, testIdentity]);

  // 운영 현황 콘솔: Page Visibility 세그먼트.
  // - 탭이 숨겨질 때(hidden/pagehide) 현재 visit을 닫고, 다시 보일 때(visible) 새 visit을 연다.
  // - within-page idle(탭 닫고 떠난 시간)을 pageVisits에서 분리 → 소요시간/체류시간 정확화.
  // - hide는 sendBeacon(탭 닫힘에도 전송), show는 fetch(keepalive).
  useEffect(() => {
    if (!enabled || isAdminEdit || isPreview) return;
    if (currentResponseId === null) return;
    if (isCompleted) return;
    const rid = currentResponseId;

    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        sendVisibilitySegment(rid, 'hide', testIdentity, true);
      } else {
        sendVisibilitySegment(rid, 'show', testIdentity);
      }
    };
    const onPageHide = () => sendVisibilitySegment(rid, 'hide', testIdentity, true);

    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', onPageHide);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', onPageHide);
    };
  }, [enabled, isAdminEdit, isPreview, currentResponseId, isCompleted, testIdentity]);
}
