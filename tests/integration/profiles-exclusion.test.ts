import { describe, expect, it, beforeEach, vi } from 'vitest';

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
}

interface SeedContact {
  id: string;
  surveyId: string;
  unsubscribedAt: Date | null;
  negativeAttempts: string[];
}

interface FakeState {
  responses: SeedResponse[];
  contacts: SeedContact[];
  negativeCodes: string[];
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
}

const state: FakeState = {
  responses: [],
  contacts: [],
  negativeCodes: [],
  numberedRows: [],
};

// where 절 raw 텍스트 추출 (Task 9 와 동일 helper)
function extractRaw(node: unknown): string {
  if (node == null) return '';
  if (typeof node === 'string') return node;
  if (typeof node === 'number' || typeof node === 'boolean') return String(node);
  if (Array.isArray(node)) return node.map(extractRaw).join(' ');
  const obj = node as Record<string, unknown>;
  if (Array.isArray(obj.value)) return obj.value.map(extractRaw).join(' ');
  if (typeof obj.value === 'string') return obj.value;
  if (Array.isArray(obj.queryChunks)) return obj.queryChunks.map(extractRaw).join(' ');
  if ('encoder' in obj && 'value' in obj) {
    return String((obj as { value: unknown }).value);
  }
  return '';
}

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

function isExcludedContact(ct: SeedContact): boolean {
  if (ct.unsubscribedAt != null) return true;
  if (state.negativeCodes.length === 0) return false;
  return ct.negativeAttempts.some((a) => state.negativeCodes.includes(a));
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
): NumberedRow[] {
  const contactById = new Map(state.contacts.map((c) => [c.id, c]));
  const filtered = state.responses
    .filter((r) => r.surveyId === surveyId)
    .filter((r) => (view === 'deleted' ? r.deletedAt != null : r.deletedAt == null))
    .filter((r) => {
      if (!hasExcludeFilter) return true;             // 구현 전 — 모두 노출
      if (r.contactTargetId == null) return true;     // 익명 → NOT EXISTS true → 통과
      const ct = contactById.get(r.contactTargetId);
      if (ct == null) return true;                    // FK 깨짐 → NOT EXISTS true → 통과
      return !isExcludedContact(ct);                  // negative ct → 가림
    })
    .sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime());
  return filtered.map((r, i) => ({
    id: r.id,
    idx: i + 1,
    platform: null,
    browser: null,
    status: 'in_progress',
    currentStepId: null,
    startedAt: r.startedAt,
    completedAt: null,
    totalSeconds: null,
  }));
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
    (table as Record<string, unknown>).__isNumbered === true
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
    where(whereExpr: unknown) {
      if (!isBaseSubquery) return chain;
      // base subquery WHERE 평가
      const raw = extractRaw(whereExpr);
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
      state.numberedRows = evaluateBaseSubquery(surveyId, view, hasExcludeFilter);
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

  const dataChain = {
    where(_w: unknown) {
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
      return Promise.resolve(baseRows).then(resolve);
    },
  };

  if (isCount) {
    return {
      where(_w: unknown) {
        return {
          then(resolve: (value: unknown) => unknown) {
            return Promise.resolve([{ total: baseRows.length }]).then(resolve);
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
  },
}));

vi.mock('@/lib/operations/result-code-statuses.server', () => ({
  getResultCodeStatuses: vi.fn(async () => ({
    positive: [] as string[],
    negative: state.negativeCodes,
  })),
}));

import { listResponsesForProfiles } from '@/lib/operations/profiles.server';

const SURVEY_ID = '00000000-0000-4000-8000-000000000040';

interface SeedResponseInput {
  negative?: boolean;
  unsubscribed?: boolean;
  anonymous?: boolean;
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
      unsubscribedAt: opts.unsubscribed ? new Date() : null,
      negativeAttempts: opts.negative ? ['수신거부'] : [],
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
  });
  return { responseId, contactId };
}

describe('listResponsesForProfiles — negative exclusion', () => {
  beforeEach(() => {
    state.responses = [];
    state.contacts = [];
    state.negativeCodes = ['수신거부'];
    state.numberedRows = [];
  });

  it('negative ct 의 응답 → 목록에서 가림', async () => {
    seedResponseWithContact();                       // 보임
    seedResponseWithContact({ negative: true });     // 가림
    const result = await listResponsesForProfiles({
      surveyId: SURVEY_ID,
      page: 1,
      pageSize: 100,
      q: '',
      qfield: 'all',
      status: 'all',
      sort: 'startedAt',
      dir: 'desc',
      view: 'active',
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
      q: '',
      qfield: 'all',
      status: 'all',
      sort: 'startedAt',
      dir: 'desc',
      view: 'active',
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
      q: '',
      qfield: 'all',
      status: 'all',
      sort: 'startedAt',
      dir: 'desc',
      view: 'active',
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
      q: '',
      qfield: 'all',
      status: 'all',
      sort: 'startedAt',
      dir: 'desc',
      view: 'active',
    });
    expect(result.total).toBe(2);
    expect(result.rows.map((r) => r.idx).sort()).toEqual([1, 2]);
  });
});
