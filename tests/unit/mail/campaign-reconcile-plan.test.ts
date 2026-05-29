import { describe, expect, it } from 'vitest';

import { planReconcileTransitions } from '@/lib/mail/campaign-reconcile';
import type { StuckRecipient } from '@/lib/mail/campaign-reconcile';

const stuck: StuckRecipient[] = [
  { id: 'a', status: 'sent', resendMessageId: 'ma' },
  { id: 'b', status: 'sent', resendMessageId: 'mb' },
  { id: 'c', status: 'sent', resendMessageId: 'mc' },
];

describe('planReconcileTransitions', () => {
  it('delivered 조회는 전이 액션 생성', () => {
    const actions = planReconcileTransitions(stuck, [
      { recipientId: 'a', lastEvent: 'delivered' },
    ]);
    expect(actions).toEqual([{ recipientId: 'a', prevStatus: 'sent', newStatus: 'delivered' }]);
  });

  it('아직 sent(미전달)·조회실패·미매핑은 제외', () => {
    const actions = planReconcileTransitions(stuck, [
      { recipientId: 'a', lastEvent: 'sent' },
      { recipientId: 'b', error: true },
      { recipientId: 'c', lastEvent: 'delivery_delayed' },
    ]);
    expect(actions).toEqual([]);
  });

  it('여러 건 혼합 — 전이 가능한 것만', () => {
    const actions = planReconcileTransitions(stuck, [
      { recipientId: 'a', lastEvent: 'delivered' },
      { recipientId: 'b', lastEvent: 'bounced' },
      { recipientId: 'c', lastEvent: 'queued' },
    ]);
    expect(actions).toHaveLength(2);
    expect(actions.map((x) => x.newStatus).sort()).toEqual(['bounced', 'delivered']);
  });

  it('알 수 없는 recipientId 조회 결과는 무시', () => {
    const actions = planReconcileTransitions(stuck, [
      { recipientId: 'zzz', lastEvent: 'delivered' },
    ]);
    expect(actions).toEqual([]);
  });
});
