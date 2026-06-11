import { describe, expect, it, beforeEach, vi } from 'vitest';
import { extractRawSql } from './_helpers/result-code-mock';

// ========================
// 모듈 모킹
// ========================
//
// preflightRecipients 는 다음에 의존한다:
// - @/db 의 drizzle client
//     1) db.select(...).from(contactTargets).where(...)  — 1차 분류 (unsub/code/hasEmail)
//     2) db.select(...).from(contactPii).where(...).orderBy(...)  — email cipher 복호화 검증
// - getResultCodeStatuses (surveys.contact_result_codes → negative codes)
// - decryptPii (@/lib/crypto/aes) — cipher 평문 복호화
//
// 진짜 PG 가 없는 vitest 환경에서 in-memory 시뮬레이터로 SELECT 결과를 합성한다.
// 1차 쿼리는 { id, unsubscribedAt, hasEmail, excludedByCode } 형태로,
// 2차 쿼리는 { contactTargetId, columnKey, cipher } 형태로 합성한다.
// cipher 는 mock decryptPii 가 그대로 평문으로 되돌리는 sentinel 값을 쓴다.
//
// extractRawSql / mockBuildNegativeCodeExists 는 _helpers/result-code-mock 공통화.

import { randomUUID } from 'crypto';

interface SeedContact {
  id: string;
  surveyId: string;
  unsubscribedAt: Date | null;
  hasEmail: boolean; // contact_pii email row 존재 여부 (EXISTS 기준)
  emailPlain: string | null; // cipher 복호화 결과 평문. null = 복호화 throw 시뮬레이션
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

// mock decryptPii sentinel — cipher 는 "PLAIN:<평문>" 또는 "THROW" 로 인코딩한다.
const CIPHER_THROW = 'THROW';
function cipherFor(plain: string | null): string {
  return plain === null ? CIPHER_THROW : `PLAIN:${plain}`;
}

function isExcludedByCode(c: SeedContact): boolean {
  if (state.negativeCodes.length === 0) return false;
  return c.attempts.some((a) => state.negativeCodes.includes(a));
}

// 1차 쿼리(contact_targets) where → { id, unsubscribedAt, hasEmail, excludedByCode } 행 합성
function resolveTargetRows(whereExpr: unknown): unknown[] {
  const raw = extractRawSql(whereExpr);
  const uuids = raw.match(UUID_RE) ?? [];
  // 첫번째 UUID = surveyId, 나머지 = selectedContactIds
  const surveyId = uuids[0] ?? null;
  const selectedIds = uuids.slice(1);
  state.lastSurveyId = surveyId;
  state.lastSelectedIds = selectedIds;
  const idSet = new Set(selectedIds);
  return state.contacts
    .filter((c) => c.surveyId === surveyId && idSet.has(c.id))
    .map((c) => ({
      id: c.id,
      unsubscribedAt: c.unsubscribedAt,
      hasEmail: c.hasEmail,
      excludedByCode: isExcludedByCode(c),
    }));
}

// 2차 쿼리(contact_pii) where → { contactTargetId, columnKey, cipher } 행 합성.
// hasEmail=true 인 컨택만 contact_pii row 가 존재한다고 본다.
function resolvePiiRows(whereExpr: unknown): unknown[] {
  const raw = extractRawSql(whereExpr);
  const uuids = raw.match(UUID_RE) ?? [];
  const idSet = new Set(uuids);
  return state.contacts
    .filter((c) => idSet.has(c.id) && c.hasEmail)
    .map((c) => ({
      contactTargetId: c.id,
      columnKey: 'email',
      cipher: cipherFor(c.emailPlain),
    }));
}

// db.select(...).from(...).where(...)[.orderBy(...)] 체인 — thenable 로 await 결과 합성.
// from(table) 의 이름으로 1차/2차 쿼리를 구분한다.
function buildSelectChain() {
  let isPii = false;
  let rows: unknown[] = [];
  const chain = {
    from(table: unknown) {
      const name = tableName(table);
      isPii = name.includes('contact_pii');
      return chain;
    },
    where(whereExpr: unknown) {
      rows = isPii ? resolvePiiRows(whereExpr) : resolveTargetRows(whereExpr);
      const thenable = {
        orderBy() {
          return thenable;
        },
        then(resolve: (value: unknown) => unknown) {
          return Promise.resolve(rows).then(resolve);
        },
      };
      return thenable;
    },
  };
  return chain;
}

// drizzle table 객체에서 SQL 식별 이름 추출 (Symbol 키 사용).
function tableName(table: unknown): string {
  if (table == null || typeof table !== 'object') return '';
  const sym = Object.getOwnPropertySymbols(table).find((s) =>
    s.description?.includes('Name'),
  );
  if (sym) {
    const v = (table as Record<symbol, unknown>)[sym];
    if (typeof v === 'string') return v;
  }
  return '';
}

vi.mock('@/db', () => ({
  db: {
    select: vi.fn(() => buildSelectChain()),
  },
}));

vi.mock('@/lib/crypto/aes', () => ({
  decryptPii: vi.fn((token: string) => {
    if (token === CIPHER_THROW) throw new Error('decrypt failed');
    if (token.startsWith('PLAIN:')) return token.slice('PLAIN:'.length);
    throw new Error('unknown cipher');
  }),
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
  emailPlain?: string | null; // 미지정이면 withEmail 시 'a@b.com'
  unsubscribed?: boolean;
  attempts?: string[];
}

function seedContact(opts: SeedContactInput = {}): string {
  const id = randomUUID();
  const withEmail = !!opts.withEmail;
  const emailPlain = withEmail
    ? opts.emailPlain === undefined
      ? 'a@b.com'
      : opts.emailPlain
    : null;
  state.contacts.push({
    id,
    surveyId: SURVEY_ID,
    unsubscribedAt: opts.unsubscribed ? new Date() : null,
    hasEmail: withEmail,
    emailPlain,
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

describe('preflightRecipients — cipher 복호화 검증 (valid 과대보고 방지)', () => {
  beforeEach(() => {
    state.contacts = [];
    state.negativeCodes = [];
    state.lastSelectedIds = [];
    state.lastSurveyId = null;
  });

  it('email PII row 는 있으나 cipher 가 빈 문자열로 복호화되면 emailMissing 으로 분류', async () => {
    // contact_pii row 존재(EXISTS=true) 하지만 평문이 '' 인 컨택.
    // createCampaign 은 이 컨택을 발송 대상에서 제외하므로 preflight 도 valid 가 아니어야 한다.
    const idEmptyCipher = seedContact({ withEmail: true, emailPlain: '' });
    const idOk = seedContact({ withEmail: true, emailPlain: 'real@x.com' });
    const result = await preflightRecipients({
      surveyId: SURVEY_ID,
      selectedContactIds: [idEmptyCipher, idOk],
    });
    expect(result.validIds).toEqual([idOk]);
    expect(result.emailMissingIds).toEqual([idEmptyCipher]);
    expect(result.excludedByCodeIds).toEqual([]);
    expect(result.unsubscribedIds).toEqual([]);
    expect(result.notFoundIds).toEqual([]);
  });

  it('cipher 가 공백만으로 복호화되면 emailMissing 으로 분류', async () => {
    const idWhitespace = seedContact({ withEmail: true, emailPlain: '   ' });
    const result = await preflightRecipients({
      surveyId: SURVEY_ID,
      selectedContactIds: [idWhitespace],
    });
    expect(result.emailMissingIds).toEqual([idWhitespace]);
    expect(result.validIds).toEqual([]);
  });

  it('cipher 복호화가 throw 하면(키 미스매치/손상) emailMissing 으로 분류', async () => {
    const idCorrupt = seedContact({ withEmail: true, emailPlain: null });
    const result = await preflightRecipients({
      surveyId: SURVEY_ID,
      selectedContactIds: [idCorrupt],
    });
    expect(result.emailMissingIds).toEqual([idCorrupt]);
    expect(result.validIds).toEqual([]);
  });

  it('정상 cipher 는 valid 로 분류', async () => {
    const id = seedContact({ withEmail: true, emailPlain: 'good@x.com' });
    const result = await preflightRecipients({
      surveyId: SURVEY_ID,
      selectedContactIds: [id],
    });
    expect(result.validIds).toEqual([id]);
    expect(result.emailMissingIds).toEqual([]);
  });
});
