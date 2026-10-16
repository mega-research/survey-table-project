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
  insertedRecipients: Array<{ contactTargetId: string; emailSnapshot: string; emailColumnKey: string }>;
  // 1순위 주소(<id>@example.com)가 반송된 컨택 — 비어 있으면 "반송 없음".
  bouncedContactIds: string[];
  // 2순위 이메일 열(email2 = <id>-2@example.com)이 있는 컨택
  secondEmailContactIds: string[];
  // 1순위 칸 값을 직접 정한 컨택(여러 주소 칸 등)
  cellOverrides: Record<string, string>;
  // 그대로 반송 이력에 넣을 발송 스냅샷
  bouncedSnapshots: string[];
}

const state: FakeState = {
  contacts: [],
  negativeCodes: [],
  insertedRecipientContactIds: [],
  insertedRecipients: [],
  bouncedContactIds: [],
  secondEmailContactIds: [],
  cellOverrides: {},
  bouncedSnapshots: [],
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
      // notInArray(contactTargets.id, bouncedContactIds) 는 " not in " 리터럴 뒤에 배치되므로
      // (createCampaign 의 and(...) 절 순서 — 반송 제외가 마지막) 그 앞/뒤로 분리해 UUID 를
      // "선택된 id" 와 "반송 제외 id" 로 구분한다. notInArray 미포함 시(기존 케이스) split 은
      // 1-요소 배열이라 excludedIds 는 항상 빈 Set — 기존 동작 그대로 유지.
      const [beforeNotIn, ...afterNotInParts] = whereRaw.split(/not in/i);
      const excludedIds = new Set(afterNotInParts.join(' ').match(UUID_RE) ?? []);
      const uuids = (beforeNotIn ?? '').match(UUID_RE) ?? [];
      const surveyId = uuids[0] ?? null;
      const selectedIds = new Set(uuids.slice(1));
      const excludeByCode = whereExcludesByCode(whereRaw);
      const rows = state.contacts
        .filter((c) => c.surveyId === surveyId && selectedIds.has(c.id))
        .filter((c) => c.unsubscribedAt === null)
        .filter((c) => !(excludeByCode && isNegativeContact(c)))
        .filter((c) => !excludedIds.has(c.id))
        .flatMap((c) => {
          const row = (columnKey: string, local: string) => {
            const override = columnKey === 'email' ? state.cellOverrides[c.id] : undefined;
            return {
              id: c.id,
              columnKey,
              cipher: override !== undefined ? `raw:${override}` : `cipher:${local}`,
              blindIndex: blindIndex('email', override ?? `${local}@example.com`),
              inviteToken: `invite-${c.id}`,
            };
          };
          return state.secondEmailContactIds.includes(c.id)
            ? [row('email', c.id), row('email2', `${c.id}-2`)]
            : [row('email', c.id)];
        });
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

function buildSurveyScopeChain() {
  const chain: Record<string, unknown> = {
    from() {
      return chain;
    },
    where() {
      return chain;
    },
    for() {
      return Promise.resolve([{ enabled: false }]);
    },
  };
  return chain;
}

function buildSelectedTargetsChain() {
  const chain: Record<string, unknown> = {
    from() {
      return chain;
    },
    where(expr: unknown) {
      const raw = extractRawSql(expr);
      const uuids = raw.match(UUID_RE) ?? [];
      const surveyId = uuids[0] ?? null;
      const selectedIds = new Set(uuids.slice(1));
      return Promise.resolve(
        state.contacts
          .filter((contact) => contact.surveyId === surveyId && selectedIds.has(contact.id))
          .map((contact) => ({ id: contact.id, isTest: false })),
      );
    },
  };
  return chain;
}

const tx = {
  select(cols?: Record<string, unknown>) {
    if (cols === undefined) return buildTemplateChain();
    if ('enabled' in cols) return buildSurveyScopeChain();
    if ('isTest' in cols) return buildSelectedTargetsChain();
    return buildPiiSelectChain();
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
            const rec = r as { contactTargetId: string; emailSnapshot: string; emailColumnKey: string };
            state.insertedRecipients.push({
              contactTargetId: rec.contactTargetId,
              emailSnapshot: rec.emailSnapshot,
              emailColumnKey: rec.emailColumnKey,
            });
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
    // listBouncedContactIds 1단계 — mail_recipients 반송 이메일 조회.
    // state.bouncedContactIds 가 비어 있으면(기본값) 기존과 동일하게 "반송 없음"을
    // 반환한다. 값을 채우면 blind index 대조용 emailSnapshot 을 흉내내 non-empty 를
    // 시뮬레이션 — 실제 blind index 값은 2단계 select mock 이 직접 id 로 응답하므로
    // 이 문자열 자체의 정확성은 중요하지 않다.
    selectDistinct: vi.fn(() => ({
      from: () => ({
        innerJoin: () => ({
          where: () =>
            Promise.resolve([
              ...state.bouncedContactIds.map((id) => ({ emailSnapshot: `${id}@example.com` })),
              ...state.bouncedSnapshots.map((emailSnapshot) => ({ emailSnapshot })),
            ]),
        }),
      }),
    })),
    // listBouncedContactIds 2단계 — blind index 로 대조된 contact_targets.id 조회.
    select: vi.fn(() => ({
      from: () => ({
        where: () => Promise.resolve(state.bouncedContactIds.map((id) => ({ id }))),
      }),
    })),
  },
}));

vi.mock('@/lib/crypto/aes', () => ({
  // cipher:<id> → 유효한 이메일 문자열 복호화 시뮬레이션
  decryptPii: vi.fn((cipher: string) =>
    cipher.startsWith('raw:') ? cipher.slice('raw:'.length) : `${cipher.replace('cipher:', '')}@example.com`,
  ),
}));

vi.mock('@/lib/inngest/client', () => ({
  inngest: { send: vi.fn(async () => undefined) },
}));

// 발송 주소 순서는 컬럼 설정에서 읽는다 — 이 스위트는 순서 미지정(열 이름순)을 전제로 하고
// 스킴 조회 자체는 검증 대상이 아니다. 통 mock 대신 원본에 덮어써 import 체인 확장에 견딘다.
vi.mock('@/server/read-models/mail-email-order', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/server/read-models/mail-email-order')>()),
  loadMailEmailOrder: vi.fn(async () => null),
  loadMailEmailOrders: vi.fn(async () => ({ real: null, test: null })),
}));

vi.mock('@/server/read-models/result-code-statuses', async () => {
  const { mockBuildNegativeCodeExists } = await import('./_helpers/result-code-mock');
  return {
    getResultCodeStatuses: vi.fn(async () => ({
      positive: [] as string[],
      negative: state.negativeCodes,
    })),
    buildNegativeCodeExists: mockBuildNegativeCodeExists,
  };
});

import { blindIndex } from '@/lib/crypto/blind';
import { createCampaign } from '@/server/mail/services/campaigns';

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
    state.insertedRecipients = [];
    state.bouncedContactIds = [];
    state.secondEmailContactIds = [];
    state.cellOverrides = {};
    state.bouncedSnapshots = [];
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
      false,
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
      false,
    );

    // recipient 행은 1개만, skip 은 0 (phantom 없음)
    expect(state.insertedRecipientContactIds).toEqual([idValid]);
    expect(result.queuedCount).toBe(1);
    expect(result.skippedCount).toBe(0);
  });

  // 반송된 주소의 열은 건너뛰고 다음 순위 열로 넘어간다 — 보낼 열이 하나도 남지 않을 때만 빠진다
  // (2026-10-16 대체 발송과 함께 — 전에는 1순위 열이 반송이면 컨택을 통째로 뺐다).
  it('반송된 주소밖에 없는 컨택은 mail_recipients 에 포함되지 않는다', async () => {
    const idValid = seedContact();
    const idBounced = seedContact();
    state.bouncedContactIds = [idBounced];

    const result = await createCampaign(
      {
        surveyId: SURVEY_ID,
        mailTemplateId: '00000000-0000-4000-8000-000000000001',
        title: '반송 제외 캠페인',
        contactTargetIds: [idValid, idBounced],
      },
      USER_ID,
      false,
    );

    expect(state.insertedRecipientContactIds).toContain(idValid);
    expect(state.insertedRecipientContactIds).not.toContain(idBounced);
    expect(result.queuedCount).toBe(1);
    expect(result.skippedCount).toBe(1);
  });

  it('1순위 주소가 반송된 컨택은 2순위 열 주소로 보내고 쓴 열을 남긴다', async () => {
    const idBounced = seedContact();
    state.bouncedContactIds = [idBounced];
    state.secondEmailContactIds = [idBounced];

    const result = await createCampaign(
      {
        surveyId: SURVEY_ID,
        mailTemplateId: '00000000-0000-4000-8000-000000000001',
        title: '반송 다음 순위',
        contactTargetIds: [idBounced],
      },
      USER_ID,
      false,
    );

    expect(result.queuedCount).toBe(1);
    expect(state.insertedRecipients).toEqual([
      { contactTargetId: idBounced, emailSnapshot: `${idBounced}-2@example.com`, emailColumnKey: 'email2' },
    ]);
  });

  it('여러 주소 칸은 반송된 주소만 빼고 남은 주소로 보낸다 (2026-10-16 리뷰)', async () => {
    const id = seedContact();
    state.cellOverrides[id] = 'dead@x.com / live@x.com';
    state.bouncedSnapshots = ['dead@x.com'];

    await createCampaign(
      {
        surveyId: SURVEY_ID,
        mailTemplateId: '00000000-0000-4000-8000-000000000001',
        title: '여러 주소 칸 반송',
        contactTargetIds: [id],
      },
      USER_ID,
      false,
    );

    expect(state.insertedRecipients).toEqual([
      { contactTargetId: id, emailSnapshot: 'live@x.com', emailColumnKey: 'email' },
    ]);
  });

  it('여러 주소로 보낸 한 통의 반송은 그 칸에 든 주소를 하나하나 반송으로 확정하지 않는다', async () => {
    const id = seedContact();
    state.cellOverrides[id] = 'a@x.com';
    state.bouncedSnapshots = ['a@x.com / b@x.com'];

    await createCampaign(
      {
        surveyId: SURVEY_ID,
        mailTemplateId: '00000000-0000-4000-8000-000000000001',
        title: '묶음 반송',
        contactTargetIds: [id],
      },
      USER_ID,
      false,
    );

    expect(state.insertedRecipients).toEqual([
      { contactTargetId: id, emailSnapshot: 'a@x.com', emailColumnKey: 'email' },
    ]);
  });

  it('반송이 없으면 1순위 열 주소로 보내고 쓴 열을 남긴다', async () => {
    const id = seedContact();
    state.secondEmailContactIds = [id];

    await createCampaign(
      {
        surveyId: SURVEY_ID,
        mailTemplateId: '00000000-0000-4000-8000-000000000001',
        title: '기본 순위',
        contactTargetIds: [id],
      },
      USER_ID,
      false,
    );

    expect(state.insertedRecipients).toEqual([
      { contactTargetId: id, emailSnapshot: `${id}@example.com`, emailColumnKey: 'email' },
    ]);
  });

  // 정책(2026-08-13): 단건 발송은 관리자가 특정 컨택을 지목한 의도적 발송이므로
  // 반송 이력이 있어도 허용한다. kind='single' 이 반송 제외를 건너뛰지 않으면
  // validCount 0 으로 단건 발송 자체가 실패하는 회귀가 된다.
  it('kind=single 은 반송 이력이 있어도 발송을 허용한다', async () => {
    const idBounced = seedContact();
    state.bouncedContactIds = [idBounced];

    const result = await createCampaign(
      {
        surveyId: SURVEY_ID,
        mailTemplateId: '00000000-0000-4000-8000-000000000001',
        title: '단건: 반송 주소 재발송',
        contactTargetIds: [idBounced],
      },
      USER_ID,
      false,
      { kind: 'single' },
    );

    expect(state.insertedRecipientContactIds).toContain(idBounced);
    expect(result.queuedCount).toBe(1);
    expect(result.skippedCount).toBe(0);
  });
});
