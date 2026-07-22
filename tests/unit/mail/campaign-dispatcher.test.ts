import { describe, expect, it, vi } from 'vitest';

import {
  cleanupAfterDispatchRetryExhaustion,
  finishCampaignDispatch,
  runCampaignChunks,
} from '@/lib/inngest/functions/campaign-dispatcher';

describe('campaign dispatcher chunk loop', () => {
  it('cancelled chunk 이후 예약된 chunk를 실행하지 않는다', async () => {
    const runChunk = vi
      .fn()
      .mockResolvedValueOnce({ sent: 1, failed: 0 })
      .mockResolvedValueOnce({ sent: 0, failed: 0, cancelled: true })
      .mockResolvedValueOnce({ sent: 1, failed: 0 });

    const result = await runCampaignChunks(
      ['r1', 'r2', 'r3'],
      1,
      runChunk,
    );

    expect(runChunk).toHaveBeenCalledTimes(2);
    expect(result).toEqual({ sent: 1, failed: 0, cancelled: true });
  });

  it('최종 retry 소진 시 reconcile을 먼저 예약하고 23시간 안전창 뒤 durable cleanup한다', async () => {
    const order: string[] = [];
    const sendEvent = vi.fn(async () => {
      order.push('reconcile');
      return undefined;
    });
    const sleep = vi.fn(async () => {
      order.push('sleep');
      return undefined;
    });
    const sleepUntil = vi.fn(async () => undefined);
    const run = async <T>(_id: string, callback: () => Promise<T>): Promise<T> => callback();
    const terminalize = vi
      .fn()
      .mockResolvedValueOnce({ terminalized: 1, busyUntil: '2026-07-23T00:00:30.000Z' })
      .mockResolvedValueOnce({ terminalized: 0, busyUntil: '2026-07-23T00:00:31.000Z' })
      .mockResolvedValueOnce({ terminalized: 1, busyUntil: null });

    await expect(cleanupAfterDispatchRetryExhaustion(
      'campaign-1',
      'survey-1',
      { sendEvent, sleep, sleepUntil, run },
      terminalize,
    )).resolves.toEqual({ terminalized: 1, busyUntil: null });

    expect(sendEvent).toHaveBeenCalledWith('emit-dispatched-after-failure', {
      name: 'mail/campaign.dispatched',
      data: { campaignId: 'campaign-1', surveyId: 'survey-1' },
    });
    expect(order.slice(0, 2)).toEqual(['reconcile', 'sleep']);
    expect(sleep).toHaveBeenCalledWith('wait-resend-idempotency-window', '23h');
    expect(sleepUntil).toHaveBeenCalledWith(
      'wait-active-delivery-lease-1',
      new Date('2026-07-23T00:00:31.000Z'),
    );
    expect(sleepUntil).toHaveBeenCalledWith(
      'wait-active-delivery-lease-2',
      new Date('2026-07-23T00:00:32.000Z'),
    );
    expect(terminalize).toHaveBeenCalledTimes(3);
  });

  it('inactive retry가 cancelled 성공으로 끝나도 23시간 뒤 ambiguous row를 cleanup한다', async () => {
    const order: string[] = [];
    const step = {
      sendEvent: vi.fn(async () => {
        order.push('reconcile');
        return undefined;
      }),
      sleep: vi.fn(async () => {
        order.push('sleep');
        return undefined;
      }),
      sleepUntil: vi.fn(async () => undefined),
      run: async <T>(_id: string, callback: () => Promise<T>): Promise<T> => callback(),
    };
    const terminalize = vi.fn(async () => {
      order.push('terminalize');
      return { terminalized: 1, busyUntil: null };
    });

    await expect(finishCampaignDispatch(
      'campaign-1',
      'survey-1',
      true,
      step,
      terminalize,
    )).resolves.toEqual({ terminalized: 1, busyUntil: null });

    expect(order).toEqual(['reconcile', 'sleep', 'terminalize']);
  });
});
