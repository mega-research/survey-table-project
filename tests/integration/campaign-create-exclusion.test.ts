import { beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'crypto';

import { extractRawSql } from './_helpers/result-code-mock';

// ========================
// 회귀 테스트 — createCampaign 재페치 WHERE 가 preflight 와 동일하게
// 부정 결과코드(연락금지) 컨택을 제외하는지 검증한다.
//
// 버그(H4): 재페치 WHERE 가 unsubscribed_at IS NULL 만 보고 negative code 를
// 누락 → preflight 는 제외 보고하나 실제로는 mail_recipients 가 생성되어 발송됨.
//
// 진짜 PG 가 없는 vitest 환경이므로 transaction/query builder 를 in-memory
// 시뮬레이터로 대체한다. contactTargets 재페치의 .where() raw SQL 에 negative
// code EXISTS 가 들어있을 때만 해당 컨택을 결과에서 제외해, 수정 전에는 negative
// 컨택이 recipients 로 새어 들어가도록(=red) 시뮬레이션한다.
// ========================

interface SeedContact {
  id: string;
  surveyId: string;
  unsubscribedAt: Date | null;
  attempts: string[];
}

interface FakeState {
  contacts: SeedContact[];
  negativeCodes: string[];
  insertedRecipientContactIds: string[];
}

const state: FakeState = {
  contacts: [],
  negativeCodes: [],
  insertedRecipientContactIds: [],
};

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

// 재페치 WHERE 에 negative code EXISTS 가 포함됐는지 — 실 PG 라면 이 조건이 있을 때만
// 부정코드 컨택이 결과에서 빠진다. 미포함 시(수정 전) 모든 컨택이 통과한다.
function whereExcludesByCode(raw: string): boolean {
  return /contact_attempts/i.test(raw) && /result_code/i.test(raw);
}

function isNegativeContact(c: SeedContact): boolean {
  if (state.negativeCodes.length === 0) return false;
  return c.attempts.some((a) => state.negativeCodes.includes(a));
}

// tx.select(...).from(...).innerJoin(...).where(...).orderBy(...) 체인 — thenable 결과 합성
function buildPiiSelectChain() {
  let whereRaw = '';
  const chain: Record<string, unknown> = {
    from() {
      return chain;
    },
    innerJoin() {
      return chain;
    },
    where(expr: unknown) {
      whereRaw = extractRawSql(expr);
      return chain;
    },
    orderBy() {
      const uuids = whereRaw.match(UUID_RE) ?? [];
      const surveyId = uuids[0] ?? null;
      const selectedIds = new Set(uuids.slice(1));
      const excludeByCode = whereExcludesByCode(whereRaw);
      const rows = state.contacts
        .filter((c) => c.surveyId === surveyId && selectedIds.has(c.id))
        .filter((c) => c.unsubscribedAt === null)
        .filter((c) => !(excludeByCode && isNegativeContact(c)))
        .map((c) => ({
          id: c.id,
          columnKey: 'email',
          cipher: `cipher:${c.id}`,
          inviteToken: `invite-${c.id}`,
        }));
      return Promise.resolve(rows);
    },
  };
  return chain;
}

// template fetch 체인 — select().from().where().limit()
function buildTemplateChain() {
  const chain: Record<string, unknown> = {
    from() {
      return chain;
    },
    where() {
      return chain;
    },
    limit() {
      return Promise.resolve([
        {
          id: 'template-1',
          subject: 'subject',
          bodyHtml: '<p>body</p>',
          fromLocal: 'noreply',
          fromName: 'sender',
          replyTo: null,
          attachments: [],
        },
      ]);
    },
  };
  return chain;
}

const tx = {
  select(cols?: unknown) {
    // cols 인자 유무로 template(인자 없음) vs piiJoined(컬럼 명시) 구분
    return cols === undefined ? buildTemplateChain() : buildPiiSelectChain();
  },
  execute() {
    return Promise.resolve([{ next_id: 1 }]);
  },
  insert() {
    return {
      values(rows: Array<{ contactTargetId?: string }> | { contactTargetId?: string }) {
        const arr = Array.isArray(rows) ? rows : [rows];
        // mail_recipients insert 만 추적 (contactTargetId 보유 행)
        for (const r of arr) {
          if (r && typeof r === 'object' && 'contactTargetId' in r && r.contactTargetId) {
            state.insertedRecipientContactIds.push(r.contactTargetId);
          }
        }
        return {
          returning() {
            return Promise.resolve([{ id: 'campaign-1' }]);
          },
          then(resolve: (v: unknown) => unknown) {
            return Promise.resolve(undefined).then(resolve);
          },
        };
      },
    } as Record<string, unknown>;
  },
  update() {
    return {
      set() {
        return {
          where() {
            return Promise.resolve(undefined);
          },
        };
      },
    };
  },
};

vi.mock('@/db', () => ({
  db: {
    transaction: vi.fn(async (cb: (t: typeof tx) => Promise<unknown>) => cb(tx)),
    update: vi.fn(() => ({
      set: () => ({ where: () => Promise.resolve(undefined) }),
    })),
  },
}));

vi.mock('@/lib/crypto/aes', () => ({
  // cipher:<id> → 유효한 이메일 문자열 복호화 시뮬레이션
  decryptPii: vi.fn((cipher: string) => `${cipher.replace('cipher:', '')}@example.com`),
}));

vi.mock('@/lib/inngest/client', () => ({
  inngest: { send: vi.fn(async () => undefined) },
}));

vi.mock('@/lib/operations/result-code-statuses.server', async () => {
  const { mockBuildNegativeCodeExists } = await import('./_helpers/result-code-mock');
  return {
    getResultCodeStatuses: vi.fn(async () => ({
      positive: [] as string[],
      negative: state.negativeCodes,
    })),
    buildNegativeCodeExists: mockBuildNegativeCodeExists,
  };
});

import { createCampaign } from '@/features/mail/server/services/mail-campaigns.service';

const SURVEY_ID = '00000000-0000-4000-8000-000000000040';
const USER_ID = '00000000-0000-4000-8000-0000000000ff';

function seedContact(opts: { unsubscribed?: boolean; attempts?: string[] } = {}): string {
  const id = randomUUID();
  state.contacts.push({
    id,
    surveyId: SURVEY_ID,
    unsubscribedAt: opts.unsubscribed ? new Date() : null,
    attempts: opts.attempts ?? [],
  });
  return id;
}

describe('createCampaign — 부정 결과코드 컨택 제외 (preflight 동기화)', () => {
  beforeEach(() => {
    state.contacts = [];
    state.negativeCodes = ['수신거부'];
    state.insertedRecipientContactIds = [];
    vi.clearAllMocks();
  });

  it('negative 코드 컨택은 mail_recipients 에 포함되지 않는다', async () => {
    const idValid = seedContact();
    const idExcluded = seedContact({ attempts: ['수신거부'] });

    const result = await createCampaign(
      {
        surveyId: SURVEY_ID,
        mailTemplateId: '00000000-0000-4000-8000-000000000001',
        title: '테스트 캠페인',
        contactTargetIds: [idValid, idExcluded],
      },
      USER_ID,
    );

    // valid 1명만 큐잉, negative 1명은 skip
    expect(state.insertedRecipientContactIds).toContain(idValid);
    expect(state.insertedRecipientContactIds).not.toContain(idExcluded);
    expect(result.queuedCount).toBe(1);
    expect(result.skippedCount).toBe(1);
  });

  // 회귀(L71): 중복 선택 ID 가 들어와도 recipientCount/skippedCount 가 부풀려지지 않아야 한다.
  // 실제 recipient 행은 SQL IN + seen Set 으로 dedupe 되므로, 카운터도 unique 기준이어야
  // phantom skipped(존재하지 않는 컨택)나 inflated recipientCount 가 생기지 않는다.
  it('중복 선택 ID 는 dedupe 되어 skippedCount/queuedCount 가 부풀려지지 않는다', async () => {
    const idValid = seedContact();

    const result = await createCampaign(
      {
        surveyId: SURVEY_ID,
        mailTemplateId: '00000000-0000-4000-8000-000000000001',
        title: '중복 선택 캠페인',
        // 동일 UUID 2회 — 위저드 선택 상태 버그 등으로 중복 유입 시나리오
        contactTargetIds: [idValid, idValid],
      },
      USER_ID,
    );

    // recipient 행은 1개만, skip 은 0 (phantom 없음)
    expect(state.insertedRecipientContactIds).toEqual([idValid]);
    expect(result.queuedCount).toBe(1);
    expect(result.skippedCount).toBe(0);
  });
});
