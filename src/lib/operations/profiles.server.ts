import 'server-only';

import { and, asc, eq, sql, type AnyColumn, type SQL } from 'drizzle-orm';

import { db } from '@/db';
import { surveyResponses, contactTargets } from '@/db/schema';
import { deletedResponse, notDeletedResponse } from '@/data/response-filters';

import { escapeLikePattern } from './filter-shared';
import type { Platform } from './parse-ua';
import {
  type NormalizedListArgs,
  type SortDir,
  type SortKey,
} from './profiles';
import { buildFilterSql } from './progress-filters.server';
import type { ProfilesCondition } from './profiles-filters.server';
import { buildNegativeCodeExists, getResultCodeStatuses } from './result-code-statuses.server';

export type ListProfilesArgs = Omit<NormalizedListArgs, 'q' | 'col'> & {
  surveyId: string;
  pageSize: number;
  condition: ProfilesCondition | null;
};

export interface ProfilesRow {
  id: string;
  /** ROW_NUMBER() — 표시용 순번 (started_at desc 기준, surveyId 단위 절대값) */
  idx: number;
  platform: Platform | null;
  browser: string | null;
  status: string;
  currentStepId: string | null;
  /** visible step 진척 (분기/표시조건 반영). 응답 페이지 저장값. 구 데이터·첫 답변 전 null. */
  visibleStepIndex: number | null;
  visibleStepTotal: number | null;
  startedAt: Date;
  completedAt: Date | null;
  totalSeconds: number | null;
  /** 매칭된 contact_targets.group_value (전시회명 국문 등). 익명/미매칭이면 null. */
  groupValue: string | null;
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

/** condition WHERE 절에 참조할 numbered subquery 컬럼들 (정확한 alias 타입 대신 SQL 조각으로 주입). */
interface ProfilesConditionCols {
  idx: SQL;
  browser: SQL;
  contactResid: SQL;
  contactAttrs: SQL;
  contactTargetId: SQL;
}

/**
 * ProfilesCondition → outer WHERE SQL. null 이면 null (필터 없음).
 *
 * - idx: 범위/리스트 매치 (row_number 기준)
 * - browser: ilike 부분일치
 * - resid / attrs / pii: buildFilterSql 위임 (numbered subquery alias 를 cols 로 주입)
 */
function profilesConditionToSql(
  condition: ProfilesCondition | null,
  cols: ProfilesConditionCols,
): SQL | null {
  if (!condition) return null;

  if (condition.source === 'idx') {
    if (condition.ranges.length === 0) return sql`FALSE`;
    const conds = condition.ranges.map((r) =>
      r.from === r.to
        ? sql`${cols.idx} = ${r.from}`
        : sql`${cols.idx} BETWEEN ${r.from} AND ${r.to}`,
    );
    return sql`(${sql.join(conds, sql` OR `)})`;
  }

  if (condition.source === 'browser') {
    const escaped = escapeLikePattern(condition.value);
    return sql`${cols.browser} ILIKE '%' || ${escaped} || '%'`;
  }

  return buildFilterSql(condition, {
    resid: cols.contactResid,
    attrs: cols.contactAttrs,
    contactId: cols.contactTargetId,
  });
}

/**
 * 응답 내역 페이지의 메인 어댑터.
 *
 * 핵심 설계:
 * - **순번(idx)** 은 surveyId 단위의 절대 row_number (started_at desc 기준).
 *   status / condition 필터와 독립 → 운영자에게 "최근 응답이 1번" 의미가 일관됨.
 *   이를 위해 base subquery 에서 row_number 를 먼저 매기고, 외부 select 에서 필터를 건다.
 *   ct 는 base subquery 에 LEFT JOIN 하되 row_number 는 전체 기준 유지.
 * - **condition 필터**: profilesConditionToSql 로 idx/browser/resid/attrs/pii 를
 *   subquery 위에서 적용. idx 비숫자/빈 입력은 파서가 ranges=[] 으로 넘겨 0건.
 * - **page 클램프**: page > totalPages 면 totalPages 로 보정해 마지막 페이지 노출
 *   (검색 0건과 시각적 혼동 방지).
 * - **보안**: raw ip_address 컬럼 제거됨. 접속IP 정보는 수집하지 않음.
 */
export async function listResponsesForProfiles(
  args: ListProfilesArgs,
): Promise<ListProfilesResult> {
  const { surveyId, page, pageSize, status, sort, dir, view, condition } = args;

  // negative result codes — base subquery WHERE 의 NOT EXISTS 분기에 사용.
  // 빈 배열이면 unsubscribed_at 만 검사 (negative code 분기는 SQL 차원에서 생략).
  const { negative: negativeCodes } = await getResultCodeStatuses(surveyId);

  const negativeCodeBranch =
    negativeCodes.length > 0
      ? sql`OR ${buildNegativeCodeExists(negativeCodes, sql`ct.id`)}`
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
      visibleStepIndex: surveyResponses.visibleStepIndex,
      visibleStepTotal: surveyResponses.visibleStepTotal,
      startedAt: surveyResponses.startedAt,
      completedAt: surveyResponses.completedAt,
      totalSeconds: surveyResponses.totalSeconds,
      groupValue: contactTargets.groupValue,
      contactResid: contactTargets.resid,
      contactAttrs: contactTargets.attrs,
      // contact_targets.id 를 명시적 alias 로 — survey_responses.id 와 SQL 컬럼명("id")
      // 충돌 방지(subquery 내 중복 컬럼 → outer "id" ambiguous).
      contactTargetId: sql<string | null>`${contactTargets.id}`.as('contact_target_id'),
    })
    .from(surveyResponses)
    .leftJoin(
      contactTargets,
      and(
        eq(contactTargets.id, surveyResponses.contactTargetId),
        eq(contactTargets.surveyId, surveyResponses.surveyId),
      ),
    )
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

  const conditionSql = profilesConditionToSql(condition, {
    idx: sql`${numbered.idx}`,
    browser: sql`${numbered.browser}`,
    contactResid: sql`${numbered.contactResid}`,
    contactAttrs: sql`${numbered.contactAttrs}`,
    contactTargetId: sql`${numbered.contactTargetId}`,
  });
  if (conditionSql) whereParts.push(conditionSql);

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
      visibleStepIndex: numbered.visibleStepIndex,
      visibleStepTotal: numbered.visibleStepTotal,
      startedAt: numbered.startedAt,
      completedAt: numbered.completedAt,
      totalSeconds: numbered.totalSeconds,
      groupValue: numbered.groupValue,
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
    visibleStepIndex: r.visibleStepIndex,
    visibleStepTotal: r.visibleStepTotal,
    startedAt: r.startedAt,
    completedAt: r.completedAt,
    totalSeconds: r.totalSeconds,
    groupValue: r.groupValue ?? null,
  }));

  return { rows, total, page: clampedPage };
}

/**
 * 응답이 negative 모집단 제외 상태인지 server-side 평가.
 *
 * 상세 페이지 헤더 배지용 — 목록에서는 가려졌지만 link 직접 접근으로 진입한
 * 응답을 운영자에게 명시한다. 익명 응답 (contact_target_id IS NULL) 은
 * 항상 false (제외 대상 아님).
 *
 * `listResponsesForProfiles` 의 NOT EXISTS 와 동일 조건 — unsubscribed_at
 * 또는 negative result_code attempt.
 */
export async function isResponseExcluded(
  surveyId: string,
  responseId: string,
): Promise<boolean> {
  const { negative: negativeCodes } = await getResultCodeStatuses(surveyId);

  const negativeCodeBranch =
    negativeCodes.length > 0
      ? sql`OR ${buildNegativeCodeExists(negativeCodes, sql`ct.id`)}`
      : sql``;

  const rows = await db.execute(sql`
    SELECT 1
    FROM survey_responses sr
    JOIN contact_targets ct ON ct.id = sr.contact_target_id
    WHERE sr.id = ${responseId}::uuid
      AND sr.survey_id = ${surveyId}::uuid
      AND (
        ct.unsubscribed_at IS NOT NULL
        ${negativeCodeBranch}
      )
    LIMIT 1
  `);

  return (rows as unknown as unknown[]).length > 0;
}
