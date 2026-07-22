import type { TestAttemptIdentity } from '@/shared/types/test-attempt';

/**
 * survey-response-flow 의 세션/세그먼트 헬퍼.
 *
 * 회복 훅(use-session-recovery)·텔레메트리 훅(use-response-telemetry)·
 * 본 컴포넌트(handleResponse/handleSubmit) 가 공유하므로 별도 모듈로 분리했다.
 * 동작은 원본 module-level 함수와 1:1 동일.
 */

/**
 * localStorage 키 — 회복용 sessionId 보관.
 * 첫 답변 INSERT 성공 후 SET, completeResponse 성공 후 DELETE.
 */
export function sessionStorageKey(surveyId: string, inviteToken?: string | null): string {
  return inviteToken
    ? `survey-session:${surveyId}:invite:${inviteToken}`
    : `survey-session:${surveyId}`;
}

/**
 * Page Visibility 세그먼트 신호를 /api/response/segment로 전송한다(fire-and-forget).
 * 탭 닫힘에도 살아남아야 하는 hide는 sendBeacon, 그 외는 keepalive fetch를 쓴다.
 */
export function sendVisibilitySegment(
  responseId: string,
  action: 'hide' | 'show',
  identity: TestAttemptIdentity | null = null,
  useBeacon = false,
): void {
  const payload = JSON.stringify({ responseId, action, ...(identity ?? {}) });
  if (useBeacon && typeof navigator !== 'undefined' && navigator.sendBeacon) {
    navigator.sendBeacon(
      '/api/response/segment',
      new Blob([payload], { type: 'application/json' }),
    );
    return;
  }
  fetch('/api/response/segment', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: payload,
    keepalive: true,
  }).catch(() => {});
}
