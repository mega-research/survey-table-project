import { beforeEach, describe, expect, it, vi } from 'vitest';

const { applyMock, state } = vi.hoisted(() => ({
  applyMock: vi.fn(async () => true),
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

vi.mock('@/lib/mail/recipient-status-transition', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/mail/recipient-status-transition')>();
  return { ...actual, applyRecipientTransition: applyMock };
});

import * as resendWebhook from '@/lib/mail/resend-webhook';

const processResendEvent = resendWebhook.processResendEvent;

beforeEach(() => {
  state.selectResults = [];
  state.selectCall = 0;
  state.setPayloads = [];
  state.webhookIds = new Set();
  applyMock.mockClear();
});

describe('processResendEvent', () => {
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
