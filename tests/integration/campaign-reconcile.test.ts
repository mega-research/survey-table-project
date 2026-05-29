import { describe, expect, it, vi, beforeEach } from 'vitest';

const { getMock, applyMock } = vi.hoisted(() => ({
  getMock: vi.fn(),
  applyMock: vi.fn(async () => true),
}));

const state: { stuck: Array<{ id: string; campaignId: string; status: string; resendMessageId: string | null }> } = {
  stuck: [],
};

vi.mock('@/db', () => {
  const selectChain = {
    from() {
      return this;
    },
    where() {
      return Promise.resolve(state.stuck);
    },
    for() {
      return Promise.resolve(state.stuck);
    },
  };
  return {
    db: {
      select: vi.fn(() => selectChain),
      transaction: vi.fn(async (cb: (tx: unknown) => Promise<void>) => {
        const tx = {
          select: vi.fn(() => ({
            from() {
              return this;
            },
            where() {
              return { for: () => Promise.resolve(state.stuck) };
            },
          })),
        };
        await cb(tx);
      }),
    },
  };
});

vi.mock('@/lib/mail/resend-client', () => ({
  getResend: () => ({ emails: { get: getMock } }),
}));

vi.mock('@/lib/mail/recipient-status-transition', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/mail/recipient-status-transition')>();
  return { ...actual, applyRecipientTransition: applyMock };
});

import { reconcileCampaignRecipients } from '@/lib/mail/campaign-reconcile';

beforeEach(() => {
  getMock.mockReset();
  applyMock.mockClear();
  applyMock.mockResolvedValue(true);
  state.stuck = [];
});

describe('reconcileCampaignRecipients', () => {
  it('stuck 없으면 Resend 호출 0회', async () => {
    const res = await reconcileCampaignRecipients('c1');
    expect(res).toEqual({ checked: 0, updated: 0 });
    expect(getMock).not.toHaveBeenCalled();
  });

  it('delivered 조회 1건 -> applyRecipientTransition 1회 호출', async () => {
    state.stuck = [{ id: 'a', campaignId: 'c1', status: 'sent', resendMessageId: 'ma' }];
    getMock.mockResolvedValue({ data: { last_event: 'delivered' } });
    const res = await reconcileCampaignRecipients('c1');
    expect(res.checked).toBe(1);
    expect(res.updated).toBe(1);
    expect(applyMock).toHaveBeenCalledTimes(1);
    expect(applyMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ recipientId: 'a', campaignId: 'c1', newStatus: 'delivered', prevStatus: 'sent' }),
    );
  });

  it('아직 sent(미전달) -> 전이 없음', async () => {
    state.stuck = [{ id: 'a', campaignId: 'c1', status: 'sent', resendMessageId: 'ma' }];
    getMock.mockResolvedValue({ data: { last_event: 'sent' } });
    const res = await reconcileCampaignRecipients('c1');
    expect(res.updated).toBe(0);
    expect(applyMock).not.toHaveBeenCalled();
  });

  it('Resend 조회 실패 건은 skip', async () => {
    state.stuck = [{ id: 'a', campaignId: 'c1', status: 'sent', resendMessageId: 'ma' }];
    getMock.mockRejectedValue(new Error('rate limit'));
    const res = await reconcileCampaignRecipients('c1');
    expect(res.updated).toBe(0);
    expect(applyMock).not.toHaveBeenCalled();
  });

  it('message_id 없는 stuck은 Resend 조회 대상에서 제외', async () => {
    state.stuck = [{ id: 'a', campaignId: 'c1', status: 'queued', resendMessageId: null }];
    const res = await reconcileCampaignRecipients('c1');
    expect(res.checked).toBe(0);
    expect(getMock).not.toHaveBeenCalled();
  });
});
