import { describe, expect, it, vi } from 'vitest';

import { applyRecipientTransition } from '@/lib/mail/recipient-status-transition';

function makeTx() {
  const updateWhere = vi.fn(async () => undefined);
  const updateSet = vi.fn(() => ({ where: updateWhere }));
  const update = vi.fn(() => ({ set: updateSet }));
  const execute = vi.fn(async () => undefined);
  return { tx: { update, execute }, update, updateSet, updateWhere, execute };
}

const ARGS = {
  recipientId: 'r1',
  campaignId: 'c1',
  prevStatus: 'sent' as const,
  newStatus: 'delivered' as const,
  eventAt: new Date('2026-05-29T04:10:00Z'),
  recipientArchivedAt: null as Date | null,
};

describe('applyRecipientTransition', () => {
  it('정상 전이는 update 1회 + execute 2회 후 true', async () => {
    const m = makeTx();
    const ok = await applyRecipientTransition(m.tx as never, ARGS);
    expect(ok).toBe(true);
    expect(m.update).toHaveBeenCalledTimes(1);
    expect(m.updateSet).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'delivered', deliveredAt: ARGS.eventAt }),
    );
    expect(m.execute).toHaveBeenCalledTimes(2);
  });

  it('역행 전이는 no-op 후 false', async () => {
    const m = makeTx();
    const ok = await applyRecipientTransition(m.tx as never, {
      ...ARGS,
      prevStatus: 'delivered',
      newStatus: 'sent',
    });
    expect(ok).toBe(false);
    expect(m.update).not.toHaveBeenCalled();
    expect(m.execute).not.toHaveBeenCalled();
  });

  it('sent->failed 전이는 update 1회(deliveredAt 없음) + execute 2회 후 true', async () => {
    const m = makeTx();
    const ok = await applyRecipientTransition(m.tx as never, {
      ...ARGS,
      prevStatus: 'sent',
      newStatus: 'failed',
    });
    expect(ok).toBe(true);
    expect(m.update).toHaveBeenCalledTimes(1);
    expect(m.updateSet).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'failed' }),
    );
    expect(m.updateSet).toHaveBeenCalledWith(
      expect.not.objectContaining({ deliveredAt: expect.anything() }),
    );
    expect(m.execute).toHaveBeenCalledTimes(2);
  });

  it('webhook이 sending row를 먼저 확정하면 durable lease도 함께 정리한다', async () => {
    const m = makeTx();

    const ok = await applyRecipientTransition(m.tx as never, {
      ...ARGS,
      prevStatus: 'sending',
      newStatus: 'sent',
    });

    expect(ok).toBe(true);
    expect(m.updateSet).toHaveBeenCalledWith(expect.objectContaining({
      status: 'sent',
      sendLeaseToken: null,
      sendLeaseExpiresAt: null,
      sendPayloadSnapshot: null,
    }));
  });

  it('archived recipient는 상태만 전이하고 active campaign counter를 변경하지 않는다', async () => {
    const m = makeTx();

    const ok = await applyRecipientTransition(m.tx as never, {
      ...ARGS,
      recipientArchivedAt: new Date('2026-07-22T00:00:00Z'),
    });

    expect(ok).toBe(true);
    expect(m.update).toHaveBeenCalledTimes(1);
    expect(m.execute).not.toHaveBeenCalled();
  });
});
