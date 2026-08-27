import { describe, expect, it, vi } from 'vitest';

import { applyRecipientTransition } from '@/lib/mail/recipient-status-transition';

function makeTx(opts?: { contactTargetId?: string | null }) {
  const updateWhere = vi.fn(async () => undefined);
  const updateSet = vi.fn(() => ({ where: updateWhere }));
  const update = vi.fn(() => ({ set: updateSet }));
  const execute = vi.fn(async () => undefined);
  // complained 전이의 contactTargetId 조회 (그 외 상태에서는 호출되지 않는다).
  const select = vi.fn(() => ({
    from: () => ({
      where: async () => [{ contactTargetId: opts?.contactTargetId ?? null }],
    }),
  }));
  return { tx: { update, execute, select }, update, updateSet, updateWhere, execute, select };
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
      sendAttemptedAt: null,
      sendLeaseToken: null,
      sendLeaseExpiresAt: null,
      sendPayloadSnapshot: null,
    }));
  });

  it('complained 전이는 컨택 unsubscribed_at 을 신고 시각으로 세운다 — 수신거부 동급', async () => {
    const m = makeTx({ contactTargetId: 'ct-1' });
    const ok = await applyRecipientTransition(m.tx as never, {
      ...ARGS,
      prevStatus: 'delivered',
      newStatus: 'complained',
    });
    expect(ok).toBe(true);
    // recipient 상태 전이 + 컨택 unsubscribed_at 두 번의 update.
    expect(m.update).toHaveBeenCalledTimes(2);
    expect(m.updateSet).toHaveBeenCalledWith(
      expect.objectContaining({ unsubscribedAt: ARGS.eventAt }),
    );
  });

  it('complained 전이여도 contactTargetId 가 없으면 컨택 update 를 생략한다', async () => {
    const m = makeTx({ contactTargetId: null });
    const ok = await applyRecipientTransition(m.tx as never, {
      ...ARGS,
      prevStatus: 'delivered',
      newStatus: 'complained',
    });
    expect(ok).toBe(true);
    expect(m.update).toHaveBeenCalledTimes(1);
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
