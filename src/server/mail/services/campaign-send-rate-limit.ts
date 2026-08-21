export const CAMPAIGN_PROVIDER_SEND_INTERVAL_MS = 125;

export interface CampaignSendClock {
  now: () => number;
  sleep: (ms: number) => Promise<void>;
}

const systemClock: CampaignSendClock = {
  now: Date.now,
  sleep: (ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
};

/**
 * 호출이 겹쳐도 provider send 시작을 직렬화하고 초당 최대 8건으로 제한한다.
 * dispatchCampaignChunk가 청크마다 limiter를 만들며 첫 호출도 안전 간격 뒤 시작한다.
 * dispatcher의 전역 concurrency=1과 순차 청크 실행이 캠페인/청크 간 중첩을 막는다.
 */
export function createCampaignProviderRateLimiter(
  clock: CampaignSendClock = systemClock,
): { waitForTurn: () => Promise<void> } {
  let nextSendAt = clock.now() + CAMPAIGN_PROVIDER_SEND_INTERVAL_MS;
  let tail = Promise.resolve();

  return {
    waitForTurn() {
      const turn = tail.then(async () => {
        const waitMs = Math.max(0, nextSendAt - clock.now());
        if (waitMs > 0) await clock.sleep(waitMs);
        nextSendAt = clock.now() + CAMPAIGN_PROVIDER_SEND_INTERVAL_MS;
      });
      tail = turn.catch(() => undefined);
      return turn;
    },
  };
}
