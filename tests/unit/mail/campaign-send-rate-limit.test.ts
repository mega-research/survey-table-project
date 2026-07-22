import { describe, expect, it } from 'vitest';

import {
  CAMPAIGN_PROVIDER_SEND_INTERVAL_MS,
  createCampaignProviderRateLimiter,
} from '@/lib/mail/campaign-send-rate-limit';

describe('campaign provider rate limiter', () => {
  it('동시 요청도 직렬화해 각 provider call 사이를 최소 125ms로 유지한다', async () => {
    let now = 0;
    const sendTimes: number[] = [];
    const limiter = createCampaignProviderRateLimiter({
      now: () => now,
      sleep: async (ms) => {
        now += ms;
      },
    });

    await Promise.all([1, 2, 3].map(async () => {
      await limiter.waitForTurn();
      sendTimes.push(now);
    }));

    expect(CAMPAIGN_PROVIDER_SEND_INTERVAL_MS).toBe(125);
    expect(sendTimes).toEqual([125, 250, 375]);
  });
});
