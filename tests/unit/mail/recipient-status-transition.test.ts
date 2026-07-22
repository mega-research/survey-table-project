import { describe, expect, it } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';

import {
  applyRecipientTransition,
  buildTimestampUpdate,
  canTransition,
  mapResendLastEvent,
  mapResendWebhookType,
  STATUS_ALLOWED_PREV,
} from '@/lib/mail/recipient-status-transition';

const dialect = new PgDialect();

describe('mapResendWebhookType', () => {
  it('알려진 이벤트를 status로 매핑한다', () => {
    expect(mapResendWebhookType('email.sent')).toBe('sent');
    expect(mapResendWebhookType('email.delivered')).toBe('delivered');
    expect(mapResendWebhookType('email.opened')).toBe('opened');
    expect(mapResendWebhookType('email.bounced')).toBe('bounced');
    expect(mapResendWebhookType('email.complained')).toBe('complained');
  });
  it('미매핑 이벤트는 null', () => {
    expect(mapResendWebhookType('email.delivery_delayed')).toBeNull();
    expect(mapResendWebhookType('unknown')).toBeNull();
  });
});

describe('mapResendLastEvent', () => {
  it('전달/열람/실패 계열을 매핑한다', () => {
    expect(mapResendLastEvent('delivered')).toBe('delivered');
    expect(mapResendLastEvent('opened')).toBe('opened');
    expect(mapResendLastEvent('clicked')).toBe('opened');
    expect(mapResendLastEvent('bounced')).toBe('bounced');
    expect(mapResendLastEvent('complained')).toBe('complained');
    expect(mapResendLastEvent('failed')).toBe('failed');
    expect(mapResendLastEvent('canceled')).toBe('failed');
    expect(mapResendLastEvent('suppressed')).toBe('bounced');
  });
  it('아직 미전달 상태는 null', () => {
    expect(mapResendLastEvent('sent')).toBeNull();
    expect(mapResendLastEvent('queued')).toBeNull();
    expect(mapResendLastEvent('scheduled')).toBeNull();
    expect(mapResendLastEvent('delivery_delayed')).toBeNull();
  });
});

describe('canTransition', () => {
  it('정상 전이는 허용', () => {
    expect(canTransition('sent', 'delivered')).toBe(true);
    expect(canTransition('queued', 'sent')).toBe(true);
    expect(canTransition('sending', 'sent')).toBe(true);
    expect(canTransition('sending', 'failed')).toBe(true);
    expect(canTransition('delivered', 'opened')).toBe(true);
    expect(canTransition('sent', 'failed')).toBe(true);
  });
  it('역행/중복은 차단', () => {
    expect(canTransition('delivered', 'delivered')).toBe(false);
    expect(canTransition('delivered', 'sent')).toBe(false);
    expect(canTransition('opened', 'delivered')).toBe(false);
  });
  it('sending은 유효한 다음 타겟이 아니다', () => {
    expect(canTransition('queued', 'sending')).toBe(false);
  });
});

describe('STATUS_ALLOWED_PREV', () => {
  it('sent의 허용 이전 상태는 queued/sending이다', () => {
    expect(STATUS_ALLOWED_PREV.sent).toEqual(['queued', 'sending']);
  });

  it('delivered의 허용 이전 상태는 queued/sent', () => {
    expect(STATUS_ALLOWED_PREV.delivered).toEqual(['queued', 'sent']);
  });
});

describe('buildTimestampUpdate', () => {
  const at = new Date('2026-05-29T04:10:00Z');
  it('status별 타임스탬프 컬럼을 채운다', () => {
    expect(buildTimestampUpdate('sent', at)).toEqual({ sentAt: at });
    expect(buildTimestampUpdate('delivered', at)).toEqual({ deliveredAt: at });
    expect(buildTimestampUpdate('opened', at)).toEqual({ openedAt: at });
    expect(buildTimestampUpdate('bounced', at)).toEqual({ bouncedAt: at });
    expect(buildTimestampUpdate('complained', at)).toEqual({ complainedAt: at });
  });
  it('타임스탬프 컬럼이 없는 status는 빈 객체', () => {
    expect(buildTimestampUpdate('failed', at)).toEqual({});
    expect(buildTimestampUpdate('sending', at)).toEqual({});
  });
});

describe('applyRecipientTransition counter', () => {
  it('sending에서 terminal로 전이할 때 queued_count를 한 번 감소시킨다', async () => {
    const executed: unknown[] = [];
    const tx = {
      update: () => ({ set: () => ({ where: async () => undefined }) }),
      execute: async (query: unknown) => {
        executed.push(query);
      },
    };

    const applied = await applyRecipientTransition(tx as never, {
      recipientId: 'r1',
      campaignId: 'c1',
      prevStatus: 'sending',
      newStatus: 'sent',
      eventAt: new Date('2026-07-22T00:00:00Z'),
    });

    expect(applied).toBe(true);
    expect(executed).toHaveLength(2);

    const counterQuery = dialect.sqlToQuery(executed[0] as never);
    expect(counterQuery.sql).toMatch(
      /queued_count\s*=\s*queued_count\s*-\s*CASE WHEN \$1 IN \('queued', 'sending'\)/,
    );
    expect(counterQuery.params[0]).toBe('sending');
  });
});
