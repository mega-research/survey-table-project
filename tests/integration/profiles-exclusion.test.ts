import { describe, expect, it, beforeEach, vi } from 'vitest';
import { extractRawSql } from './_helpers/result-code-mock';

// ========================
// 모듈 모킹
// ========================
//
// listResponsesForProfiles 는 다음에 의존한다:
// - @/db 의 drizzle client
//   * db.select(...).from(surveyResponses).where(...).as('numbered')   ← base subquery
//   * db.select({ total: count(*) }).from(numbered).where?(...)        ← count query
//   * db.select({ ... }).from(numbered).where?(...).orderBy(...).limit(...).offset(...) ← data query
// - getResultCodeStatuses (Task 11 신규 추가)
//
// 진짜 PG 가 없는 vitest 환경에서 in-memory 시뮬레이터로 SELECT 결과를 합성한다.
// base subquery 가 평가될 때 surveyId / view / NOT EXISTS (negative+unsubscribed)
// 술어를 JS 로 적용하고 row_number(idx) 를 부여한 다음, count/data 쿼리는 그 결과를
// 재사용 (필터/정렬/페이징은 본 task 와 무관하므로 base 결과 그대로 반환).
//
// Task 9 (preflight-exclusion) 의 select-체인 mock 패턴을 차용하되,
// `.as('numbered')` subquery 분기를 추가했다.

import { randomUUID } from 'crypto';

interface SeedResponse {
  id: string;
  surveyId: string;
  contactTargetId: string | null;
  startedAt: Date;
  deletedAt: Date | null;
  isTest: boolean;
}

interface SeedContact {
  id: string;
  surveyId: string;
  resid: number;
  attrs: Record<string, string>;
  unsubscribedAt: Date | null;
  negativeAttempts: string[];
  piiBlindIndexes: Record<string, string>;
  isTest: boolean;
}

interface FakeState {
  responses: SeedResponse[];
  contacts: SeedContact[];
  negativeCodes: string[];
  hasSurveyScopedLeftJoin: boolean;
  /** base subquery 실행 결과 — count/data 쿼리가 재사용 */
  numberedRows: NumberedRow[];
}

interface NumberedRow {
  id: string;
  idx: number;
  platform: string | null;
  browser: string | null;
  status: string;
  currentStepId: string | null;
  startedAt: Date;
  completedAt: Date | null;
  totalSeconds: number | null;
  /** ct LEFT JOIN 컬럼 — 테스트 시드는 group_value 를 다루지 않으므로 항상 null */
  groupValue: string | null;
  contactResid: number | null;
  contactAttrs: Record<string, string> | null;
  contactTargetId: string | null;
  isTest: boolean;
}

const state: FakeState = {
  responses: [],
  contacts: [],
  negativeCodes: [],
  hasSurveyScopedLeftJoin: false,
  numberedRows: [],
};

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

function isExcludedContact(ct: SeedContact): boolean {
  if (ct.unsubscribedAt != null) return true;
  if (state.negativeCodes.length === 0) return false;
  return ct.negativeAttempts.some((a) => state.negativeCodes.includes(a));
}

function objectContainsString(value: unknown, needle: string, seen = new Set<object>()): boolean {
  if (typeof value === 'string') return value.toLowerCase().includes(needle);
  if (value == null || typeof value !== 'object') return false;
  if (seen.has(value)) return false;
  seen.add(value);
  const obj = value as object;
  return Object.getOwnPropertyNames(obj).some((key) => {
    if (key.toLowerCase().includes(needle)) return true;
    return objectContainsString((obj as Record<string, unknown>)[key], needle, seen);
  });
}

function objectStringCount(value: unknown, needle: string, seen = new Set<object>()): number {
  if (typeof value === 'string') return value.toLowerCase().includes(needle) ? 1 : 0;
  if (value == null || typeof value !== 'object') return 0;
  if (seen.has(value)) return 0;
  seen.add(value);
  const obj = value as object;
  return Object.getOwnPropertyNames(obj).reduce((count, key) => {
    const keyHit = key.toLowerCase().includes(needle) ? 1 : 0;
    return count + keyHit + objectStringCount((obj as Record<string, unknown>)[key], needle, seen);
  }, 0);
}

/**
 * base subquery 실행 시뮬레이터.
 * WHERE 의 raw SQL 에 NOT EXISTS + contact_targets 가 보일 때만
 * negative/unsubscribed ct 의 응답을 가린다 (= 실제 구현 변경에 정직하게 fail).
 * 익명 (contact_target_id IS NULL) 은 NOT EXISTS 자동 통과.
 */
function evaluateBaseSubquery(
  surveyId: string,
  view: 'active' | 'deleted',
  hasExcludeFilter: boolean,
  hasScopeMatchedExclusionTarget: boolean,
  isTestScope: boolean,
): NumberedRow[] {
  const contactById = new Map(state.contacts.map((c) => [c.id, c]));
  const filtered = state.responses
    .filter((r) => r.surveyId === surveyId)
    .filter((r) => (view === 'deleted' ? r.deletedAt != null : r.deletedAt == null))
    .filter((r) => r.isTest === isTestScope)
    .filter((r) => {
      if (!hasExcludeFilter) return true;             // 구현 전 — 모두 노출
      if (r.contactTargetId == null) return true;     // 익명 → NOT EXISTS true → 통과
      const ct = contactById.get(r.contactTargetId);
      if (ct == null) return true;                    // FK 깨짐 → NOT EXISTS true → 통과
      if (
        hasScopeMatchedExclusionTarget &&
        (ct.surveyId !== r.surveyId || ct.isTest !== r.isTest)
      ) {
        return true;
      }
      return !isExcludedContact(ct);                  // negative ct → 가림
    })
    .sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime());
  return filtered.map((r, i) => {
    const ct =
      r.contactTargetId == null ? null : (contactById.get(r.contactTargetId) ?? null);
    const joinedCt =
      ct != null &&
      (!state.hasSurveyScopedLeftJoin ||
        (ct.surveyId === r.surveyId && ct.isTest === r.isTest))
        ? ct
        : null;
    return {
      id: r.id,
      idx: i + 1,
      platform: null,
      browser: null,
      status: 'in_progress',
      currentStepId: null,
      startedAt: r.startedAt,
      completedAt: null,
      totalSeconds: null,
      groupValue: null,
      contactResid: joinedCt?.resid ?? null,
      contactAttrs: joinedCt?.attrs ?? null,
      contactTargetId: joinedCt?.id ?? null,
      isTest: r.isTest,
    };
  });
}

// ----------------------------------------------------------------
// drizzle select 체인 mock
// ----------------------------------------------------------------
//
// 패턴 1 (base subquery): db.select({...}).from(surveyResponses).where(...).as('numbered')
//   → as() 가 호출되면 base 결과 캐시 + numbered 식별자 객체 반환
//
// 패턴 2 (count): db.select({ total: ... }).from(numbered)            ← thenable
//   db.select({ total: ... }).from(numbered).where(...)
//
// 패턴 3 (data): db.select({...}).from(numbered).where?(...).orderBy(...).limit(...).offset(...)
//
// where/orderBy/limit/offset 은 본 task 의 검증 범위 밖이므로 그대로 흘려보낸다.

interface NumberedSubqueryMarker {
  __isNumbered: true;
}

function isNumberedMarker(table: unknown): table is NumberedSubqueryMarker {
  return (
    table != null &&
    typeof table === 'object' &&
    '__isNumbered' in (table as Record<string, unknown>) &&
    (table as Record<string, unknown>)['__isNumbered'] === true
  );
}

function buildSelectChain(selection: Record<string, unknown>) {
  // 어떤 패턴인지는 from() 시점에 결정 가능
  let isBaseSubquery = false;

  const chain = {
    from(table: unknown) {
      if (isNumberedMarker(table)) {
        // 패턴 2/3 — 이미 evaluated base subquery 결과 사용
        return buildCountOrDataChain(selection);
      }
      // 패턴 1 — surveyResponses 테이블 대상 base subquery
      isBaseSubquery = true;
      return chain;
    },
    // ct LEFT JOIN — exclusion/idx 동작에 영향 없는 pass-through
    leftJoin(_table: unknown, on: unknown) {
      state.hasSurveyScopedLeftJoin = objectStringCount(on, 'survey_id') >= 2;
      return chain;
    },
    where(whereExpr: unknown) {
      if (!isBaseSubquery) return chain;
      // base subquery WHERE 평가
      const raw = extractRawSql(whereExpr);
      const uuids = raw.match(UUID_RE) ?? [];
      const surveyId = uuids[0] ?? '';
      const lowered = raw.toLowerCase();
      // deleted view 는 "deleted_at IS NOT NULL" — column 이름까지 보고 판별
      // (NOT EXISTS 추가 후 "unsubscribed_at IS NOT NULL" 도 raw 에 들어가므로 구분 필요)
      const view: 'active' | 'deleted' = /deleted_at[^a-z_]*is not null/i.test(raw)
        ? 'deleted'
        : 'active';
      // 실제 구현이 NOT EXISTS 한 줄 추가하면 비로소 가림 효과 발생
      const hasExcludeFilter =
        lowered.includes('not exists') && lowered.includes('contact_targets');
      const hasScopeMatchedExclusionTarget =
        raw.includes('ct.survey_id =') && raw.includes('ct.is_test =');
      const isTestScope = lowered.includes('true');
      state.numberedRows = evaluateBaseSubquery(
        surveyId,
        view,
        hasExcludeFilter,
        hasScopeMatchedExclusionTarget,
        isTestScope,
      );
      return chain;
    },
    as(_alias: string): NumberedSubqueryMarker {
      // 끝 — caller 가 이 marker 를 numbered 변수에 저장.
      // numbered.id, numbered.idx 등 컬럼 참조는 selectKey lookup 용 메타로만 사용되므로
      // 평가 시점에 marker 만 있으면 충분 (selection 으로 받은 후 다시 lookup).
      return { __isNumbered: true };
    },
  };
  return chain;
}

function buildCountOrDataChain(selection: Record<string, unknown>) {
  const isCount = 'total' in selection;
  const baseRows = state.numberedRows;

  function applyOuterWhere(rows: NumberedRow[], whereExpr: unknown): NumberedRow[] {
    const raw = extractRawSql(whereExpr).toLowerCase();

    // T11 테스트 필터 — eq(numbered.isTest, true|false). 이 mock 은 numbered 를
    // `{ __isNumbered: true }` marker 로만 반환해(패턴 1 as() 참조) numbered.isTest 컬럼
    // 참조가 undefined 로 날아가므로 "is_test" 컬럼명 텍스트는 raw 에 남지 않는다.
    // eq() 의 bound boolean 리터럴(true/false)은 extractRawSql 이 그대로 stringify 하므로
    // 그 리터럴 존재 여부로 판별한다 — 이 쿼리 체계에서 bare boolean 을 만드는 조건은
    // is_test 필터뿐이라 안전하다(문자열/숫자 조건은 별도 분기에서 처리).
    let narrowed = rows;
    if (raw.includes('true')) {
      narrowed = narrowed.filter((row) => row.isTest);
    } else if (raw.includes('false')) {
      narrowed = narrowed.filter((row) => !row.isTest);
    }

    if (raw.includes('contact_pii')) {
      return narrowed.filter((row) => {
        if (row.contactTargetId == null) return false;
        const ct = state.contacts.find((c) => c.id === row.contactTargetId);
        if (!ct) return false;
        return Object.entries(ct.piiBlindIndexes).some(
          ([columnKey, blindIndex]) =>
            raw.includes(columnKey.toLowerCase()) &&
            raw.includes(blindIndex.toLowerCase()),
        );
      });
    }

    if (raw.includes('contact_resid') || raw.includes('resid')) {
      const numbers = raw.match(/\b\d+\b/g)?.map((n) => Number(n)) ?? [];
      if (numbers.length === 0) return narrowed;
      return narrowed.filter(
        (row) => row.contactResid != null && numbers.includes(row.contactResid),
      );
    }

    if (objectContainsString(whereExpr, 'contact_resid')) {
      const numbers = raw.match(/\b\d+\b/g)?.map((n) => Number(n)) ?? [];
      if (numbers.length === 0) return narrowed;
      return narrowed.filter(
        (row) => row.contactResid != null && numbers.includes(row.contactResid),
      );
    }

    const numbers = raw.match(/\b\d+\b/g)?.map((n) => Number(n)) ?? [];
    if (numbers.length > 0) {
      return narrowed.filter(
        (row) => row.contactResid != null && numbers.includes(row.contactResid),
      );
    }

    return narrowed;
  }

  const dataChain = {
    rows: baseRows,
    where(_w: unknown) {
      dataChain.rows = applyOuterWhere(baseRows, _w);
      return dataChain;
    },
    orderBy(..._args: unknown[]) {
      return dataChain;
    },
    limit(_n: number) {
      return dataChain;
    },
    offset(_n: number) {
      return dataChain;
    },
    then(resolve: (value: unknown) => unknown) {
      // data query 결과 — base rows 그대로 반환 (필터/페이징 mock 생략)
      return Promise.resolve(dataChain.rows).then(resolve);
    },
  };

  if (isCount) {
    return {
      where(w: unknown) {
        const rows = applyOuterWhere(baseRows, w);
        return {
          then(resolve: (value: unknown) => unknown) {
            return Promise.resolve([{ total: rows.length }]).then(resolve);
          },
        };
      },
      then(resolve: (value: unknown) => unknown) {
        return Promise.resolve([{ total: baseRows.length }]).then(resolve);
      },
    };
  }

  return dataChain;
}

vi.mock('@/db', () => ({
  db: {
    select: vi.fn((selection?: Record<string, unknown>) =>
      buildSelectChain(selection ?? {}),
    ),
    execute: vi.fn((query: unknown) => {
      const raw = extractRawSql(query);
      const response = state.responses.find((candidate) => raw.includes(candidate.id));
      const contact = response?.contactTargetId
        ? state.contacts.find((candidate) => candidate.id === response.contactTargetId)
        : null;
      const hasScopeMatchedTarget =
        raw.includes('ct.survey_id = sr.survey_id') && raw.includes('ct.is_test = sr.is_test');
      const isExcluded =
        contact != null &&
        isExcludedContact(contact) &&
        (!hasScopeMatchedTarget ||
          (contact.surveyId === response?.surveyId && contact.isTest === response.isTest));
      return Promise.resolve(isExcluded ? [{}] : []);
    }),
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

import {
  isResponseExcluded,
  listResponsesForProfiles,
} from '@/lib/operations/profiles.server';

const SURVEY_ID = '00000000-0000-4000-8000-000000000040';
const OTHER_SURVEY_ID = '00000000-0000-4000-8000-000000000041';

interface SeedResponseInput {
  negative?: boolean;
  unsubscribed?: boolean;
  anonymous?: boolean;
  isTest?: boolean;
}

function seedResponseWithContact(opts: SeedResponseInput = {}): {
  responseId: string;
  contactId: string | null;
} {
  let contactId: string | null = null;
  if (!opts.anonymous) {
    contactId = randomUUID();
    state.contacts.push({
      id: contactId,
      surveyId: SURVEY_ID,
      resid: state.contacts.length + 1,
      attrs: {},
      unsubscribedAt: opts.unsubscribed ? new Date() : null,
      negativeAttempts: opts.negative ? ['수신거부'] : [],
      piiBlindIndexes: {},
      isTest: opts.isTest ?? false,
    });
  }
  const responseId = randomUUID();
  // startedAt 을 ms 단위로 차등 부여해서 정렬 안정성 확보
  const startedAt = new Date(Date.now() - state.responses.length * 1000);
  state.responses.push({
    id: responseId,
    surveyId: SURVEY_ID,
    contactTargetId: contactId,
    startedAt,
    deletedAt: null,
    isTest: opts.isTest ?? false,
  });
  return { responseId, contactId };
}

describe('listResponsesForProfiles — negative exclusion', () => {
  beforeEach(() => {
    state.responses = [];
    state.contacts = [];
    state.negativeCodes = ['수신거부'];
    state.hasSurveyScopedLeftJoin = false;
    state.numberedRows = [];
  });

  it('negative ct 의 응답 → 목록에서 가림', async () => {
    seedResponseWithContact();                       // 보임
    seedResponseWithContact({ negative: true });     // 가림
    const result = await listResponsesForProfiles({
      surveyId: SURVEY_ID,
      page: 1,
      pageSize: 100,
      condition: null,
      status: 'all',
      sort: 'startedAt',
      dir: 'desc',
      view: 'active',
      scope: 'real',
    });
    expect(result.total).toBe(1);
  });

  it('unsubscribed ct 의 응답 → 목록에서 가림', async () => {
    seedResponseWithContact();
    seedResponseWithContact({ unsubscribed: true });
    const result = await listResponsesForProfiles({
      surveyId: SURVEY_ID,
      page: 1,
      pageSize: 100,
      condition: null,
      status: 'all',
      sort: 'startedAt',
      dir: 'desc',
      view: 'active',
      scope: 'real',
    });
    expect(result.total).toBe(1);
  });

  it('익명 응답 [contact_target_id IS NULL] → 자동 통과', async () => {
    seedResponseWithContact({ anonymous: true });
    seedResponseWithContact({ negative: true });
    const result = await listResponsesForProfiles({
      surveyId: SURVEY_ID,
      page: 1,
      pageSize: 100,
      condition: null,
      status: 'all',
      sort: 'startedAt',
      dir: 'desc',
      view: 'active',
      scope: 'real',
    });
    expect(result.total).toBe(1);
  });

  it('idx 재계산 — negative 빠지면 순번 보정', async () => {
    seedResponseWithContact();
    seedResponseWithContact();
    seedResponseWithContact({ negative: true });
    const result = await listResponsesForProfiles({
      surveyId: SURVEY_ID,
      page: 1,
      pageSize: 100,
      condition: null,
      status: 'all',
      sort: 'startedAt',
      dir: 'desc',
      view: 'active',
      scope: 'real',
    });
    expect(result.total).toBe(2);
    expect(result.rows.map((r) => r.idx).sort()).toEqual([1, 2]);
  });

  it('cross-survey negative target은 in-scope 응답을 가리지 않음', async () => {
    const foreignContactId = randomUUID();
    state.contacts.push({
      id: foreignContactId,
      surveyId: OTHER_SURVEY_ID,
      resid: 25,
      attrs: {},
      unsubscribedAt: null,
      negativeAttempts: ['수신거부'],
      piiBlindIndexes: {},
      isTest: false,
    });
    state.responses.push({
      id: randomUUID(),
      surveyId: SURVEY_ID,
      contactTargetId: foreignContactId,
      startedAt: new Date(),
      deletedAt: null,
      isTest: false,
    });

    const result = await listResponsesForProfiles({
      surveyId: SURVEY_ID,
      page: 1,
      pageSize: 100,
      condition: null,
      status: 'all',
      sort: 'startedAt',
      dir: 'desc',
      view: 'active',
      scope: 'real',
    });

    expect(result.total).toBe(1);
  });

  it('cross-scope negative target은 in-scope 응답을 가리지 않음', async () => {
    const crossScopeContactId = randomUUID();
    state.contacts.push({
      id: crossScopeContactId,
      surveyId: SURVEY_ID,
      resid: 25,
      attrs: {},
      unsubscribedAt: null,
      negativeAttempts: ['수신거부'],
      piiBlindIndexes: {},
      isTest: true,
    });
    state.responses.push({
      id: randomUUID(),
      surveyId: SURVEY_ID,
      contactTargetId: crossScopeContactId,
      startedAt: new Date(),
      deletedAt: null,
      isTest: false,
    });

    const result = await listResponsesForProfiles({
      surveyId: SURVEY_ID,
      page: 1,
      pageSize: 100,
      condition: null,
      status: 'all',
      sort: 'startedAt',
      dir: 'desc',
      view: 'active',
      scope: 'real',
    });

    expect(result.total).toBe(1);
  });

  it('cross-survey 또는 cross-scope negative target은 상세 제외 배너를 만들지 않음', async () => {
    const foreignContactId = randomUUID();
    const foreignResponseId = randomUUID();
    state.contacts.push({
      id: foreignContactId,
      surveyId: OTHER_SURVEY_ID,
      resid: 25,
      attrs: {},
      unsubscribedAt: null,
      negativeAttempts: ['수신거부'],
      piiBlindIndexes: {},
      isTest: false,
    });
    state.responses.push({
      id: foreignResponseId,
      surveyId: SURVEY_ID,
      contactTargetId: foreignContactId,
      startedAt: new Date(),
      deletedAt: null,
      isTest: false,
    });

    await expect(isResponseExcluded(SURVEY_ID, foreignResponseId, 'real')).resolves.toBe(false);

    const crossScopeContactId = randomUUID();
    const crossScopeResponseId = randomUUID();
    state.contacts.push({
      id: crossScopeContactId,
      surveyId: SURVEY_ID,
      resid: 26,
      attrs: {},
      unsubscribedAt: null,
      negativeAttempts: ['수신거부'],
      piiBlindIndexes: {},
      isTest: true,
    });
    state.responses.push({
      id: crossScopeResponseId,
      surveyId: SURVEY_ID,
      contactTargetId: crossScopeContactId,
      startedAt: new Date(),
      deletedAt: null,
      isTest: false,
    });

    await expect(isResponseExcluded(SURVEY_ID, crossScopeResponseId, 'real')).resolves.toBe(false);
  });

  it('cross-survey contactTargetId mismatch 는 ct LEFT JOIN 결과로 매칭하지 않음', async () => {
    const foreignContactId = randomUUID();
    state.contacts.push({
      id: foreignContactId,
      surveyId: OTHER_SURVEY_ID,
      resid: 25,
      attrs: { 전시회명: '타조사' },
      unsubscribedAt: null,
      negativeAttempts: [],
      piiBlindIndexes: {},
      isTest: false,
    });
    state.responses.push({
      id: randomUUID(),
      surveyId: SURVEY_ID,
      contactTargetId: foreignContactId,
      startedAt: new Date(),
      deletedAt: null,
      isTest: false,
    });

    const result = await listResponsesForProfiles({
      surveyId: SURVEY_ID,
      page: 1,
      pageSize: 100,
      condition: {
        source: 'system.resid',
        mode: 'idlist',
        ranges: [{ from: 25, to: 25 }],
      },
      status: 'all',
      sort: 'startedAt',
      dir: 'desc',
      view: 'active',
      scope: 'real',
    });

    expect(result.total).toBe(0);
  });

  it('PII 필터는 survey-scoped ct LEFT JOIN 행의 contactTargetId 기준으로 매칭', async () => {
    const foreignContactId = randomUUID();
    state.contacts.push({
      id: foreignContactId,
      surveyId: OTHER_SURVEY_ID,
      resid: 25,
      attrs: {},
      unsubscribedAt: null,
      negativeAttempts: [],
      piiBlindIndexes: { email: 'foreign-blind-index' },
      isTest: false,
    });
    state.responses.push({
      id: randomUUID(),
      surveyId: SURVEY_ID,
      contactTargetId: foreignContactId,
      startedAt: new Date(),
      deletedAt: null,
      isTest: false,
    });

    const result = await listResponsesForProfiles({
      surveyId: SURVEY_ID,
      page: 1,
      pageSize: 100,
      condition: {
        source: 'pii.email',
        mode: 'exact',
        value: 'user@example.com',
        blindIndex: 'foreign-blind-index',
      },
      status: 'all',
      sort: 'startedAt',
      dir: 'desc',
      view: 'active',
      scope: 'real',
    });

    expect(result.total).toBe(0);
  });
});

describe('listResponsesForProfiles — 서버 데이터 scope', () => {
  beforeEach(() => {
    state.responses = [];
    state.contacts = [];
    state.negativeCodes = [];
    state.hasSurveyScopedLeftJoin = false;
    state.numberedRows = [];
  });

  it('real scope → isTest=false 응답만 노출', async () => {
    seedResponseWithContact();
    seedResponseWithContact({ isTest: true });
    const result = await listResponsesForProfiles({
      surveyId: SURVEY_ID,
      page: 1,
      pageSize: 100,
      condition: null,
      status: 'all',
      sort: 'startedAt',
      dir: 'desc',
      view: 'active',
      scope: 'real',
    });
    expect(result.total).toBe(1);
    expect(result.rows.every((r) => !r.isTest)).toBe(true);
  });

  it('test scope → isTest=true 응답만 노출', async () => {
    seedResponseWithContact();
    seedResponseWithContact({ isTest: true });
    const result = await listResponsesForProfiles({
      surveyId: SURVEY_ID,
      page: 1,
      pageSize: 100,
      condition: null,
      status: 'all',
      sort: 'startedAt',
      dir: 'desc',
      view: 'active',
      scope: 'test',
    });
    expect(result.total).toBe(1);
    expect(result.rows.every((r) => r.isTest)).toBe(true);
  });

});
