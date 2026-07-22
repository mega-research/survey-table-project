import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';

type CampaignStatus = 'draft' | 'queued' | 'sending' | 'completed' | 'partial' | 'cancelled';
type RecipientStatus = 'queued' | 'sending' | 'sent' | 'failed' | 'skipped_unsubscribed';

interface RecipientState {
  recipientId: string;
  id: string;
  emailSnapshot: string | null;
  inviteCode: string;
  unsubscribeToken: string;
  attrs: Record<string, string>;
  unsubscribedAt: Date | null;
  archivedAt: Date | null;
  status: RecipientStatus;
}

const { state, sendBatchMock, renderMock } = vi.hoisted(() => ({
  state: {
    campaign: {
      id: 'c1',
      surveyId: 's1',
      status: 'sending' as CampaignStatus,
      archivedAt: null as Date | null,
      isTest: false,
      subjectSnapshot: 'subject',
      bodyHtmlSnapshot: '<p>body</p>',
      fromLocalSnapshot: 'noreply',
      fromNameSnapshot: 'Survey',
      replyToSnapshot: null as string | null,
      attachmentsSnapshot: [] as unknown[],
      startedAt: new Date('2026-07-22T00:00:00Z'),
    },
    campaignExists: true,
    recipients: [] as RecipientState[],
    events: [] as string[],
    setPayloads: [] as Array<Record<string, unknown>>,
    executeQueries: [] as unknown[],
    cancelDuringRender: false,
  },
  sendBatchMock: vi.fn(),
  renderMock: vi.fn(),
}));

const dialect = new PgDialect();

process.env['NEXT_PUBLIC_APP_URL'] = 'https://example.com';
process.env['RESEND_FROM_DOMAIN'] = 'mail.example.com';

function compiled(query: unknown): { sql: string; params: unknown[] } {
  return dialect.sqlToQuery(query as never);
}

function hasNullGuard(query: unknown, column: string): boolean {
  return compiled(query).sql.includes(`\"${column}\" is null`);
}

function hasNotNullGuard(query: unknown, column: string): boolean {
  return compiled(query).sql.includes(`\"${column}\" is not null`);
}

function requestedIds(query: unknown): Set<string> {
  return new Set(compiled(query).params.filter((value): value is string => (
    typeof value === 'string' && state.recipients.some((row) => row.id === value)
  )));
}

function expectedRecipientStatus(query: unknown): RecipientStatus | null {
  const q = compiled(query);
  const match = q.sql.match(/\"mail_recipients\"\.\"status\" = \$(\d+)/);
  if (!match?.[1]) return null;
  const value = q.params[Number(match[1]) - 1];
  return typeof value === 'string' ? value as RecipientStatus : null;
}

function recipientRows(query: unknown | null): RecipientState[] {
  let rows = state.recipients.filter((row) => row.status === 'queued');
  if (!query) return rows;
  const ids = requestedIds(query);
  if (ids.size > 0) rows = rows.filter((row) => ids.has(row.id));
  if (hasNullGuard(query, 'archived_at')) rows = rows.filter((row) => row.archivedAt === null);
  if (hasNotNullGuard(query, 'email_snapshot')) {
    rows = rows.filter((row) => row.emailSnapshot !== null);
  }
  return rows;
}

function makeSelect() {
  let tableName = '';
  let whereQuery: unknown | null = null;
  const resolveRows = () => tableName === 'mail_campaigns'
    ? (state.campaignExists ? [state.campaign] : [])
    : recipientRows(whereQuery);
  const chain = {
    from(table: { [key: symbol]: unknown }) {
      tableName = Reflect.get(table, Symbol.for('drizzle:Name')) as string;
      return chain;
    },
    innerJoin() {
      return chain;
    },
    where(query: unknown) {
      whereQuery = query;
      return chain;
    },
    for: async () => resolveRows(),
    then: <T>(resolve: (rows: unknown[]) => T) => Promise.resolve(resolveRows()).then(resolve),
  };
  return chain;
}

function makeUpdate(table: { [key: symbol]: unknown }) {
  const tableName = Reflect.get(table, Symbol.for('drizzle:Name')) as string;
  let payload: Record<string, unknown> = {};
  let whereQuery: unknown | null = null;
  let applied = false;
  let result: Array<{ id: string }> = [];

  const apply = () => {
    if (applied) return result;
    applied = true;
    state.setPayloads.push(payload);

    if (tableName === 'mail_campaigns') {
      Object.assign(state.campaign, payload);
      result = [{ id: state.campaign.id }];
      return result;
    }

    const ids = whereQuery ? requestedIds(whereQuery) : new Set<string>();
    const expectedStatus = whereQuery ? expectedRecipientStatus(whereQuery) : null;
    const candidates = state.recipients.filter((row) => (
      (ids.size === 0 || ids.has(row.id))
      && (expectedStatus === null || row.status === expectedStatus)
      && (!whereQuery || !hasNullGuard(whereQuery, 'archived_at') || row.archivedAt === null)
      && (!whereQuery || !hasNotNullGuard(whereQuery, 'email_snapshot') || row.emailSnapshot !== null)
    ));

    for (const row of candidates) {
      if (payload['status'] === 'sending') state.events.push(`claim:${row.id}`);
      Object.assign(row, payload);
    }
    result = candidates.map((row) => ({ id: row.id }));
    return result;
  };

  const terminal = {
    returning: async () => apply(),
    then: <T>(resolve: (rows: unknown[]) => T) => Promise.resolve(apply()).then(resolve),
  };
  return {
    set(next: Record<string, unknown>) {
      payload = next;
      return {
        where(query: unknown) {
          whereQuery = query;
          return terminal;
        },
      };
    },
  };
}

vi.mock('@/db', () => ({
  db: {
    select: vi.fn(() => makeSelect()),
    update: vi.fn((table: { [key: symbol]: unknown }) => makeUpdate(table)),
    transaction: vi.fn(async (callback: (tx: unknown) => Promise<unknown> | unknown) => callback({
      select: vi.fn(() => makeSelect()),
      update: vi.fn((table: { [key: symbol]: unknown }) => makeUpdate(table)),
      execute: vi.fn(async (query: unknown) => {
        state.executeQueries.push(query);
      }),
    })),
  },
}));

vi.mock('@react-email/render', () => ({
  render: renderMock,
}));

vi.mock('@/lib/mail/render-for-send', () => ({
  renderForCampaignSend: (input: { subject: string; inviteUrl: string }) => ({
    subject: input.subject,
    bodyHtml: input.inviteUrl,
  }),
}));

vi.mock('@/lib/mail/send-bulk', () => ({
  resolveCampaignAttachments: vi.fn(async () => undefined),
  sendCampaignBatch: sendBatchMock,
}));

vi.mock('@/lib/mail/template-wrapper', () => ({
  MailWrapper: () => null,
}));

import {
  dispatchCampaignChunk,
  prepareCampaignDispatch,
} from '@/lib/mail/campaign-dispatch';

function makeRecipient(id: string, overrides: Partial<RecipientState> = {}): RecipientState {
  return {
    id,
    recipientId: id,
    emailSnapshot: `${id}@example.com`,
    inviteCode: `invite-${id}`,
    unsubscribeToken: `unsubscribe-${id}`,
    attrs: {},
    unsubscribedAt: null,
    archivedAt: null,
    status: 'queued',
    ...overrides,
  };
}

beforeEach(() => {
  state.campaign.status = 'sending';
  state.campaign.archivedAt = null;
  state.campaign.isTest = false;
  state.campaignExists = true;
  state.recipients = [makeRecipient('r1')];
  state.events = [];
  state.setPayloads = [];
  state.executeQueries = [];
  state.cancelDuringRender = false;
  renderMock.mockReset();
  renderMock.mockImplementation(async (element: { props: Record<string, unknown> }) => {
    if (state.cancelDuringRender) state.campaign.status = 'cancelled';
    return JSON.stringify(element.props);
  });
  sendBatchMock.mockReset();
  sendBatchMock.mockImplementation(async (input: {
    recipients: Array<{ recipientId: string }>;
  }) => {
    state.events.push('send');
    return input.recipients.map((recipient) => ({
      recipientId: recipient.recipientId,
      resendMessageId: `message-${recipient.recipientId}`,
    }));
  });
});

describe('prepareCampaignDispatch campaign gate', () => {
  it.each<CampaignStatus>(['draft', 'completed', 'partial', 'cancelled'])(
    '%s 캠페인은 prepare에서 발송을 시작하지 않는다',
    async (status) => {
      state.campaign.status = status;

      await expect(prepareCampaignDispatch('c1')).resolves.toBeNull();
      expect(state.campaign.status).toBe(status);
    },
  );

  it('보관된 캠페인은 prepare에서 발송을 시작하지 않는다', async () => {
    state.campaign.archivedAt = new Date('2026-07-22T00:00:00Z');

    await expect(prepareCampaignDispatch('c1')).resolves.toBeNull();
    expect(state.campaign.status).toBe('sending');
  });

  it('활성 캠페인의 non-archived queued recipient만 예약한다', async () => {
    state.campaign.status = 'queued';
    state.recipients.push(makeRecipient('archived', { archivedAt: new Date() }));

    await expect(prepareCampaignDispatch('c1')).resolves.toEqual({ recipientIds: ['r1'] });
    expect(state.campaign.status).toBe('sending');
  });
});

describe('dispatchCampaignChunk 안전 발송', () => {
  it('삭제된 캠페인은 예약 chunk에서 외부 발송 없이 종료한다', async () => {
    state.campaignExists = false;

    await expect(dispatchCampaignChunk('c1', ['r1'])).resolves.toEqual({
      sent: 0,
      failed: 0,
      cancelled: true,
    });
    expect(sendBatchMock).not.toHaveBeenCalled();
  });

  it.each<CampaignStatus>(['draft', 'completed', 'partial', 'cancelled'])(
    '%s 캠페인은 chunk에서 외부 발송하지 않는다',
    async (status) => {
      state.campaign.status = status;

      await expect(dispatchCampaignChunk('c1', ['r1'])).resolves.toEqual({
        sent: 0,
        failed: 0,
        cancelled: true,
      });
      expect(sendBatchMock).not.toHaveBeenCalled();
    },
  );

  it('보관된 캠페인은 chunk에서 외부 발송하지 않는다', async () => {
    state.campaign.archivedAt = new Date('2026-07-22T00:00:00Z');

    await expect(dispatchCampaignChunk('c1', ['r1'])).resolves.toEqual({
      sent: 0,
      failed: 0,
      cancelled: true,
    });
    expect(sendBatchMock).not.toHaveBeenCalled();
  });

  it('테스트 캠페인은 실제 invite와 sandbox unsubscribe 및 campaign footer를 쓴다', async () => {
    state.campaign.isTest = true;

    await dispatchCampaignChunk('c1', ['r1']);

    const html = sendBatchMock.mock.calls[0]![0].recipients[0].html as string;
    expect(html).toContain('/i/invite-r1');
    expect(html).toContain('/unsubscribe/__test__');
    expect(html).toContain('campaign');
  });

  it('실제 캠페인의 invite, unsubscribe, footer 정책은 기존 동작을 유지한다', async () => {
    await dispatchCampaignChunk('c1', ['r1']);

    const html = sendBatchMock.mock.calls[0]![0].recipients[0].html as string;
    expect(html).toContain('/i/invite-r1');
    expect(html).toContain('/unsubscribe/unsubscribe-r1');
    expect(html).toContain('"testFooterKind":null');
    expect(html).not.toContain('/unsubscribe/__test__');
  });

  it('외부 발송 직전에 eligible recipient만 원자 인수한다', async () => {
    state.recipients.push(
      makeRecipient('archived', { archivedAt: new Date() }),
      makeRecipient('no-email', { emailSnapshot: null }),
    );

    await dispatchCampaignChunk('c1', ['r1', 'archived', 'no-email']);

    const input = sendBatchMock.mock.calls[0]![0] as {
      recipients: Array<{ recipientId: string; to: string }>;
    };
    expect(input.recipients).toEqual([
      expect.objectContaining({ recipientId: 'r1', to: 'r1@example.com' }),
    ]);
    expect(state.events).toEqual(['claim:r1', 'send']);
    expect(state.recipients.find((row) => row.id === 'archived')?.status).toBe('queued');
    expect(state.recipients.find((row) => row.id === 'no-email')?.status).toBe('queued');
  });

  it('campaign 재검사와 claim 사이 취소도 발송을 시작하지 않는다', async () => {
    state.cancelDuringRender = true;

    await expect(dispatchCampaignChunk('c1', ['r1'])).resolves.toEqual({
      sent: 0,
      failed: 0,
      cancelled: true,
    });
    expect(sendBatchMock).not.toHaveBeenCalled();
    expect(state.recipients[0]?.status).toBe('queued');
  });

  it('동일 chunk가 동시에 실행돼도 claim된 recipient는 한 번만 발송한다', async () => {
    const results = await Promise.all([
      dispatchCampaignChunk('c1', ['r1']),
      dispatchCampaignChunk('c1', ['r1']),
    ]);

    expect(sendBatchMock).toHaveBeenCalledTimes(1);
    expect(results.reduce((sum, result) => sum + result.sent, 0)).toBe(1);
    expect(state.setPayloads.filter((payload) => payload['status'] === 'sent')).toHaveLength(1);
  });

  it('sending 결과 전이가 중복 실행돼도 반환값과 terminal update는 한 번만 센다', async () => {
    sendBatchMock.mockResolvedValueOnce([
      { recipientId: 'r1', resendMessageId: null, errorReason: 'rate limit' },
    ]);

    const first = await dispatchCampaignChunk('c1', ['r1']);
    const retry = await dispatchCampaignChunk('c1', ['r1']);

    expect(first).toEqual({ sent: 0, failed: 1 });
    expect(retry).toEqual({ sent: 0, failed: 0 });
    expect(state.setPayloads.filter((payload) => payload['status'] === 'failed')).toHaveLength(1);
  });
});
