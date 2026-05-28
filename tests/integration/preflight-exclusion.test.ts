import { describe, expect, it, beforeEach, vi } from 'vitest';
import { extractRawSql } from './_helpers/result-code-mock';

// ========================
// 모듈 모킹
// ========================
//
// preflightRecipients 는 다음에 의존한다:
// - @/db 의 drizzle client (db.select(...).from(contactTargets).where(...))
// - getResultCodeStatuses (surveys.contact_result_codes → negative codes)
//
// 진짜 PG 가 없는 vitest 환경에서 in-memory 시뮬레이터로 SELECT 결과를 합성한다.
// 한 행은 { id, unsubscribedAt, hasEmail, excludedByCode } 형태로,
// selectedContactIds 와 매칭되는 컨택만 반환한다.
//
// extractRawSql / mockBuildNegativeCodeExists 는 _helpers/result-code-mock 공통화.
// Task 4 (report-progress-exclusion) / Task 6 (invite-token-excluded) 과 동일
// 패턴 (mock + in-memory state) 을 따른다. 다만 preflightRecipients 는
// db.execute 가 아니라 query builder 체인을 쓰므로 select-체인 mock 으로 대응.

import { randomUUID } from 'crypto';

interface SeedContact {
  id: string;
  surveyId: string;
  unsubscribedAt: Date | null;
  hasEmail: boolean;
  attempts: string[];
}

interface FakeState {
  contacts: SeedContact[];
  negativeCodes: string[];
  lastSelectedIds: string[];
  lastSurveyId: string | null;
}

const state: FakeState = {
  contacts: [],
  negativeCodes: [],
  lastSelectedIds: [],
  lastSurveyId: null,
};

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

function isExcludedByCode(c: SeedContact): boolean {
  if (state.negativeCodes.length === 0) return false;
  return c.attempts.some((a) => state.negativeCodes.includes(a));
}

// db.select(...).from(...).where(...) 체인 — thenable 로 await 결과 합성
function buildSelectChain() {
  const chain = {
    from(_table: unknown) {
      return chain;
    },
    where(whereExpr: unknown) {
      const raw = extractRawSql(whereExpr);
      const uuids = raw.match(UUID_RE) ?? [];
      // 첫번째 UUID = surveyId, 나머지 = selectedContactIds
      const surveyId = uuids[0] ?? null;
      const selectedIds = uuids.slice(1);
      state.lastSurveyId = surveyId;
      state.lastSelectedIds = selectedIds;
      const idSet = new Set(selectedIds);
      const rows = state.contacts
        .filter((c) => c.surveyId === surveyId && idSet.has(c.id))
        .map((c) => ({
          id: c.id,
          unsubscribedAt: c.unsubscribedAt,
          hasEmail: c.hasEmail,
          excludedByCode: isExcludedByCode(c),
        }));
      return {
        then(resolve: (value: unknown) => unknown) {
          return Promise.resolve(rows).then(resolve);
        },
      };
    },
  };
  return chain;
}

vi.mock('@/db', () => ({
  db: {
    select: vi.fn(() => buildSelectChain()),
  },
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

import { preflightRecipients } from '@/lib/operations/campaigns.server';

const SURVEY_ID = '00000000-0000-4000-8000-000000000030';

interface SeedContactInput {
  withEmail?: boolean;
  unsubscribed?: boolean;
  attempts?: string[];
}

function seedContact(opts: SeedContactInput = {}): string {
  const id = randomUUID();
  state.contacts.push({
    id,
    surveyId: SURVEY_ID,
    unsubscribedAt: opts.unsubscribed ? new Date() : null,
    hasEmail: !!opts.withEmail,
    attempts: opts.attempts ?? [],
  });
  return id;
}

describe('preflightRecipients — excludedByCode 분기', () => {
  beforeEach(() => {
    state.contacts = [];
    state.negativeCodes = ['수신거부'];
    state.lastSelectedIds = [];
    state.lastSurveyId = null;
  });

  it('negative 코드 ct → excludedByCodeIds 에 들어감', async () => {
    const idValid = seedContact({ withEmail: true });
    const idExcluded = seedContact({ withEmail: true, attempts: ['수신거부'] });
    const result = await preflightRecipients({
      surveyId: SURVEY_ID,
      selectedContactIds: [idValid, idExcluded],
    });
    expect(result.validIds).toEqual([idValid]);
    expect(result.excludedByCodeIds).toEqual([idExcluded]);
    expect(result.unsubscribedIds).toEqual([]);
    expect(result.emailMissingIds).toEqual([]);
    expect(result.notFoundIds).toEqual([]);
  });

  it('unsubscribed_at 우선 — 동시 마킹 시 unsubscribed 으로 분류', async () => {
    const id = seedContact({
      withEmail: true,
      unsubscribed: true,
      attempts: ['수신거부'],
    });
    const result = await preflightRecipients({
      surveyId: SURVEY_ID,
      selectedContactIds: [id],
    });
    expect(result.unsubscribedIds).toEqual([id]);
    expect(result.excludedByCodeIds).toEqual([]);
    expect(result.validIds).toEqual([]);
    expect(result.emailMissingIds).toEqual([]);
  });

  it('email 누락 + negative 코드 → excludedByCode 우선', async () => {
    const id = seedContact({ attempts: ['수신거부'] });
    const result = await preflightRecipients({
      surveyId: SURVEY_ID,
      selectedContactIds: [id],
    });
    expect(result.excludedByCodeIds).toEqual([id]);
    expect(result.emailMissingIds).toEqual([]);
    expect(result.validIds).toEqual([]);
    expect(result.unsubscribedIds).toEqual([]);
  });
});
