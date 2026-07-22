import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';

import {
  archiveTestMailForTargets,
  archiveTestWorkspaceMail,
} from '@/lib/mail/test-mail-archive.server';
import { deleteContactTarget } from '@/features/contacts/server/services/contact-targets.service';

type RecipientStatus =
  | 'queued'
  | 'sending'
  | 'sent'
  | 'delivered'
  | 'opened'
  | 'bounced'
  | 'complained'
  | 'failed'
  | 'skipped_unsubscribed';

interface RecipientState {
  id: string;
  campaignId: string;
  contactTargetId: string | null;
  status: RecipientStatus;
  emailSnapshot: string | null;
  inviteTokenSnapshot: string | null;
  errorReason: string | null;
  archivedAt: Date | null;
  resendMessageId: string | null;
  sendAttemptedAt: Date | null;
  sendLeaseToken: string | null;
  sendLeaseExpiresAt: Date | null;
  sendPayloadSnapshot: Record<string, unknown> | null;
}

interface CampaignState {
  id: string;
  surveyId: string;
  isTest: boolean;
  mailTemplateId: string | null;
  title: string;
  subjectSnapshot: string;
  bodyHtmlSnapshot: string;
  fromLocalSnapshot: string;
  fromNameSnapshot: string;
  replyToSnapshot: string | null;
  attachmentsSnapshot: unknown[];
  filterSnapshot: Record<string, unknown>;
  createdBy: string | null;
  status: string;
  archivedAt: Date | null;
  recipientCount: number;
  queuedCount: number;
  sentCount: number;
  deliveredCount: number;
  openedCount: number;
  bouncedCount: number;
  complainedCount: number;
  failedCount: number;
  skippedUnsubscribedCount: number;
}

interface ContactState {
  id: string;
  surveyId: string;
  isTest: boolean;
}

interface ResponseState {
  id: string;
  surveyId: string;
  contactTargetId: string | null;
  isTest: boolean;
}

const dialect = new PgDialect();
const state: {
  recipients: RecipientState[];
  campaigns: CampaignState[];
  contacts: ContactState[];
  responses: ResponseState[];
  survey: {
    id: string;
    testModeEnabled: boolean;
    contactColumns: null;
    testContactColumns: { version: number; headerRow: number; columns: unknown[] } | null;
  };
  events: string[];
} = {
  recipients: [],
  campaigns: [],
  contacts: [],
  responses: [],
  survey: {
    id: 'survey-1',
    testModeEnabled: true,
    contactColumns: null,
    testContactColumns: { version: 1, headerRow: 1, columns: [] },
  },
  events: [],
};

function tableName(table: { [key: symbol]: unknown }): string {
  return Reflect.get(table, Symbol.for('drizzle:Name')) as string;
}

function compiled(query: unknown): { sql: string; params: unknown[] } {
  return dialect.sqlToQuery(query as never);
}

function includesParam(query: unknown, value: unknown): boolean {
  return compiled(query).params.includes(value);
}

function asRecords<T>(rows: T[]): Array<Record<string, unknown>> {
  return rows as unknown as Array<Record<string, unknown>>;
}

function filterRows(name: string, query: unknown | null): Array<Record<string, unknown>> {
  if (name === 'surveys') {
    return !query || includesParam(query, state.survey.id) ? [state.survey] : [];
  }
  if (name === 'mail_campaigns') {
    return asRecords(state.campaigns.filter((row) => {
      if (!query) return true;
      const { sql, params } = compiled(query);
      const campaignParams = state.campaigns.map((campaign) => campaign.id).filter((id) => params.includes(id));
      if (campaignParams.length > 0 && !campaignParams.includes(row.id)) return false;
      if (sql.includes('"survey_id"') && params.includes(state.survey.id) && row.surveyId !== state.survey.id) {
        return false;
      }
      if (sql.includes('"is_test"')) {
        const scope = params.find((value): value is boolean => typeof value === 'boolean');
        if (scope !== undefined && row.isTest !== scope) return false;
      }
      return true;
    }));
  }
  if (name === 'contact_targets') {
    return asRecords(state.contacts.filter((row) => {
      if (!query) return true;
      const { sql, params } = compiled(query);
      if (sql.includes('"contact_targets"."id"') && params.some((value) => (
        typeof value === 'string' && state.contacts.some((contact) => contact.id === value)
      )) && !params.includes(row.id)) return false;
      if (sql.includes('"survey_id"') && params.includes(state.survey.id) && row.surveyId !== state.survey.id) {
        return false;
      }
      if (sql.includes('"is_test"')) {
        const scope = params.find((value): value is boolean => typeof value === 'boolean');
        if (scope !== undefined && row.isTest !== scope) return false;
      }
      return true;
    }));
  }
  if (name === 'survey_responses') {
    return asRecords(state.responses.filter((row) => {
      if (!query) return true;
      const { sql, params } = compiled(query);
      if (sql.includes('"survey_id"') && params.includes(state.survey.id) && row.surveyId !== state.survey.id) {
        return false;
      }
      if (sql.includes('"contact_target_id"')) {
        const targetIds = state.contacts.map((contact) => contact.id).filter((id) => params.includes(id));
        if (targetIds.length > 0 && (row.contactTargetId === null || !targetIds.includes(row.contactTargetId))) {
          return false;
        }
      }
      if (sql.includes('"is_test"')) {
        const scope = params.find((value): value is boolean => typeof value === 'boolean');
        if (scope !== undefined && row.isTest !== scope) return false;
      }
      return true;
    }));
  }
  if (name !== 'mail_recipients') return [];

  return asRecords(state.recipients.filter((row) => {
    if (!query) return true;
    const { sql, params } = compiled(query);
    if (sql.includes('"contact_target_id"') && row.contactTargetId !== null) {
      const targetParams = state.contacts.map((contact) => contact.id).filter((id) => params.includes(id));
      if (targetParams.length > 0 && !targetParams.includes(row.contactTargetId)) return false;
    }
    if (sql.includes('"campaign_id"')) {
      const campaignParams = state.campaigns.map((campaign) => campaign.id).filter((id) => params.includes(id));
      if (campaignParams.length > 0 && !campaignParams.includes(row.campaignId)) return false;
    }
    if (sql.includes('"mail_recipients"."id"')) {
      const recipientParams = state.recipients.map((recipient) => recipient.id).filter((id) => params.includes(id));
      if (recipientParams.length > 0 && !recipientParams.includes(row.id)) return false;
    }
    if (sql.includes('"archived_at" is null') && row.archivedAt !== null) return false;
    return true;
  }));
}

function project(
  rows: Array<Record<string, unknown>>,
  selection?: Record<string, unknown>,
): Array<Record<string, unknown>> {
  if (!selection) return rows.map((row) => ({ ...row }));
  return rows.map((row) => Object.fromEntries(
    Object.keys(selection).map((key) => [
      key,
      key === 'enabled' ? row['testModeEnabled'] : row[key],
    ]),
  ));
}

function makeTx() {
  const select = (selection?: Record<string, unknown>) => {
    let name = '';
    let query: unknown | null = null;
    const resolveRows = () => project(filterRows(name, query), selection);
    const chain = {
      from(table: { [key: symbol]: unknown }) {
        name = tableName(table);
        return chain;
      },
      where(next: unknown) {
        query = next;
        return chain;
      },
      orderBy() {
        return chain;
      },
      for(mode: string) {
        state.events.push(`lock:${name}:${mode}`);
        return Promise.resolve(resolveRows());
      },
      then<T>(resolve: (rows: Array<Record<string, unknown>>) => T) {
        return Promise.resolve(resolveRows()).then(resolve);
      },
    };
    return chain;
  };

  const update = (table: { [key: symbol]: unknown }) => {
    const name = tableName(table);
    let payload: Record<string, unknown> = {};
    let query: unknown | null = null;
    let applied = false;
    let result: Array<Record<string, unknown>> = [];
    const apply = () => {
      if (applied) return result;
      applied = true;
      const rows = filterRows(name, query);
      for (const row of rows) Object.assign(row, payload);
      result = rows.map((row) => ({ ...row }));
      return result;
    };
    const terminal = {
      returning: async () => apply(),
      then<T>(resolve: (rows: Array<Record<string, unknown>>) => T) {
        return Promise.resolve(apply()).then(resolve);
      },
    };
    return {
      set(next: Record<string, unknown>) {
        payload = next;
        return {
          where(nextQuery: unknown) {
            query = nextQuery;
            return terminal;
          },
        };
      },
    };
  };

  const deleteRows = (table: { [key: symbol]: unknown }) => {
    const name = tableName(table);
    return {
      where(query: unknown) {
        const rows = filterRows(name, query);
        if (name === 'mail_recipients') {
          const ids = new Set(rows.map((row) => row['id']));
          state.recipients = state.recipients.filter((row) => !ids.has(row.id));
        } else if (name === 'contact_targets') {
          const ids = new Set(rows.map((row) => row['id']));
          state.contacts = state.contacts.filter((row) => !ids.has(row.id));
        } else if (name === 'survey_responses') {
          const ids = new Set(rows.map((row) => row['id']));
          state.responses = state.responses.filter((row) => !ids.has(row.id));
        } else if (name === 'mail_campaigns') {
          const ids = new Set(rows.map((row) => row['id']));
          state.campaigns = state.campaigns.filter((row) => !ids.has(row.id));
          state.recipients = state.recipients.filter((row) => !ids.has(row.campaignId));
        }
        return {
          returning: async () => rows,
          then<T>(resolve: (value: unknown) => T) {
            return Promise.resolve(undefined).then(resolve);
          },
        };
      },
    };
  };

  const execute = async (query: unknown) => {
    const campaign = state.campaigns.find((row) => includesParam(query, row.id));
    if (!campaign) return [];
    if (compiled(query).sql.includes('SET status = CASE')) {
      if (
        campaign.status === 'sending'
        && campaign.archivedAt === null
        && campaign.queuedCount === 0
        && campaign.sentCount === 0
      ) {
        campaign.status = (
          campaign.bouncedCount + campaign.failedCount + campaign.complainedCount > 0
            ? 'partial'
            : 'completed'
        );
      }
      state.events.push(`finalize:${campaign.id}`);
      return [];
    }
    const active = state.recipients.filter(
      (row) => row.campaignId === campaign.id && row.archivedAt === null,
    );
    Object.assign(campaign, {
      recipientCount: active.length,
      queuedCount: active.filter((row) => row.status === 'queued' || row.status === 'sending').length,
      sentCount: active.filter((row) => row.status === 'sent').length,
      deliveredCount: active.filter((row) => row.status === 'delivered').length,
      openedCount: active.filter((row) => row.status === 'opened').length,
      bouncedCount: active.filter((row) => row.status === 'bounced').length,
      complainedCount: active.filter((row) => row.status === 'complained').length,
      failedCount: active.filter((row) => row.status === 'failed').length,
      skippedUnsubscribedCount: active.filter((row) => row.status === 'skipped_unsubscribed').length,
    });
    state.events.push(`recalculate:${campaign.id}`);
    return [];
  };

  return { select, update, delete: deleteRows, execute };
}

vi.mock('@/db', () => ({
  db: {
    transaction: vi.fn(async (callback: (tx: ReturnType<typeof makeTx>) => Promise<unknown>) => (
      callback(makeTx())
    )),
  },
}));

function recipient(
  id: string,
  status: RecipientStatus,
  overrides: Partial<RecipientState> = {},
): RecipientState {
  return {
    id,
    campaignId: 'campaign-test',
    contactTargetId: 'target-test',
    status,
    emailSnapshot: `${id}@example.com`,
    inviteTokenSnapshot: '00000000-0000-0000-0000-000000000001',
    errorReason: 'provider detail',
    archivedAt: null,
    resendMessageId: null,
    sendAttemptedAt: null,
    sendLeaseToken: null,
    sendLeaseExpiresAt: null,
    sendPayloadSnapshot: null,
    ...overrides,
  };
}

beforeEach(() => {
  state.survey.testModeEnabled = true;
  state.survey.testContactColumns = { version: 1, headerRow: 1, columns: [] };
  state.contacts = [{ id: 'target-test', surveyId: 'survey-1', isTest: true }];
  state.responses = [{
    id: 'response-test',
    surveyId: 'survey-1',
    contactTargetId: 'target-test',
    isTest: true,
  }];
  state.campaigns = [{
    id: 'campaign-test',
    surveyId: 'survey-1',
    isTest: true,
    mailTemplateId: 'template-1',
    title: '테스트 발송 원본',
    subjectSnapshot: '개인화 제목',
    bodyHtmlSnapshot: '<p>개인화 본문</p>',
    fromLocalSnapshot: 'qa',
    fromNameSnapshot: '테스트 담당자',
    replyToSnapshot: 'qa@example.com',
    attachmentsSnapshot: [{ key: 'private.pdf' }],
    filterSnapshot: { targetIds: ['target-test'] },
    createdBy: '00000000-0000-0000-0000-000000000099',
    status: 'sending',
    archivedAt: null,
    recipientCount: 3,
    queuedCount: 2,
    sentCount: 1,
    deliveredCount: 0,
    openedCount: 0,
    bouncedCount: 0,
    complainedCount: 0,
    failedCount: 0,
    skippedUnsubscribedCount: 0,
  }];
  state.recipients = [
    recipient('queued', 'queued'),
    recipient('sent', 'sent', { resendMessageId: 'message-sent' }),
    recipient('inflight', 'sending', {
      sendAttemptedAt: new Date('2026-07-22T00:00:00Z'),
      sendLeaseToken: '00000000-0000-0000-0000-000000000010',
      sendLeaseExpiresAt: new Date('2026-07-22T00:00:30Z'),
      sendPayloadSnapshot: { to: 'inflight@example.com', html: '<p>PII</p>' },
    }),
  ];
  state.events = [];
});

describe('test mail archive lifecycle', () => {
  it('queued는 삭제하고 sent는 즉시 scrub하되 sending recovery snapshot은 terminal 전까지 보존한다', async () => {
    const tx = makeTx();

    await archiveTestMailForTargets(tx as never, ['target-test']);

    expect(state.recipients.find((row) => row.id === 'queued')).toBeUndefined();
    expect(state.recipients.find((row) => row.id === 'sent')).toMatchObject({
      contactTargetId: null,
      emailSnapshot: null,
      inviteTokenSnapshot: null,
      errorReason: null,
      archivedAt: expect.any(Date),
      sendAttemptedAt: null,
      sendLeaseToken: null,
      sendLeaseExpiresAt: null,
      sendPayloadSnapshot: null,
    });
    expect(state.recipients.find((row) => row.id === 'inflight')).toMatchObject({
      contactTargetId: null,
      emailSnapshot: null,
      inviteTokenSnapshot: null,
      errorReason: null,
      archivedAt: expect.any(Date),
      sendLeaseToken: '00000000-0000-0000-0000-000000000010',
      sendPayloadSnapshot: { to: 'inflight@example.com', html: '<p>PII</p>' },
    });
    expect(state.campaigns[0]).toMatchObject({
      status: 'completed',
      recipientCount: 0,
      queuedCount: 0,
      sentCount: 0,
    });
    expect(state.events).toEqual([
      'lock:mail_campaigns:update',
      'lock:contact_targets:update',
      'lock:mail_recipients:update',
      'recalculate:campaign-test',
      'finalize:campaign-test',
    ]);
  });

  it('개별 테스트 대상자 삭제는 메일 archive 뒤 테스트 응답과 target을 hard delete한다', async () => {
    await deleteContactTarget({ surveyId: 'survey-1', id: 'target-test' });

    expect(state.contacts).toEqual([]);
    expect(state.responses).toEqual([]);
    expect(state.recipients.map((row) => row.id)).toEqual(['sent', 'inflight']);
    expect(state.recipients.every((row) => (
      row.contactTargetId === null && row.emailSnapshot === null && row.archivedAt !== null
    ))).toBe(true);
    expect(state.survey.testContactColumns).toEqual({ version: 1, headerRow: 1, columns: [] });
  });

  it('실제 대상자 삭제는 기존 cascade 의미대로 mail recipient를 지우고 응답은 보존한다', async () => {
    state.survey.testModeEnabled = false;
    state.contacts = [{ id: 'target-actual', surveyId: 'survey-1', isTest: false }];
    state.responses = [{
      id: 'response-actual',
      surveyId: 'survey-1',
      contactTargetId: 'target-actual',
      isTest: false,
    }];
    state.campaigns[0]!.id = 'campaign-actual';
    state.recipients = [
      recipient('actual-sent', 'sent', {
        campaignId: 'campaign-actual',
        contactTargetId: 'target-actual',
        resendMessageId: 'message-actual',
      }),
    ];

    await deleteContactTarget({ surveyId: 'survey-1', id: 'target-actual' });

    expect(state.contacts).toEqual([]);
    expect(state.recipients).toEqual([]);
    expect(state.responses).toEqual([expect.objectContaining({
      id: 'response-actual',
      contactTargetId: null,
      isTest: false,
    })]);
  });

  it('workspace archive는 미보존 campaign을 지우고 보존 campaign snapshot을 비식별화한다', async () => {
    state.campaigns.push({
      ...state.campaigns[0]!,
      id: 'campaign-drop',
      title: '삭제할 초안',
      status: 'queued',
      recipientCount: 1,
      queuedCount: 1,
      sentCount: 0,
    });
    state.recipients.push(recipient('drop-queued', 'queued', {
      campaignId: 'campaign-drop',
    }));

    await archiveTestWorkspaceMail(makeTx() as never, 'survey-1');

    expect(state.campaigns.find((row) => row.id === 'campaign-drop')).toBeUndefined();
    expect(state.recipients.find((row) => row.id === 'drop-queued')).toBeUndefined();
    expect(state.campaigns.find((row) => row.id === 'campaign-test')).toMatchObject({
      mailTemplateId: null,
      title: '삭제된 테스트 발송',
      subjectSnapshot: '',
      bodyHtmlSnapshot: '',
      fromLocalSnapshot: '',
      fromNameSnapshot: '',
      replyToSnapshot: null,
      attachmentsSnapshot: [],
      filterSnapshot: {},
      createdBy: null,
      status: 'cancelled',
      archivedAt: expect.any(Date),
      recipientCount: 0,
      queuedCount: 0,
      sentCount: 0,
    });
    expect(state.recipients.find((row) => row.id === 'sent')).toMatchObject({
      archivedAt: expect.any(Date),
      sendPayloadSnapshot: null,
    });
    expect(state.recipients.find((row) => row.id === 'inflight')).toMatchObject({
      archivedAt: expect.any(Date),
      sendPayloadSnapshot: { to: 'inflight@example.com', html: '<p>PII</p>' },
    });
  });
});
