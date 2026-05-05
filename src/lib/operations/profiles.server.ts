import 'server-only';

import { and, asc, eq, ilike, or, sql, type AnyColumn, type SQL } from 'drizzle-orm';

import { db } from '@/db';
import { surveyResponses } from '@/db/schema';

import { formatIpMask } from './profiles';

export type SortKey =
  | 'idx'
  | 'ip'
  | 'platform'
  | 'browser'
  | 'startedAt'
  | 'completedAt'
  | 'totalSeconds';

export type SortDir = 'asc' | 'desc';

export type QField = 'all' | 'idx' | 'ip' | 'browser';

export type StatusFilter =
  | 'all'
  | 'completed'
  | 'in_progress'
  | 'drop'
  | 'screened_out'
  | 'quotaful_out'
  | 'bad';

const SORT_KEY_WHITELIST: readonly SortKey[] = [
  'idx',
  'ip',
  'platform',
  'browser',
  'startedAt',
  'completedAt',
  'totalSeconds',
] as const;

const QFIELD_WHITELIST: readonly QField[] = ['all', 'idx', 'ip', 'browser'] as const;

const STATUS_FILTER_WHITELIST: readonly StatusFilter[] = [
  'all',
  'completed',
  'in_progress',
  'drop',
  'screened_out',
  'quotaful_out',
  'bad',
] as const;

export interface ListProfilesArgs {
  surveyId: string;
  page: number;
  pageSize: number;
  q: string;
  qfield: QField;
  status: StatusFilter;
  sort: SortKey;
  dir: SortDir;
}

export interface ProfilesRow {
  id: string;
  /** ROW_NUMBER() — 표시용 순번 (started_at desc 기준, surveyId 단위 절대값) */
  idx: number;
  ipMasked: string;
  platform: string | null;
  browser: string | null;
  status: string;
  currentStepId: string | null;
  startedAt: Date;
  completedAt: Date | null;
  totalSeconds: number | null;
}

export interface ListProfilesResult {
  rows: ProfilesRow[];
  total: number;
  /** 클램프 후 실제 사용된 page 번호 (page > totalPages 였으면 totalPages 로 보정됨) */
  page: number;
}

/** ORDER BY 표현식. NULLS LAST 명시 (Postgres 기본은 desc=NULLS FIRST 라 비직관). */
function orderExpr(col: AnyColumn | SQL, direction: SortDir): SQL {
  return direction === 'asc'
    ? sql`${col} ASC NULLS LAST`
    : sql`${col} DESC NULLS LAST`;
}

/**
 * 응답자 목록 페이지의 메인 어댑터.
 *
 * 핵심 설계:
 * - **순번(idx)** 은 surveyId 단위의 절대 row_number (started_at desc 기준).
 *   status / q 필터와 독립 → 운영자에게 "최근 응답이 1번" 의미가 일관됨.
 *   이를 위해 base subquery 에서 row_number 를 먼저 매기고, 외부 select 에서 필터를 건다.
 * - **idx 검색** (qfield='idx'): subquery 위에서 정확 매치 (`= parseInt(q)`).
 *   숫자 변환 실패 시 결과 0건 (NaN 매치 없음).
 * - **NULL 정렬**: completed_at / total_seconds / ip_address 가 NULL 가능 → NULLS LAST 명시.
 * - **page 클램프**: page > totalPages 면 totalPages 로 보정해 마지막 페이지 노출
 *   (검색 0건과 시각적 혼동 방지).
 * - **보안**: row 객체에 raw `ip_address` 포함 안 함 — `formatIpMask` 후 `ipMasked` 만 노출.
 */
export async function listResponsesForProfiles(
  args: ListProfilesArgs,
): Promise<ListProfilesResult> {
  const { surveyId, page, pageSize, q, qfield, status, sort, dir } = args;

  // ── 1. surveyId 단위 base subquery (row_number 절대값 매김) ──
  const numbered = db
    .select({
      id: surveyResponses.id,
      idx: sql<number>`row_number() over (order by ${surveyResponses.startedAt} desc)`.as(
        'idx',
      ),
      ipAddress: surveyResponses.ipAddress,
      platform: surveyResponses.platform,
      browser: surveyResponses.browser,
      status: surveyResponses.status,
      currentStepId: surveyResponses.currentStepId,
      startedAt: surveyResponses.startedAt,
      completedAt: surveyResponses.completedAt,
      totalSeconds: surveyResponses.totalSeconds,
    })
    .from(surveyResponses)
    .where(eq(surveyResponses.surveyId, surveyId))
    .as('numbered');

  // ── 2. 외부 WHERE 빌드 (status / q) ──
  const whereParts: SQL[] = [];

  if (status !== 'all') {
    whereParts.push(eq(numbered.status, status));
  }

  const trimmed = q.normalize('NFC').trim();
  if (trimmed.length > 0) {
    if (qfield === 'idx') {
      const n = parseInt(trimmed, 10);
      if (Number.isFinite(n) && n > 0) {
        whereParts.push(sql`${numbered.idx} = ${n}`);
      } else {
        // 숫자 변환 실패 → 매칭 없음 (false condition)
        whereParts.push(sql`false`);
      }
    } else {
      // ILIKE 와일드카드 이스케이프 (Postgres ILIKE 기준)
      const escaped = trimmed
        .replace(/\\/g, '\\\\')
        .replace(/%/g, '\\%')
        .replace(/_/g, '\\_');
      const pattern = `%${escaped}%`;

      if (qfield === 'ip') {
        whereParts.push(ilike(numbered.ipAddress, pattern));
      } else if (qfield === 'browser') {
        whereParts.push(ilike(numbered.browser, pattern));
      } else if (qfield === 'all') {
        const ipMatch = ilike(numbered.ipAddress, pattern);
        const browserMatch = ilike(numbered.browser, pattern);
        const orClause = or(ipMatch, browserMatch);
        if (orClause) whereParts.push(orClause);
      }
    }
  }

  const whereClause =
    whereParts.length === 0
      ? undefined
      : whereParts.length === 1
        ? whereParts[0]
        : and(...whereParts);

  // ── 3. total count (subquery + 외부 WHERE 동일 적용) ──
  const countQuery = db
    .select({ total: sql<number>`count(*)::int` })
    .from(numbered);
  const [countRow] = await (whereClause ? countQuery.where(whereClause) : countQuery);

  const total = countRow?.total ?? 0;

  // ── 4. page 클램프 (page > totalPages 면 마지막 페이지로 보정) ──
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const clampedPage = Math.min(Math.max(1, page), totalPages);
  const offset = (clampedPage - 1) * pageSize;

  // ── 5. 정렬 컬럼 선택 (idx 정렬은 startedAt 기준, dir 매핑 주의) ──
  //   idx asc = "최근일수록 1번" 이라 startedAt desc.  desc 면 그 반대.
  let orderClause: SQL;
  if (sort === 'idx') {
    orderClause = orderExpr(numbered.startedAt, dir === 'asc' ? 'desc' : 'asc');
  } else {
    const orderColumn =
      sort === 'ip'
        ? numbered.ipAddress
        : sort === 'platform'
          ? numbered.platform
          : sort === 'browser'
            ? numbered.browser
            : sort === 'completedAt'
              ? numbered.completedAt
              : sort === 'totalSeconds'
                ? numbered.totalSeconds
                : numbered.startedAt;
    orderClause = orderExpr(orderColumn, dir);
  }

  // ── 6. data 쿼리 ──
  const dataQuery = db
    .select({
      id: numbered.id,
      idx: numbered.idx,
      ipAddress: numbered.ipAddress,
      platform: numbered.platform,
      browser: numbered.browser,
      status: numbered.status,
      currentStepId: numbered.currentStepId,
      startedAt: numbered.startedAt,
      completedAt: numbered.completedAt,
      totalSeconds: numbered.totalSeconds,
    })
    .from(numbered);

  const dataRows = await (whereClause ? dataQuery.where(whereClause) : dataQuery)
    .orderBy(orderClause, asc(numbered.id))
    .limit(pageSize)
    .offset(offset);

  // ── 7. raw IP 마스킹 → 클라로는 마스킹된 값만 전달 ──
  const rows: ProfilesRow[] = dataRows.map((r) => ({
    id: r.id,
    idx: r.idx,
    ipMasked: formatIpMask(r.ipAddress),
    platform: r.platform,
    browser: r.browser,
    status: r.status,
    currentStepId: r.currentStepId,
    startedAt: r.startedAt,
    completedAt: r.completedAt,
    totalSeconds: r.totalSeconds,
  }));

  return { rows, total, page: clampedPage };
}

/**
 * `searchParams` 의 가공되지 않은 string 입력을 화이트리스트 + 기본값으로 normalize.
 * page.tsx 에서 호출.
 */
export function normalizeListArgs(input: {
  page?: string;
  q?: string;
  qfield?: string;
  status?: string;
  sort?: string;
  dir?: string;
}): Omit<ListProfilesArgs, 'surveyId' | 'pageSize'> {
  const pageNum = Math.max(1, parseInt(input.page ?? '1', 10) || 1);
  const qfield: QField = (QFIELD_WHITELIST as readonly string[]).includes(input.qfield ?? '')
    ? (input.qfield as QField)
    : 'all';
  const status: StatusFilter = (STATUS_FILTER_WHITELIST as readonly string[]).includes(
    input.status ?? '',
  )
    ? (input.status as StatusFilter)
    : 'all';
  const sort: SortKey = (SORT_KEY_WHITELIST as readonly string[]).includes(input.sort ?? '')
    ? (input.sort as SortKey)
    : 'idx';
  const dir: SortDir = input.dir === 'asc' ? 'asc' : 'desc';
  const q = (input.q ?? '').slice(0, 200); // sanity bound

  return { page: pageNum, q, qfield, status, sort, dir };
}

/** UI 가 사용하는 고정 페이지 사이즈. URL 사용자 조작 차단. */
export const PROFILES_PAGE_SIZE = 20;
