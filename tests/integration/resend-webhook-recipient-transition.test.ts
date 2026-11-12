import { beforeEach, describe, expect, it, vi } from 'vitest';

const { applyMock, sentryMessageMock, state } = vi.hoisted(() => ({
  applyMock: vi.fn(async () => true),
  sentryMessageMock: vi.fn(),
  state: {
    selectResults: [] as Array<Array<{
      id: string;
      campaignId: string;
      status: string;
      archivedAt: Date | null;
      resendMessageId: string | null;
    }>>,
    selectCall: 0,
    setPayloads: [] as Array<Record<string, unknown>>,
    webhookIds: new Set<string>(),
  },
}));

vi.mock('@/db', () => ({
  db: {
    transaction: vi.fn(async (callback: (tx: unknown) => Promise<unknown>) => {
      const webhookIdsBefore = new Set(state.webhookIds);
      try {
        return await callback({
          insert: vi.fn(() => ({
            values: vi.fn((value: { id: string }) => ({
              onConflictDoNothing: vi.fn(() => ({
                returning: vi.fn(async () => {
                  if (state.webhookIds.has(value.id)) return [];
                  state.webhookIds.add(value.id);
                  return [{ id: value.id }];
                }),
              })),
            })),
          })),
          select: vi.fn(() => {
            let tableName = '';
            const resolveRows = () => tableName === 'mail_campaigns'
              ? [{ id: 'campaign-1' }]
              : state.selectResults[state.selectCall++] ?? [];
            const chain = {
              from(table: { [key: symbol]: unknown }) {
                tableName = Reflect.get(table, Symbol.for('drizzle:Name')) as string;
                return chain;
              },
              where() {
                return chain;
              },
              for: vi.fn(async () => resolveRows()),
              then: <T>(resolve: (rows: unknown[]) => T) => Promise.resolve(resolveRows()).then(resolve),
            };
            return chain;
          }),
          update: vi.fn(() => ({
            set: vi.fn((payload: Record<string, unknown>) => {
              state.setPayloads.push(payload);
              return { where: vi.fn(async () => undefined) };
            }),
          })),
        });
      } catch (error) {
        state.webhookIds = webhookIdsBefore;
        throw error;
      }
    }),
  },
}));

vi.mock('@/server/mail/services/recipient-status-transition', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/server/mail/services/recipient-status-transition')>();
  return { ...actual, applyRecipientTransition: applyMock };
});

vi.mock('@sentry/nextjs', () => ({ captureMessage: sentryMessageMock }));

import * as resendWebhook from '@/server/mail/services/resend-webhook';

const processResendEvent = resendWebhook.processResendEvent;

beforeEach(() => {
  state.selectResults = [];
  state.selectCall = 0;
  state.setPayloads = [];
  state.webhookIds = new Set();
  applyMock.mockClear();
  sentryMessageMock.mockClear();
});

describe('processResendEvent', () => {
  it('recipient가 이미 hard delete됐으면 webhook을 no-op 처리한다', async () => {
    state.selectResults = [[]];

    await expect(
      processResendEvent('missing', 'email.delivered', '2026-07-22T01:00:00Z'),
    ).resolves.toBeUndefined();

    expect(applyMock).not.toHaveBeenCalled();
  });

  it('archived recipient를 잠근 뒤 상태만 전이하도록 archive 시각을 전달한다', async () => {
    const archivedAt = new Date('2026-07-22T00:00:00Z');
    const recipient = {
      id: 'recipient-1',
      campaignId: 'campaign-1',
      status: 'sent',
      archivedAt,
      resendMessageId: 'message-1',
    };
    state.selectResults = [[recipient], [recipient]];

    await processResendEvent('message-1', 'email.delivered', '2026-07-22T01:00:00Z');

    expect(applyMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        recipientId: 'recipient-1',
        recipientArchivedAt: archivedAt,
      }),
    );
  });

  it('DB result 유실 시 webhook recipient tag로 message id를 복구한다', async () => {
    const recipient = {
      id: 'recipient-1',
      campaignId: 'campaign-1',
      status: 'sending',
      archivedAt: null,
      resendMessageId: null,
    };
    state.selectResults = [[], [recipient], [recipient]];

    await processResendEvent(
      'message-recovered',
      'email.sent',
      '2026-07-22T01:00:00Z',
      { campaign_id: 'campaign-1', recipient_id: 'recipient-1' },
    );

    expect(state.setPayloads).toContainEqual({
      resendMessageId: 'message-recovered',
      updatedAt: expect.any(Date),
    });
    expect(applyMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        recipientId: 'recipient-1',
        prevStatus: 'sending',
        newStatus: 'sent',
      }),
    );
  });

  it('transition 실패 시 dedupe도 rollback되어 같은 이벤트 retry가 적용된다', async () => {
    const processResendWebhookEvent = Reflect.get(
      resendWebhook,
      'processResendWebhookEvent',
    ) as unknown;
    expect(processResendWebhookEvent).toBeTypeOf('function');
    if (typeof processResendWebhookEvent !== 'function') return;

    const recipient = {
        id: 'recipient-1',
        campaignId: 'campaign-1',
        status: 'sent',
        archivedAt: null,
        resendMessageId: 'message-1',
    };
    state.selectResults = [
      [recipient], [recipient],
      [recipient], [recipient],
    ];
    applyMock
      .mockRejectedValueOnce(new Error('transient db failure'))
      .mockResolvedValueOnce(true);

    const event = {
      id: 'svix-event-1',
      type: 'email.delivered',
      createdAt: '2026-07-22T01:00:00Z',
      resendMessageId: 'message-1',
    };
    await expect(processResendWebhookEvent(event)).rejects.toThrow('transient db failure');
    expect(state.webhookIds.has(event.id)).toBe(false);

    await expect(processResendWebhookEvent(event)).resolves.toBe('processed');
    expect(state.webhookIds.has(event.id)).toBe(true);

    await expect(processResendWebhookEvent(event)).resolves.toBe('deduped');
    expect(applyMock).toHaveBeenCalledTimes(2);
  });

  it('동시에 도착한 같은 svix id도 한 번만 처리한다', async () => {
    const processResendWebhookEvent = Reflect.get(
      resendWebhook,
      'processResendWebhookEvent',
    ) as unknown;
    expect(processResendWebhookEvent).toBeTypeOf('function');
    if (typeof processResendWebhookEvent !== 'function') return;

    const recipient = {
      id: 'recipient-1',
      campaignId: 'campaign-1',
      status: 'sent',
      archivedAt: null,
      resendMessageId: 'message-1',
    };
    state.selectResults = [[recipient], [recipient]];
    const event = {
      id: 'svix-concurrent-1',
      type: 'email.delivered',
      createdAt: '2026-07-22T01:00:00Z',
      resendMessageId: 'message-1',
    };

    await expect(Promise.all([
      processResendWebhookEvent(event),
      processResendWebhookEvent(event),
    ])).resolves.toEqual(expect.arrayContaining(['processed', 'deduped']));
    expect(applyMock).toHaveBeenCalledOnce();
  });
});

/**
 * 전달 메일(회신 전달)의 상태 알림 — 발송 때 붙인 `kind=reply-forward` 태그로 가려낸다.
 * 수신자 기록이 없는 메일이라 상태·집계는 건드리지 않고, 반송·실패만 Sentry 경고로 알린다.
 */
describe('processResendWebhookEvent — 전달 메일(kind=reply-forward)의 상태 알림', () => {
  const { processResendWebhookEvent } = resendWebhook;
  const FORWARD_TAGS = { kind: 'reply-forward' };
  /** 조회가 수신자를 돌려주더라도(메시지 id 가 겹치는 있을 수 없는 경우) 전이하지 않는 것을 보려는 행. */
  const recipient = {
    id: 'recipient-1',
    campaignId: 'campaign-1',
    status: 'sent',
    archivedAt: null,
    resendMessageId: 'forward-out-1',
  };
  let seq = 0;
  const statusEvent = (type: string, tags?: unknown) => ({
    id: `svix-forward-${(seq += 1)}`,
    type,
    createdAt: '2026-11-12T01:00:00Z',
    resendMessageId: 'forward-out-1',
    ...(tags !== undefined ? { tags: tags as Record<string, string> } : {}),
  });

  it.each(['email.bounced', 'email.failed', 'email.suppressed', 'email.complained'])('%s 는 Sentry 경고를 낸다 — 주소·제목 없이 식별자만', async (type) => {
    state.selectResults = [[recipient], [recipient]];
    const event = statusEvent(type, FORWARD_TAGS);

    await processResendWebhookEvent(event);

    expect(sentryMessageMock).toHaveBeenCalledTimes(1);
    expect(sentryMessageMock).toHaveBeenCalledWith('회신 전달 메일 반송·실패', {
      level: 'warning',
      tags: { operation: 'reply_forward_bounce', eventType: type },
      extra: { messageId: 'forward-out-1', svixId: event.id },
    });
  });

  it.each(['email.bounced', 'email.failed', 'email.suppressed', 'email.complained'])(
    '%s 가 와도 수신자 상태·발송 회차 집계를 바꾸지 않는다',
    async (type) => {
      state.selectResults = [[recipient], [recipient]];

      await processResendWebhookEvent(statusEvent(type, FORWARD_TAGS));

      expect(applyMock).not.toHaveBeenCalled();
      expect(state.setPayloads).toEqual([]);
      // 수신자 조회조차 하지 않는다 — 전이 경로를 아예 타지 않는다.
      expect(state.selectCall).toBe(0);
    },
  );

  it.each(['email.sent', 'email.delivered', 'email.opened', 'email.clicked', 'email.delivery_delayed'])(
    '%s 는 조용히 지나간다 — 경고도 전이도 없다',
    async (type) => {
      state.selectResults = [[recipient], [recipient]];

      await expect(processResendWebhookEvent(statusEvent(type, FORWARD_TAGS))).resolves.not.toBe('deduped');

      expect(sentryMessageMock).not.toHaveBeenCalled();
      expect(applyMock).not.toHaveBeenCalled();
    },
  );

  it('장부에는 적는다 — 같은 반송 알림이 다시 와도 경고는 한 번이다', async () => {
    const event = statusEvent('email.bounced', FORWARD_TAGS);

    await processResendWebhookEvent(event);
    await expect(processResendWebhookEvent(event)).resolves.toBe('deduped');

    expect(state.webhookIds.has(event.id)).toBe(true);
    expect(sentryMessageMock).toHaveBeenCalledTimes(1);
  });

  it('태그가 이름·값 목록 모양으로 와도 알아본다', async () => {
    await processResendWebhookEvent(
      statusEvent('email.bounced', [{ name: 'kind', value: 'reply-forward' }]),
    );

    expect(sentryMessageMock).toHaveBeenCalledTimes(1);
  });

  it.each(['email.suppressed', 'email.complained'])(
    '태그가 없는 %s 알림은 회신 전달 경고를 내지 않는다 — 설문 발송의 알림이다',
    async (type) => {
      state.selectResults = [[recipient], [recipient]];
      applyMock.mockResolvedValueOnce(false);

      await processResendWebhookEvent(statusEvent(type));

      expect(sentryMessageMock).not.toHaveBeenCalled();
    },
  );

  it('태그가 없는 반송 알림은 지금처럼 수신자 전이 경로를 타고 경고를 내지 않는다', async () => {
    state.selectResults = [[recipient], [recipient]];
    applyMock.mockResolvedValueOnce(false);

    await expect(processResendWebhookEvent(statusEvent('email.bounced'))).resolves.toBe('processed');

    expect(applyMock).toHaveBeenCalledTimes(1);
    expect(sentryMessageMock).not.toHaveBeenCalled();
  });

  it.each([{ kind: 'campaign' }, { kind: 'template-test' }, { category: 'reply-forward' }])(
    '다른 태그(%j)의 반송 알림은 경고를 내지 않는다',
    async (tags) => {
      await processResendWebhookEvent(statusEvent('email.bounced', tags));

      expect(sentryMessageMock).not.toHaveBeenCalled();
    },
  );
});
