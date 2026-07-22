import { describe, expect, it, vi } from 'vitest';

describe('campaign dispatcher chunk loop', () => {
  it('cancelled chunk 이후 예약된 chunk를 실행하지 않는다', async () => {
    const dispatcherModule = await import('@/lib/inngest/functions/campaign-dispatcher');
    const runCampaignChunks = Reflect.get(dispatcherModule, 'runCampaignChunks') as unknown;

    expect(runCampaignChunks).toBeTypeOf('function');
    if (typeof runCampaignChunks !== 'function') return;

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
});
