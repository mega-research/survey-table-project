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

/** sendBeacon 과 keepalive fetch 가 공유하는 전송 예산. 초과하면 둘 다 거부된다. */
const BEACON_MAX_BYTES = 64 * 1024;

/** 이탈 시점 draft 전송 시도 결과. */
export interface DraftBeaconAttempt {
  /** 브라우저가 전송을 인수했으면 true. sendBeacon 이 수락한 경우에만 true 다. */
  queued: boolean;
  /**
   * sendBeacon 을 쓰지 못해 fetch 로 보낸 경우의 도달 여부.
   * queued 가 true 면 null (sendBeacon 은 결과를 알려주지 않는다).
   */
  delivered: Promise<boolean> | null;
}

/**
 * 미저장 답변을 /api/response/draft 로 전송한다.
 *
 * 이탈 시점(visibilitychange:hidden / pagehide)에 호출되므로 탭 종료에도 살아남는
 * sendBeacon 을 우선 쓴다. sendBeacon 과 keepalive fetch 는 같은 전송 예산(약 64KiB)을
 * 공유하므로, 그 예산을 넘는 payload 는 sendBeacon 을 시도해도 어차피 거부된다 — 이
 * 경우 sendBeacon 을 건너뛰고 keepalive 없이 곧장 fetch 로 보낸다(페이지가 살아있는
 * 동안이라도 도달할 여지를 준다). 예산 이내인데도 sendBeacon 이 실패(큐 포화 등)하면
 * keepalive fetch 로 폴백한다.
 *
 * 호출부는 반환된 delivered promise 로 실제 도달 여부를 확인해 재시도 여부를 결정한다.
 */
export function sendDraftBeacon(
  responseId: string,
  answers: Record<string, unknown>,
  identity: TestAttemptIdentity | null = null,
): DraftBeaconAttempt {
  const payload = JSON.stringify({ responseId, answers, ...(identity ?? {}) });
  const byteSize = new Blob([payload]).size;

  if (byteSize > BEACON_MAX_BYTES) {
    const delivered = fetch('/api/response/draft', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: payload,
    })
      .then((res) => res.ok)
      .catch(() => false);
    return { queued: false, delivered };
  }

  if (typeof navigator !== 'undefined' && navigator.sendBeacon) {
    const queued = navigator.sendBeacon(
      '/api/response/draft',
      new Blob([payload], { type: 'application/json' }),
    );
    if (queued) return { queued: true, delivered: null };
  }

  const delivered = fetch('/api/response/draft', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: payload,
    keepalive: true,
  })
    .then((res) => res.ok)
    .catch(() => false);
  return { queued: false, delivered };
}
