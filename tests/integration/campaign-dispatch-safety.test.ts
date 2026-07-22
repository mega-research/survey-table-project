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
  errorReason: string | null;
  resendMessageId: string | null;
  sendAttemptedAt: Date | null;
  sendLeaseToken: string | null;
  sendLeaseExpiresAt: Date | null;
  sendPayloadSnapshot: {
    from: string;
    replyTo: string;
    to: string;
    subject: string;
    html: string;
    attachments: Array<{
      filename: string;
      contentType?: string;
      sha256: string;
    }>;
  } | null;
  contactTargetId: string | null;
}

const {
  state,
  sendRecipientMock,
  renderMock,
  resolveAttachmentsMock,
  waitForTurnMock,
} = vi.hoisted(() => ({
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
    selectLocks: [] as string[],
    setPayloads: [] as Array<Record<string, unknown>>,
    executeQueries: [] as unknown[],
    cancelDuringRender: false,
    contactMutationDuringRender: null as 'delete' | 'unsubscribe' | null,
    failNextTerminalUpdate: false,
  },
  sendRecipientMock: vi.fn(),
  renderMock: vi.fn(),
  resolveAttachmentsMock: vi.fn(),
  waitForTurnMock: vi.fn(),
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
  const matches = [...q.sql.matchAll(/\"mail_recipients\"\.\"status\" = \$(\d+)/g)];
  if (matches.length !== 1 || !matches[0]?.[1]) return null;
  const value = q.params[Number(matches[0][1]) - 1];
  return typeof value === 'string' ? value as RecipientStatus : null;
}

function recipientRows(query: unknown | null): RecipientState[] {
  let rows = state.recipients.filter(
    (row) => row.status === 'queued' || row.status === 'sending',
  );
  if (!query) return rows;
  const ids = requestedIds(query);
  if (ids.size > 0) rows = rows.filter((row) => ids.has(row.id));
  const expectedStatus = expectedRecipientStatus(query);
  if (expectedStatus !== null) {
    rows = rows.filter((row) => row.status === expectedStatus);
  }
  if (hasNullGuard(query, 'archived_at')) {
    const includesSending = compiled(query).params.includes('sending');
    rows = rows.filter(
      (row) => row.archivedAt === null || (includesSending && row.status === 'sending'),
    );
  }
  if (hasNotNullGuard(query, 'email_snapshot')) {
    rows = rows.filter((row) => row.emailSnapshot !== null);
  }
  return rows;
}

function makeSelect() {
  let tableName = '';
  let whereQuery: unknown | null = null;
  const resolveRows = () => {
    if (tableName === 'mail_campaigns') {
      return state.campaignExists ? [{ ...state.campaign }] : [];
    }
    if (tableName === 'contact_targets') {
      const params = whereQuery ? compiled(whereQuery).params : [];
      const row = state.recipients.find((candidate) => (
        candidate.contactTargetId !== null && params.includes(candidate.contactTargetId)
      ));
      return row?.contactTargetId
        ? [{ id: row.contactTargetId, unsubscribedAt: row.unsubscribedAt }]
        : [];
    }
    return recipientRows(whereQuery).map((row) => ({ ...row }));
  };
  const chain = {
    from(table: { [key: symbol]: unknown }) {
      tableName = Reflect.get(table, Symbol.for('drizzle:Name')) as string;
      return chain;
    },
    innerJoin() {
      return chain;
    },
    leftJoin() {
      return chain;
    },
    where(query: unknown) {
      whereQuery = query;
      return chain;
    },
    for: async (mode: string) => {
      state.selectLocks.push(`${tableName}:${mode}`);
      return resolveRows();
    },
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
      const appliedPayload = { ...payload };
      if (
        appliedPayload['errorReason'] !== null
        && typeof appliedPayload['errorReason'] === 'object'
      ) {
        const [activeErrorReason] = compiled(appliedPayload['errorReason']).params;
        appliedPayload['errorReason'] = row.archivedAt === null ? activeErrorReason : null;
      }
      Object.assign(row, appliedPayload);
    }
    result = candidates.map((row) => ({ id: row.id, archivedAt: row.archivedAt }));
    return result;
  };

  const terminal = {
    returning: async () => {
      if (
        state.failNextTerminalUpdate
        && (payload['status'] === 'sent' || payload['status'] === 'failed')
      ) {
        state.failNextTerminalUpdate = false;
        throw new Error('db commit failed');
      }
      return apply();
    },
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
        if (
          state.campaign.status === 'sending'
          && recipientRows(null).length === 0
        ) {
          state.campaign.status = 'completed';
        }
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

vi.mock('@/lib/mail/campaign-send-rate-limit', () => ({
  createCampaignProviderRateLimiter: () => ({
    waitForTurn: waitForTurnMock,
  }),
}));

vi.mock('@/lib/mail/send-bulk', () => ({
  resolveCampaignAttachments: resolveAttachmentsMock,
  sendCampaignRecipient: sendRecipientMock,
  RetryableCampaignSendError: class RetryableCampaignSendError extends Error {},
}));

vi.mock('@/lib/mail/template-wrapper', () => ({
  MailWrapper: () => null,
}));

import {
  dispatchCampaignChunk,
  prepareCampaignDispatch,
  terminalizeUnresolvedCampaignDispatch,
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
    errorReason: null,
    resendMessageId: null,
    sendAttemptedAt: null,
    sendLeaseToken: null,
    sendLeaseExpiresAt: null,
    sendPayloadSnapshot: null,
    contactTargetId: `contact-${id}`,
    ...overrides,
  };
}

beforeEach(() => {
  state.campaign.status = 'sending';
  state.campaign.archivedAt = null;
  state.campaign.isTest = false;
  state.campaign.attachmentsSnapshot = [];
  state.campaignExists = true;
  state.recipients = [makeRecipient('r1')];
  state.events = [];
  state.selectLocks = [];
  state.setPayloads = [];
  state.executeQueries = [];
  state.cancelDuringRender = false;
  state.contactMutationDuringRender = null;
  state.failNextTerminalUpdate = false;
  renderMock.mockReset();
  renderMock.mockImplementation(async (element: { props: Record<string, unknown> }) => {
    if (state.cancelDuringRender) state.campaign.status = 'cancelled';
    if (state.contactMutationDuringRender === 'delete') {
      state.recipients[0]!.contactTargetId = null;
    } else if (state.contactMutationDuringRender === 'unsubscribe') {
      state.recipients[0]!.unsubscribedAt = new Date('2026-07-22T00:00:01Z');
    }
    return JSON.stringify(element.props);
  });
  sendRecipientMock.mockReset();
  waitForTurnMock.mockReset();
  waitForTurnMock.mockImplementation(async () => {
    state.events.push('rate-limit');
  });
  resolveAttachmentsMock.mockReset();
  resolveAttachmentsMock.mockResolvedValue(undefined);
  sendRecipientMock.mockImplementation(async (input: {
    recipient: { recipientId: string };
  }) => {
    state.events.push('send');
    return {
      kind: 'accepted',
      resendMessageId: `message-${input.recipient.recipientId}`,
    };
  });
});

describe('prepareCampaignDispatch campaign gate', () => {
  it('campaign 행 잠금 아래 상태 판정과 recipient 조회를 수행한다', async () => {
    state.campaign.status = 'queued';

    await expect(prepareCampaignDispatch('c1')).resolves.toEqual({ recipientIds: ['r1'] });

    expect(state.selectLocks[0]).toBe('mail_campaigns:update');
  });

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

  it('worker crash 뒤 보관된 캠페인에 ambiguous sending이 있으면 cleanup을 예약한다', async () => {
    state.campaign.archivedAt = new Date('2026-07-22T00:00:00Z');
    state.recipients = [makeRecipient('ambiguous', {
      status: 'sending',
      sendAttemptedAt: new Date('2026-07-21T23:59:00Z'),
      sendPayloadSnapshot: {
        from: 'Survey <noreply@mail.example.com>',
        replyTo: 'noreply@mail.example.com',
        to: 'ambiguous@example.com',
        subject: 'subject',
        html: 'persisted html',
        attachments: [],
      },
    })];

    await expect(prepareCampaignDispatch('c1')).resolves.toEqual({
      recipientIds: [],
      requiresCleanup: true,
    });
  });

  it('활성 캠페인의 non-archived queued recipient만 예약한다', async () => {
    state.campaign.status = 'queued';
    state.recipients.push(makeRecipient('archived', { archivedAt: new Date() }));

    await expect(prepareCampaignDispatch('c1')).resolves.toEqual({ recipientIds: ['r1'] });
    expect(state.campaign.status).toBe('sending');
  });

  it('발송 또는 복구할 recipient가 없으면 sending에 남기지 않고 즉시 종결한다', async () => {
    state.campaign.status = 'queued';
    state.recipients = [];

    await expect(prepareCampaignDispatch('c1')).resolves.toEqual({ recipientIds: [] });

    expect(state.campaign.status).toBe('completed');
    expect(state.executeQueries).toHaveLength(1);
  });
});

describe('retry exhaustion cleanup', () => {
  it('최종 retry 뒤 남은 queued와 stale sending을 failed로 종결한다', async () => {
    const now = new Date('2026-07-23T00:00:00Z');
    state.recipients = [
      makeRecipient('r-queued'),
      makeRecipient('r-stale', {
        status: 'sending',
        sendAttemptedAt: new Date('2026-07-22T00:00:00Z'),
        sendLeaseToken: null,
        sendLeaseExpiresAt: new Date('2026-07-22T00:01:00Z'),
      }),
    ];

    await expect(terminalizeUnresolvedCampaignDispatch('c1', now)).resolves.toEqual({
      terminalized: 2,
      busyUntil: null,
    });
    expect(state.recipients).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'r-queued', status: 'failed' }),
      expect.objectContaining({ id: 'r-stale', status: 'failed' }),
    ]));
  });

  it('아직 유효한 lease는 건드리지 않고 다음 cleanup 시각을 반환한다', async () => {
    const now = new Date('2026-07-23T00:00:00Z');
    const busyUntil = new Date('2026-07-23T00:00:30Z');
    state.recipients = [makeRecipient('busy', {
      status: 'sending',
      sendAttemptedAt: new Date('2026-07-22T00:00:00Z'),
      sendLeaseToken: '00000000-0000-4000-8000-000000000001',
      sendLeaseExpiresAt: busyUntil,
    })];

    await expect(terminalizeUnresolvedCampaignDispatch('c1', now)).resolves.toEqual({
      terminalized: 0,
      busyUntil: busyUntil.toISOString(),
    });
    expect(state.recipients[0]!.status).toBe('sending');
  });

  it.each([
    { label: '취소된', status: 'cancelled' as const, archivedAt: null },
    {
      label: '보관된',
      status: 'sending' as const,
      archivedAt: new Date('2026-07-22T12:00:00Z'),
    },
  ])('$label 캠페인도 ambiguous sending을 정리하되 활성 카운터를 바꾸지 않는다', async ({
    status,
    archivedAt,
  }) => {
    const now = new Date('2026-07-23T00:00:00Z');
    state.campaign.status = status;
    state.campaign.archivedAt = archivedAt;
    state.recipients = [makeRecipient('ambiguous', {
      status: 'sending',
      archivedAt,
      sendAttemptedAt: new Date('2026-07-22T00:00:00Z'),
      sendLeaseToken: null,
      sendLeaseExpiresAt: new Date('2026-07-22T00:01:00Z'),
      sendPayloadSnapshot: {
        from: 'Survey <noreply@mail.example.com>',
        replyTo: 'noreply@mail.example.com',
        to: 'ambiguous@example.com',
        subject: 'subject',
        html: 'persisted html',
        attachments: [],
      },
    })];

    await expect(terminalizeUnresolvedCampaignDispatch('c1', now)).resolves.toEqual({
      terminalized: 1,
      busyUntil: null,
    });
    expect(state.recipients[0]).toMatchObject({
      status: 'failed',
      errorReason: archivedAt === null
        ? '발송 작업의 최종 재시도까지 실패했습니다.'
        : null,
      sendAttemptedAt: null,
      sendLeaseToken: null,
      sendLeaseExpiresAt: null,
      sendPayloadSnapshot: null,
    });
    expect(state.setPayloads.filter((payload) => (
      'queuedCount' in payload || 'failedCount' in payload
    ))).toHaveLength(0);
    expect(state.executeQueries).toHaveLength(0);
  });

  it('inactive campaign의 message id가 복구된 sending은 sent로 확정하고 payload를 지운다', async () => {
    const now = new Date('2026-07-23T00:00:00Z');
    state.campaign.status = 'cancelled';
    state.recipients = [makeRecipient('accepted', {
      status: 'sending',
      resendMessageId: 'message-accepted',
      sendAttemptedAt: new Date('2026-07-22T00:00:00Z'),
      sendLeaseToken: null,
      sendLeaseExpiresAt: new Date('2026-07-22T00:01:00Z'),
      sendPayloadSnapshot: {
        from: 'Survey <noreply@mail.example.com>',
        replyTo: 'noreply@mail.example.com',
        to: 'accepted@example.com',
        subject: 'subject',
        html: 'persisted html',
        attachments: [],
      },
    })];

    await expect(terminalizeUnresolvedCampaignDispatch('c1', now)).resolves.toEqual({
      terminalized: 1,
      busyUntil: null,
    });
    expect(state.recipients[0]).toMatchObject({
      status: 'sent',
      resendMessageId: 'message-accepted',
      sendLeaseToken: null,
      sendLeaseExpiresAt: null,
      sendPayloadSnapshot: null,
    });
    expect(state.setPayloads.filter((payload) => (
      'queuedCount' in payload || 'sentCount' in payload
    ))).toHaveLength(0);
    expect(state.executeQueries).toHaveLength(0);
  });
});

describe('dispatchCampaignChunk 안전 발송', () => {
  it('prepare 뒤 recipient가 사라져 chunk 조회가 0행이면 campaign을 finalize한다', async () => {
    state.recipients = [];

    await expect(dispatchCampaignChunk('c1', ['missing'])).resolves.toEqual({
      sent: 0,
      failed: 0,
    });

    expect(state.campaign.status).toBe('completed');
    expect(state.executeQueries).toHaveLength(1);
  });

  it('worker crash 뒤 lease가 만료된 sending recipient를 같은 key로 복구한다', async () => {
    state.recipients = [makeRecipient('r1', {
      status: 'sending',
      sendAttemptedAt: new Date(Date.now() - 60_000),
      sendLeaseToken: '00000000-0000-4000-8000-000000000001',
      sendLeaseExpiresAt: new Date(Date.now() - 1_000),
      sendPayloadSnapshot: {
        from: 'Survey <noreply@mail.example.com>',
        replyTo: 'noreply@mail.example.com',
        to: 'r1@example.com',
        subject: 'subject',
        html: 'persisted html',
        attachments: [],
      },
    })];

    await expect(dispatchCampaignChunk('c1', ['r1'])).resolves.toEqual({
      sent: 1,
      failed: 0,
    });

    expect(sendRecipientMock).toHaveBeenCalledWith(expect.objectContaining({
      campaignId: 'c1',
      idempotencyKey: 'campaign/c1/recipient/r1',
      recipient: expect.objectContaining({ recipientId: 'r1' }),
    }));
    expect(state.recipients[0]).toMatchObject({
      status: 'sent',
      resendMessageId: 'message-r1',
    });
  });

  it('accepted send 뒤 DB 실패도 lease 만료 후 같은 key와 message id로 복구한다', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-22T00:00:00Z'));
    state.failNextTerminalUpdate = true;

    try {
      await expect(dispatchCampaignChunk('c1', ['r1'])).rejects.toThrow('db commit failed');

      state.recipients[0]!.emailSnapshot = 'changed@example.com';
      state.recipients[0]!.attrs = { name: 'changed' };
      state.recipients[0]!.inviteCode = 'changed-invite';
      state.recipients[0]!.unsubscribeToken = 'changed-unsubscribe';
      process.env['NEXT_PUBLIC_APP_URL'] = 'https://changed.example.com';
      process.env['RESEND_FROM_DOMAIN'] = 'changed.example.com';

      const retry = dispatchCampaignChunk('c1', ['r1']);
      await vi.advanceTimersByTimeAsync(30_001);

      await expect(retry).resolves.toEqual({ sent: 1, failed: 0 });
      expect(sendRecipientMock).toHaveBeenCalledTimes(2);
      expect(sendRecipientMock.mock.calls.map(([call]) => call.idempotencyKey)).toEqual([
        'campaign/c1/recipient/r1',
        'campaign/c1/recipient/r1',
      ]);
      expect(sendRecipientMock.mock.calls[1]![0]).toEqual(sendRecipientMock.mock.calls[0]![0]);
      expect(state.recipients[0]).toMatchObject({
        status: 'sent',
        resendMessageId: 'message-r1',
      });
      expect(state.setPayloads.filter((payload) => payload['status'] === 'sent')).toHaveLength(1);
    } finally {
      process.env['NEXT_PUBLIC_APP_URL'] = 'https://example.com';
      process.env['RESEND_FROM_DOMAIN'] = 'mail.example.com';
      vi.useRealTimers();
    }
  });

  it('알 수 없는 외부 오류는 lease만 해제해 throw하고 다음 retry가 같은 key로 재시도한다', async () => {
    sendRecipientMock.mockRejectedValueOnce(new Error('network reset'));

    await expect(dispatchCampaignChunk('c1', ['r1'])).rejects.toThrow('network reset');
    expect(state.recipients[0]).toMatchObject({
      status: 'sending',
      sendLeaseToken: null,
    });

    await expect(dispatchCampaignChunk('c1', ['r1'])).resolves.toEqual({
      sent: 1,
      failed: 0,
    });
    expect(sendRecipientMock.mock.calls.map(([call]) => call.idempotencyKey)).toEqual([
      'campaign/c1/recipient/r1',
      'campaign/c1/recipient/r1',
    ]);
  });

  it('retry 첨부 bytes가 최초 payload와 다르면 같은 key로 외부 호출하지 않는다', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-22T00:00:00Z'));
    state.failNextTerminalUpdate = true;
    state.campaign.attachmentsSnapshot = [{
      key: 'mail/file.pdf',
      filename: 'file.pdf',
      size: 2,
      mime: 'application/pdf',
    }];
    resolveAttachmentsMock
      .mockResolvedValueOnce([{
        filename: 'file.pdf',
        content: Buffer.from('v1'),
        contentType: 'application/pdf',
      }])
      .mockResolvedValueOnce([{
        filename: 'file.pdf',
        content: Buffer.from('v2'),
        contentType: 'application/pdf',
      }]);

    try {
      await expect(dispatchCampaignChunk('c1', ['r1'])).rejects.toThrow('db commit failed');

      const retry = dispatchCampaignChunk('c1', ['r1']);
      const rejection = expect(retry).rejects.toThrow(
        '첨부 파일이 최초 발송 payload와 달라 webhook 복구를 기다립니다.',
      );
      await vi.advanceTimersByTimeAsync(30_001);

      await rejection;
      expect(sendRecipientMock).toHaveBeenCalledTimes(1);
      expect(state.recipients[0]).toMatchObject({
        status: 'sending',
        sendLeaseToken: null,
        sendPayloadSnapshot: expect.objectContaining({
          attachments: [expect.objectContaining({ sha256: expect.any(String) })],
        }),
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('23시간 recovery cutoff를 지난 unresolved send는 재발송 없이 failed로 마감한다', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-22T23:00:00Z'));
    state.recipients = [makeRecipient('r1', {
      status: 'sending',
      sendAttemptedAt: new Date('2026-07-22T00:00:00Z'),
      sendLeaseToken: '00000000-0000-4000-8000-000000000001',
      sendLeaseExpiresAt: new Date('2026-07-22T00:01:00Z'),
    })];

    try {
      await expect(dispatchCampaignChunk('c1', ['r1'])).resolves.toEqual({
        sent: 0,
        failed: 1,
      });
      expect(sendRecipientMock).not.toHaveBeenCalled();
      expect(state.recipients[0]).toMatchObject({
        status: 'failed',
        sendLeaseToken: null,
        sendLeaseExpiresAt: null,
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('23시간 경계여도 살아 있는 lease를 먼저 기다린 뒤 terminalize한다', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-22T23:00:00Z'));
    state.recipients = [makeRecipient('r1', {
      status: 'sending',
      sendAttemptedAt: new Date('2026-07-22T00:00:00Z'),
      sendLeaseToken: '00000000-0000-4000-8000-000000000001',
      sendLeaseExpiresAt: new Date('2026-07-22T23:00:30Z'),
      sendPayloadSnapshot: {
        from: 'Survey <noreply@mail.example.com>',
        replyTo: 'noreply@mail.example.com',
        to: 'r1@example.com',
        subject: 'subject',
        html: 'persisted html',
        attachments: [],
      },
    })];

    try {
      const dispatch = dispatchCampaignChunk('c1', ['r1']);
      await vi.advanceTimersByTimeAsync(0);
      expect(state.recipients[0]!.status).toBe('sending');

      await vi.advanceTimersByTimeAsync(30_001);
      await expect(dispatch).resolves.toEqual({ sent: 0, failed: 1 });
      expect(sendRecipientMock).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('삭제된 캠페인은 예약 chunk에서 외부 발송 없이 종료한다', async () => {
    state.campaignExists = false;

    await expect(dispatchCampaignChunk('c1', ['r1'])).resolves.toEqual({
      sent: 0,
      failed: 0,
      cancelled: true,
    });
    expect(sendRecipientMock).not.toHaveBeenCalled();
  });

  it('첫 claim 전에 contact가 삭제된 queued recipient는 외부 발송 없이 failed로 종결한다', async () => {
    state.recipients = [makeRecipient('r1', { contactTargetId: null })];

    await expect(dispatchCampaignChunk('c1', ['r1'])).resolves.toEqual({
      sent: 0,
      failed: 1,
    });
    expect(sendRecipientMock).not.toHaveBeenCalled();
    expect(state.recipients[0]!.status).toBe('failed');
  });

  it.each([
    { mutation: 'delete' as const, status: 'failed' as const },
    { mutation: 'unsubscribe' as const, status: 'skipped_unsubscribed' as const },
  ])('outer load 뒤 contact $mutation 경합을 claim에서 다시 확인한다', async ({
    mutation,
    status,
  }) => {
    state.contactMutationDuringRender = mutation;

    await expect(dispatchCampaignChunk('c1', ['r1'])).resolves.toEqual({
      sent: 0,
      failed: mutation === 'delete' ? 1 : 0,
    });

    expect(sendRecipientMock).not.toHaveBeenCalled();
    expect(state.recipients[0]).toMatchObject({ status });
  });

  it('stale sending retry 중 contact가 수신거부되면 재발송 없이 복구 창을 유지한다', async () => {
    state.recipients = [makeRecipient('r1', {
      status: 'sending',
      unsubscribedAt: new Date('2026-07-22T00:00:00Z'),
      sendAttemptedAt: new Date(Date.now() - 60_000),
      sendLeaseToken: null,
      sendLeaseExpiresAt: new Date(Date.now() - 1_000),
      sendPayloadSnapshot: {
        from: 'Survey <noreply@mail.example.com>',
        replyTo: 'noreply@mail.example.com',
        to: 'r1@example.com',
        subject: 'subject',
        html: 'persisted html',
        attachments: [],
      },
    })];

    await expect(dispatchCampaignChunk('c1', ['r1'])).rejects.toThrow(
      'contact가 삭제 또는 수신거부되어 webhook 복구를 기다립니다.',
    );
    expect(sendRecipientMock).not.toHaveBeenCalled();
    expect(state.recipients[0]).toMatchObject({
      status: 'sending',
      sendPayloadSnapshot: expect.any(Object),
    });
  });

  it('archived in-flight snapshot이 scrub됐으면 webhook 복구 창을 위해 sending을 유지한다', async () => {
    state.recipients = [makeRecipient('r1', {
      status: 'sending',
      archivedAt: new Date('2026-07-22T00:00:00Z'),
      contactTargetId: null,
      emailSnapshot: null,
      sendAttemptedAt: new Date(Date.now() - 60_000),
      sendLeaseToken: null,
      sendLeaseExpiresAt: new Date(Date.now() - 1_000),
      sendPayloadSnapshot: null,
    })];

    await expect(dispatchCampaignChunk('c1', ['r1'])).rejects.toThrow(
      '발송 payload snapshot이 없어 webhook 복구를 기다립니다.',
    );
    expect(sendRecipientMock).not.toHaveBeenCalled();
    expect(state.recipients[0]!.status).toBe('sending');
  });

  it('archived sending의 복구 만료는 errorReason에 PII를 다시 쓰지 않는다', async () => {
    state.recipients = [makeRecipient('r1', {
      status: 'sending',
      archivedAt: new Date('2026-07-22T00:00:00Z'),
      contactTargetId: null,
      emailSnapshot: null,
      sendAttemptedAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
      sendLeaseToken: null,
      sendLeaseExpiresAt: new Date(Date.now() - 60_000),
      sendPayloadSnapshot: {
        from: 'Survey <noreply@mail.example.com>',
        replyTo: 'noreply@mail.example.com',
        to: 'private@example.com',
        subject: 'subject',
        html: 'persisted html',
        attachments: [],
      },
    })];

    await expect(dispatchCampaignChunk('c1', ['r1'])).resolves.toEqual({
      sent: 0,
      failed: 1,
    });
    expect(state.recipients[0]).toMatchObject({
      status: 'failed',
      errorReason: null,
      sendPayloadSnapshot: null,
    });
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
      expect(sendRecipientMock).not.toHaveBeenCalled();
    },
  );

  it('보관된 캠페인은 chunk에서 외부 발송하지 않는다', async () => {
    state.campaign.archivedAt = new Date('2026-07-22T00:00:00Z');

    await expect(dispatchCampaignChunk('c1', ['r1'])).resolves.toEqual({
      sent: 0,
      failed: 0,
      cancelled: true,
    });
    expect(sendRecipientMock).not.toHaveBeenCalled();
  });

  it('테스트 캠페인은 실제 invite와 sandbox unsubscribe 및 campaign footer를 쓴다', async () => {
    state.campaign.isTest = true;

    await dispatchCampaignChunk('c1', ['r1']);

    const html = sendRecipientMock.mock.calls[0]![0].recipient.html as string;
    expect(html).toContain('/i/invite-r1');
    expect(html).toContain('/unsubscribe/__test__');
    expect(html).toContain('campaign');
  });

  it('실제 캠페인의 invite, unsubscribe, footer 정책은 기존 동작을 유지한다', async () => {
    await dispatchCampaignChunk('c1', ['r1']);

    const html = sendRecipientMock.mock.calls[0]![0].recipient.html as string;
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

    expect(sendRecipientMock).toHaveBeenCalledTimes(1);
    expect(sendRecipientMock.mock.calls[0]![0].recipient).toEqual(
      expect.objectContaining({ recipientId: 'r1', to: 'r1@example.com' }),
    );
    expect(state.events).toEqual(['claim:r1', 'rate-limit', 'send']);
    expect(waitForTurnMock).toHaveBeenCalledOnce();
    expect(state.recipients.find((row) => row.id === 'archived')?.status).toBe('queued');
    expect(state.recipients.find((row) => row.id === 'no-email')?.status).toBe('failed');
  });

  it('campaign 재검사와 claim 사이 취소도 발송을 시작하지 않는다', async () => {
    state.cancelDuringRender = true;

    await expect(dispatchCampaignChunk('c1', ['r1'])).resolves.toEqual({
      sent: 0,
      failed: 0,
      cancelled: true,
    });
    expect(sendRecipientMock).not.toHaveBeenCalled();
    expect(state.recipients[0]?.status).toBe('queued');
  });

  it('동일 chunk가 동시에 실행돼도 claim된 recipient는 한 번만 발송한다', async () => {
    const results = await Promise.all([
      dispatchCampaignChunk('c1', ['r1']),
      dispatchCampaignChunk('c1', ['r1']),
    ]);

    expect(sendRecipientMock).toHaveBeenCalledTimes(1);
    expect(results.reduce((sum, result) => sum + result.sent, 0)).toBe(1);
    expect(state.setPayloads.filter((payload) => payload['status'] === 'sent')).toHaveLength(1);
  });

  it('claim 뒤 보관된 recipient는 결과를 저장하되 활성 campaign counter를 바꾸지 않는다', async () => {
    sendRecipientMock.mockImplementationOnce(async () => {
      state.recipients[0]!.archivedAt = new Date('2026-07-22T00:00:01Z');
      return { kind: 'accepted', resendMessageId: 'message-r1' };
    });

    await expect(dispatchCampaignChunk('c1', ['r1'])).resolves.toEqual({
      sent: 1,
      failed: 0,
    });

    expect(state.recipients[0]).toMatchObject({
      status: 'sent',
      resendMessageId: 'message-r1',
    });
    expect(state.setPayloads.filter((payload) => (
      'queuedCount' in payload || 'sentCount' in payload || 'failedCount' in payload
    ))).toHaveLength(0);
  });

  it('claim 뒤 보관된 recipient의 provider 오류는 errorReason에 PII를 다시 쓰지 않는다', async () => {
    sendRecipientMock.mockImplementationOnce(async () => {
      state.recipients[0]!.archivedAt = new Date('2026-07-22T00:00:01Z');
      state.recipients[0]!.errorReason = null;
      return {
        kind: 'permanent_failure',
        errorReason: 'private@example.com 주소가 거부되었습니다.',
      };
    });

    await expect(dispatchCampaignChunk('c1', ['r1'])).resolves.toEqual({
      sent: 0,
      failed: 1,
    });

    expect(state.recipients[0]).toMatchObject({
      status: 'failed',
      errorReason: null,
      sendPayloadSnapshot: null,
    });
  });

  it('sending 결과 전이가 중복 실행돼도 반환값과 terminal update는 한 번만 센다', async () => {
    sendRecipientMock.mockResolvedValueOnce({
      kind: 'permanent_failure',
      errorReason: 'invalid email',
    });

    const first = await dispatchCampaignChunk('c1', ['r1']);
    const retry = await dispatchCampaignChunk('c1', ['r1']);

    expect(first).toEqual({ sent: 0, failed: 1 });
    expect(retry).toEqual({ sent: 0, failed: 0, cancelled: true });
    expect(state.setPayloads.filter((payload) => payload['status'] === 'failed')).toHaveLength(1);
  });
});
