import { type AnyColumn, type SQL, and, asc, eq, sql } from 'drizzle-orm';
import 'server-only';

import { deletedResponse, notDeletedResponse } from '@/server/response-filters';
import { db } from '@/db';
import { contactTargets, surveyResponses } from '@/db/schema';
import { attrsSortKey } from '@/lib/operations/contacts';
import { attrsNaturalSortExprs } from '@/lib/operations/contacts-filter-sql';
import type { Platform } from '@/lib/operations/parse-ua';
import {
  type NormalizedListArgs,
  type ProfilesSystemSortKey,
  type SortDir,
} from '@/lib/operations/profiles';
import {
  type OperationsDataScope,
  responseScopeCondition,
  testFlagForScope,
} from '@/server/data-scope';
import type { FilterClause } from '@/lib/operations/filter-shared';
import {
  buildNegativeCodeExists,
  getResultCodeStatuses,
} from '@/server/read-models/result-code-statuses';
import type { ProfilesRow } from '@/shared/contracts/operations-io';
import type { ResponseStatus } from '@/shared/contracts/survey-response';

import { buildProfilesFilterSql } from './profiles-filters';

// 표가 props 로 받는 행 모양은 계약(@/shared/contracts/operations-io) 소관 — 여기서 다시 내보낸다.
export type { ProfilesRow };

export type ListProfilesArgs = Omit<NormalizedListArgs, 'q' | 'col'> & {
  surveyId: string;
  scope: OperationsDataScope;
  pageSize: number;
  /** 다중 조건 필터 (검색바 + 헤더 깔때기, 조사 대상과 동일 절 파이프라인) */
  clauses: FilterClause[];
};

export interface ListProfilesResult {
  rows: ProfilesRow[];
  total: number;
  /** 클램프 후 실제 사용된 page 번호 (page > totalPages 였으면 totalPages 로 보정됨) */
  page: number;
}

/** Postgres 기본 desc=NULLS FIRST 가 비직관이라 모든 정렬에 NULLS LAST 명시. */
function orderExpr(col: AnyColumn | SQL, direction: SortDir): SQL {
  return direction === 'asc' ? sql`${col} ASC NULLS LAST` : sql`${col} DESC NULLS LAST`;
}

/**
 * 응답 내역 페이지의 메인 어댑터.
 *
 * 핵심 설계:
 * - **순번(idx)** 은 surveyId 단위의 절대 row_number (started_at asc 기준 — 접수 순번).
 *   status / condition 필터와 독립 → "첫 응답이 1번, 새 응답이 마지막 번호" 의미가 일관됨.
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
  const { surveyId, scope, page, pageSize, status, sort, dir, view, clauses } = args;

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
      idx: sql<number>`row_number() over (order by ${surveyResponses.startedAt} asc)`.as('idx'),
      platform: surveyResponses.platform,
      browser: surveyResponses.browser,
      status: surveyResponses.status,
      currentStepId: surveyResponses.currentStepId,
      visibleStepIndex: surveyResponses.visibleStepIndex,
      visibleStepTotal: surveyResponses.visibleStepTotal,
      startedAt: surveyResponses.startedAt,
      completedAt: surveyResponses.completedAt,
      totalSeconds: surveyResponses.totalSeconds,
      ipHash: surveyResponses.ipHash,
      isTest: surveyResponses.isTest,
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
        eq(contactTargets.isTest, surveyResponses.isTest),
      ),
    )
    .where(
      and(
        eq(surveyResponses.surveyId, surveyId),
        view === 'deleted' ? deletedResponse : notDeletedResponse,
        responseScopeCondition(scope),
        // negative ct 의 응답 가림. 익명 (contact_target_id IS NULL) 은
        // NOT EXISTS 가 자동 true → 통과. excluded 가 빠진 후 row_number 가
        // 다시 매겨지므로 idx 가 자동 보정된다.
        sql`NOT EXISTS (
          SELECT 1 FROM contact_targets ct
          WHERE ct.id = ${surveyResponses.contactTargetId}
            AND ct.survey_id = ${surveyResponses.surveyId}
            AND ct.is_test = ${surveyResponses.isTest}
            AND (
              ct.unsubscribed_at IS NOT NULL
              ${negativeCodeBranch}
            )
        )`,
      ),
    )
    .as('numbered');

  const SORT_COLUMN_MAP = {
    resid: numbered.contactResid,
    group: numbered.groupValue,
    platform: numbered.platform,
    browser: numbered.browser,
    status: numbered.status,
    startedAt: numbered.startedAt,
    completedAt: numbered.completedAt,
    totalSeconds: numbered.totalSeconds,
  } as const satisfies Record<Exclude<ProfilesSystemSortKey, 'idx'>, AnyColumn>;

  const whereParts: SQL[] = [];

  // deleted view 는 base subquery 가 이미 deletedAt IS NOT NULL 로 걸러냄.
  // status 필터는 active view 일 때만 적용 (deleted view 는 전체 노출).
  // 절에 status 깔때기가 있으면 상단 status 조건은 무시 — 두 상태 축이 동시에
  // 걸리면 모순 AND(예: completed AND IN drop)로 0건이 된다. UI 는 깔때기 적용
  // 시 status 파라미터를 지우지만, URL 직접 조작·구 링크까지 여기서 방어한다.
  const hasStatusClause = clauses.some((c) => c.condition.source === 'status');
  if (view === 'active' && status !== 'all' && !hasStatusClause) {
    // StatusFilter 의 'deleted' 는 active view 에서 어떤 행과도 맞지 않는 값이지만 종전과 같이
    // status = 'deleted' 비교를 그대로 보낸다(0건). 컬럼 $type 이 ResponseStatus 라 비교값만 맞춘다.
    whereParts.push(eq(numbered.status, status as ResponseStatus));
  }

  // 다중 조건 필터 — 검색바 + 헤더 깔때기 절을 조사 대상과 같은 결합 규칙으로 평가.
  // 빈 배열이면 TRUE 라 whereParts 오염 없음(스킵).
  if (clauses.length > 0) {
    whereParts.push(
      buildProfilesFilterSql(clauses, {
        idx: sql`${numbered.idx}`,
        browser: sql`${numbered.browser}`,
        status: sql`${numbered.status}`,
        contactResid: sql`${numbered.contactResid}`,
        contactAttrs: sql`${numbered.contactAttrs}`,
        contactTargetId: sql`${numbered.contactTargetId}`,
      }),
    );
  }

  const whereClause = whereParts.length > 0 ? and(...whereParts) : undefined;

  const countQuery = db.select({ total: sql<number>`count(*)::int` }).from(numbered);
  const [countRow] = await (whereClause ? countQuery.where(whereClause) : countQuery);
  const total = countRow?.total ?? 0;

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const clampedPage = Math.min(Math.max(1, page), totalPages);
  const offset = (clampedPage - 1) * pageSize;

  // 상태 정렬은 원문 텍스트 알파벳순(bad < completed < drop …)이 아니라 상태 순위 축 —
  // 오름차순 완료(1) → 진행중(2) → 이탈(3) → 자격미달 → 쿼터마감 → 불량, 내림차순은
  // 역순(문제 있는 순). 조사 대상 web 컬럼과 같은 어휘(contacts-filter-sql 의 rank CASE).
  const statusRankExpr = sql`CASE ${numbered.status}
    WHEN 'completed' THEN 1
    WHEN 'in_progress' THEN 2
    WHEN 'drop' THEN 3
    WHEN 'screened_out' THEN 4
    WHEN 'quotaful_out' THEN 5
    WHEN 'bad' THEN 6
    ELSE 7 END`;

  // idx = startedAt asc 기준 접수 순번이므로 방향 그대로 startedAt 에 매핑.
  // attrs.<key> 는 조사 대상과 같은 자연 정렬 — 숫자 값(NO 등)은 숫자순, 비숫자는 뒤에 텍스트순.
  const attrsKey = attrsSortKey(sort);
  const orderClauses: SQL[] =
    attrsKey != null
      ? attrsNaturalSortExprs(attrsKey, sql`${numbered.contactAttrs}`).map((c) => orderExpr(c, dir))
      : sort === 'idx'
        ? [orderExpr(numbered.startedAt, dir)]
        : sort === 'status'
          ? [orderExpr(statusRankExpr, dir)]
          : [orderExpr(SORT_COLUMN_MAP[sort as keyof typeof SORT_COLUMN_MAP], dir)];

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
      ipHash: numbered.ipHash,
      isTest: numbered.isTest,
      groupValue: numbered.groupValue,
      resid: numbered.contactResid,
      attrs: numbered.contactAttrs,
      contactTargetId: numbered.contactTargetId,
    })
    .from(numbered);

  const dataRows = await (whereClause ? dataQuery.where(whereClause) : dataQuery)
    .orderBy(...orderClauses, asc(numbered.id))
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
    isTest: r.isTest,
    groupValue: r.groupValue ?? null,
    resid: r.resid ?? null,
    attrs: (r.attrs ?? null) as Record<string, string> | null,
    contactTargetId: r.contactTargetId ?? null,
    ipHash: r.ipHash ?? null,
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
  scope: OperationsDataScope,
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
      AND sr.is_test = ${testFlagForScope(scope)}
      AND ct.survey_id = sr.survey_id
      AND ct.is_test = sr.is_test
      AND (
        ct.unsubscribed_at IS NOT NULL
        ${negativeCodeBranch}
      )
    LIMIT 1
  `);

  return (rows as unknown as unknown[]).length > 0;
}
