import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import { renderToStaticMarkup } from 'react-dom/server';

interface TargetSeed {
  id: string;
  isTest: boolean;
}

interface TestState {
  surveyMode: boolean;
  targets: TargetSeed[];
  campaignValues: Record<string, unknown> | null;
  recipientIds: string[];
  executeQueries: Array<{ sql: string; params: unknown[] }>;
  surveyShareLocks: number;
}

const state: TestState = {
  surveyMode: false,
  targets: [],
  campaignValues: null,
  recipientIds: [],
  executeQueries: [],
  surveyShareLocks: 0,
};

const dialect = new PgDialect();

function queryRows(rows: () => unknown[]) {
  let resolvedRows = rows;
  const chain = {
    from: () => chain,
    innerJoin: () => chain,
    where: (where: unknown) => {
      const query = dialect.sqlToQuery(where as never);
      if (query.sql.includes('contact_targets') && query.sql.includes('is_test')) {
        const requestedScope = query.params.find((param) => typeof param === 'boolean');
        resolvedRows = () => rows().filter((row) => {
          if (!row || typeof row !== 'object' || !('isTest' in row)) return true;
          return row.isTest === requestedScope;
        });
      }
      return chain;
    },
    orderBy: () => Promise.resolve(resolvedRows()),
    limit: () => Promise.resolve(resolvedRows()),
    for: async (mode: string) => {
      if (mode === 'share') state.surveyShareLocks += 1;
      return resolvedRows();
    },
    then: <T>(resolve: (value: unknown[]) => T) => Promise.resolve(resolvedRows()).then(resolve),
  };
  return chain;
}

const tx = {
  select(projection?: Record<string, unknown>) {
    if (!projection) {
      return queryRows(() => [{
        id: '00000000-0000-4000-8000-000000000001',
        subject: '설문 참여',
        bodyHtml: '<p>body</p>',
        fromLocal: 'noreply',
        fromName: 'sender',
        replyTo: null,
        attachments: [],
      }]);
    }
    if ('enabled' in projection) {
      return queryRows(() => [{ enabled: state.surveyMode }]);
    }
    if ('isTest' in projection) {
      return queryRows(() => state.targets.map((target) => ({ ...target })));
    }
    return queryRows(() => state.targets.map((target) => ({
      ...target,
      columnKey: 'email',
      cipher: `cipher:${target.id}`,
      inviteToken: '00000000-0000-4000-8000-000000000099',
    })));
  },
  execute(query: unknown) {
    state.executeQueries.push(dialect.sqlToQuery(query as never));
    return Promise.resolve([{ next_id: 1 }]);
  },
  insert() {
    return {
      values(values: Record<string, unknown> | Array<Record<string, unknown>>) {
        const rows = Array.isArray(values) ? values : [values];
        const campaign = rows.find((row) => 'runNumber' in row);
        if (campaign) state.campaignValues = campaign;
        for (const row of rows) {
          if (typeof row['contactTargetId'] === 'string') {
            state.recipientIds.push(row['contactTargetId']);
          }
        }
        return {
          returning: () => Promise.resolve([{ id: 'campaign-1' }]),
          then: <T>(resolve: (value: undefined) => T) => Promise.resolve(undefined).then(resolve),
        };
      },
    };
  },
  update() {
    return { set: () => ({ where: () => Promise.resolve(undefined) }) };
  },
};

vi.mock('@/db', () => ({
  db: {
    transaction: vi.fn(async (callback: (transaction: typeof tx) => Promise<unknown>) => callback(tx)),
    update: vi.fn(() => ({ set: () => ({ where: () => Promise.resolve(undefined) }) })),
  },
}));

vi.mock('@/lib/crypto/aes', () => ({
  decryptPii: vi.fn((cipher: string) => `${cipher.slice('cipher:'.length)}@example.com`),
}));

vi.mock('@/lib/inngest/client', () => ({
  inngest: { send: vi.fn(async () => undefined) },
}));

vi.mock('@/lib/operations/result-code-statuses.server', () => ({
  getResultCodeStatuses: vi.fn(async () => ({ positive: [], negative: [] })),
  buildNegativeCodeExists: vi.fn(() => ({ queryChunks: [] })),
}));

import { createCampaign } from '@/features/mail/server/services/mail-campaigns.service';
import { CampaignsList } from '@/components/operations/mail-campaign/campaigns-list';

const SURVEY_ID = '00000000-0000-4000-8000-000000000040';
const USER_ID = '00000000-0000-4000-8000-0000000000ff';
const REAL_ID = '00000000-0000-4000-8000-000000000010';
const TEST_ID = '00000000-0000-4000-8000-000000000011';

function input(contactTargetIds: string[], title = '1차 안내') {
  return {
    surveyId: SURVEY_ID,
    mailTemplateId: '00000000-0000-4000-8000-000000000001',
    title,
    contactTargetIds,
  };
}

describe('테스트 모드 메일 캠페인 생성', () => {
  beforeEach(() => {
    state.surveyMode = false;
    state.targets = [];
    state.campaignValues = null;
    state.recipientIds = [];
    state.executeQueries = [];
    state.surveyShareLocks = 0;
    vi.clearAllMocks();
  });

  it('현재 테스트 모드를 잠그고 테스트 대상자·회차·제목 스냅샷을 같은 scope로 저장한다', async () => {
    state.surveyMode = true;
    state.targets = [{ id: TEST_ID, isTest: true }];

    await createCampaign(input([TEST_ID]), USER_ID);

    expect(state.surveyShareLocks).toBe(1);
    expect(state.executeQueries[0]?.sql).toContain('next_campaign_run_number');
    expect(state.executeQueries[0]?.params).toContain(true);
    expect(state.campaignValues).toMatchObject({
      isTest: true,
      title: '[TEST] 1차 안내',
      subjectSnapshot: '[TEST] 설문 참여',
    });
    expect(state.recipientIds).toEqual([TEST_ID]);
  });

  it('작성 중 테스트 모드가 꺼지면 테스트 대상을 실제 캠페인으로 강등하지 않고 거부한다', async () => {
    state.surveyMode = false;
    state.targets = [{ id: TEST_ID, isTest: true }];

    await expect(createCampaign(input([TEST_ID]), USER_ID)).rejects.toThrow('화면을 새로고침');
    expect(state.campaignValues).toBeNull();
    expect(state.recipientIds).toEqual([]);
  });

  it('현재 scope와 다른 대상자가 하나라도 섞이면 전체 생성을 거부한다', async () => {
    state.surveyMode = true;
    state.targets = [
      { id: TEST_ID, isTest: true },
      { id: REAL_ID, isTest: false },
    ];

    await expect(createCampaign(input([TEST_ID, REAL_ID]), USER_ID)).rejects.toThrow(
      '화면을 새로고침',
    );
    expect(state.campaignValues).toBeNull();
  });

  it('실제 모드는 기존 제목을 유지하고 실제 scope 회차를 사용한다', async () => {
    state.targets = [{ id: REAL_ID, isTest: false }];

    await createCampaign(input([REAL_ID]), USER_ID);

    expect(state.executeQueries[0]?.params).toContain(false);
    expect(state.campaignValues).toMatchObject({
      isTest: false,
      title: '1차 안내',
      subjectSnapshot: '설문 참여',
    });
    expect(state.recipientIds).toEqual([REAL_ID]);
  });

  it('[TEST] 접두어가 이미 있으면 중복하지 않는다', async () => {
    state.surveyMode = true;
    state.targets = [{ id: TEST_ID, isTest: true }];

    await createCampaign(input([TEST_ID], ' [TEST] 1차 안내 '), USER_ID);

    expect(state.campaignValues?.['title']).toBe('[TEST] 1차 안내');
    expect(state.campaignValues?.['subjectSnapshot']).toBe('[TEST] 설문 참여');
  });
});

describe('테스트 캠페인 목록', () => {
  it('campaign에만 테스트 배지를 표시하고 공유 템플릿에는 붙이지 않는다', () => {
    const html = renderToStaticMarkup(
      CampaignsList({
        surveyId: SURVEY_ID,
        rows: [{
          id: 'campaign-1',
          runNumber: 1,
          isTest: true,
          title: '[TEST] 1차 안내',
          status: 'queued',
          mailTemplateId: '00000000-0000-4000-8000-000000000001',
          templateName: '설문 참여',
          recipientCount: 1,
          queuedCount: 1,
          sentCount: 0,
          deliveredCount: 0,
          openedCount: 0,
          bouncedCount: 0,
          complainedCount: 0,
          failedCount: 0,
          skippedUnsubscribedCount: 0,
          startedAt: null,
          completedAt: null,
          createdAt: new Date('2026-07-22T00:00:00Z'),
          createdBy: USER_ID,
        } as never],
        total: 1,
        page: 1,
        pageSize: 20,
      }),
    );

    expect(html).toContain('>테스트</span>');
    expect(html).toContain('템플릿: 설문 참여');
    expect(html).not.toContain('템플릿: 테스트');
  });
});
