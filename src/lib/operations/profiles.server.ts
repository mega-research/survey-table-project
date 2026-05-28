import 'server-only';

import { and, asc, eq, ilike, or, sql, type AnyColumn, type SQL } from 'drizzle-orm';

import { db } from '@/db';
import { surveyResponses } from '@/db/schema';
import { deletedResponse, notDeletedResponse } from '@/data/response-filters';

import type { Platform } from './parse-ua';
import {
  type NormalizedListArgs,
  type SortDir,
  type SortKey,
} from './profiles';
import { getResultCodeStatuses } from './result-code-statuses.server';

export type ListProfilesArgs = NormalizedListArgs & {
  surveyId: string;
  pageSize: number;
};

export interface ProfilesRow {
  id: string;
  /** ROW_NUMBER() — 표시용 순번 (started_at desc 기준, surveyId 단위 절대값) */
  idx: number;
  platform: Platform | null;
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

/** Postgres 기본 desc=NULLS FIRST 가 비직관이라 모든 정렬에 NULLS LAST 명시. */
function orderExpr(col: AnyColumn | SQL, direction: SortDir): SQL {
  return direction === 'asc'
    ? sql`${col} ASC NULLS LAST`
    : sql`${col} DESC NULLS LAST`;
}

/**
 * 응답 내역 페이지의 메인 어댑터.
 *
 * 핵심 설계:
 * - **순번(idx)** 은 surveyId 단위의 절대 row_number (started_at desc 기준).
 *   status / q 필터와 독립 → 운영자에게 "최근 응답이 1번" 의미가 일관됨.
 *   이를 위해 base subquery 에서 row_number 를 먼저 매기고, 외부 select 에서 필터를 건다.
 * - **idx 검색** (qfield='idx'): subquery 위에서 정확 매치 (`= parseInt(q)`).
 *   숫자 변환 실패 시 결과 0건.
 * - **page 클램프**: page > totalPages 면 totalPages 로 보정해 마지막 페이지 노출
 *   (검색 0건과 시각적 혼동 방지).
 * - **보안**: raw ip_address 컬럼 제거됨. 접속IP 정보는 수집하지 않음.
 */
export async function listResponsesForProfiles(
  args: ListProfilesArgs,
): Promise<ListProfilesResult> {
  const { surveyId, page, pageSize, q, qfield, status, sort, dir, view } = args;

  // negative result codes — base subquery WHERE 의 NOT EXISTS 분기에 사용.
  // 빈 배열이면 unsubscribed_at 만 검사 (negative code 분기는 SQL 차원에서 생략).
  const { negative: negativeCodes } = await getResultCodeStatuses(surveyId);

  const negativeCodeBranch =
    negativeCodes.length > 0
      ? sql`OR EXISTS (
          SELECT 1 FROM contact_attempts ca
          WHERE ca.contact_target_id = ct.id
            AND ca.result_code = ANY(${negativeCodes})
        )`
      : sql``;

  const numbered = db
    .select({
      id: surveyResponses.id,
      idx: sql<number>`row_number() over (order by ${surveyResponses.startedAt} desc)`.as(
        'idx',
      ),
      platform: surveyResponses.platform,
      browser: surveyResponses.browser,
      status: surveyResponses.status,
      currentStepId: surveyResponses.currentStepId,
      startedAt: surveyResponses.startedAt,
      completedAt: surveyResponses.completedAt,
      totalSeconds: surveyResponses.totalSeconds,
    })
    .from(surveyResponses)
    .where(
      and(
        eq(surveyResponses.surveyId, surveyId),
        view === 'deleted' ? deletedResponse : notDeletedResponse,
        // negative ct 의 응답 가림. 익명 (contact_target_id IS NULL) 은
        // NOT EXISTS 가 자동 true → 통과. excluded 가 빠진 후 row_number 가
        // 다시 매겨지므로 idx 가 자동 보정된다.
        sql`NOT EXISTS (
          SELECT 1 FROM contact_targets ct
          WHERE ct.id = ${surveyResponses.contactTargetId}
            AND (
              ct.unsubscribed_at IS NOT NULL
              ${negativeCodeBranch}
            )
        )`,
      ),
    )
    .as('numbered');

  const SORT_COLUMN_MAP = {
    platform: numbered.platform,
    browser: numbered.browser,
    startedAt: numbered.startedAt,
    completedAt: numbered.completedAt,
    totalSeconds: numbered.totalSeconds,
  } as const satisfies Record<Exclude<SortKey, 'idx'>, AnyColumn>;

  const whereParts: SQL[] = [];

  // deleted view 는 base subquery 가 이미 deletedAt IS NOT NULL 로 걸러냄.
  // status 필터는 active view 일 때만 적용 (deleted view 는 전체 노출).
  if (view === 'active' && status !== 'all') {
    whereParts.push(eq(numbered.status, status));
  }

  const trimmed = q.normalize('NFC').trim();
  if (trimmed.length > 0) {
    if (qfield === 'idx') {
      const n = parseInt(trimmed, 10);
      whereParts.push(Number.isFinite(n) && n > 0 ? sql`${numbered.idx} = ${n}` : sql`false`);
    } else {
      const escaped = trimmed
        .replace(/\\/g, '\\\\')
        .replace(/%/g, '\\%')
        .replace(/_/g, '\\_');
      const pattern = `%${escaped}%`;

      if (qfield === 'browser') {
        whereParts.push(ilike(numbered.browser, pattern));
      } else if (qfield === 'all') {
        const orClause = or(ilike(numbered.browser, pattern));
        if (orClause) whereParts.push(orClause);
      }
    }
  }

  const whereClause = whereParts.length > 0 ? and(...whereParts) : undefined;

  const countQuery = db.select({ total: sql<number>`count(*)::int` }).from(numbered);
  const [countRow] = await (whereClause ? countQuery.where(whereClause) : countQuery);
  const total = countRow?.total ?? 0;

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const clampedPage = Math.min(Math.max(1, page), totalPages);
  const offset = (clampedPage - 1) * pageSize;

  // idx asc = "최근일수록 1번" 이므로 startedAt 정렬 방향이 반대.
  const orderClause =
    sort === 'idx'
      ? orderExpr(numbered.startedAt, dir === 'asc' ? 'desc' : 'asc')
      : orderExpr(SORT_COLUMN_MAP[sort], dir);

  const dataQuery = db
    .select({
      id: numbered.id,
      idx: numbered.idx,
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

  const rows: ProfilesRow[] = dataRows.map((r) => ({
    id: r.id,
    idx: r.idx,
    platform: r.platform as Platform | null,
    browser: r.browser,
    status: r.status,
    currentStepId: r.currentStepId,
    startedAt: r.startedAt,
    completedAt: r.completedAt,
    totalSeconds: r.totalSeconds,
  }));

  return { rows, total, page: clampedPage };
}
