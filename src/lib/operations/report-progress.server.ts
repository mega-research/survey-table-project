import 'server-only';

import { cache } from 'react';
import { eq, sql, type SQL } from 'drizzle-orm';

import { db } from '@/db';
import { contactTargets } from '@/db/schema/contacts';
import { surveys } from '@/db/schema/surveys';
import type { ContactColumnScheme, ProgressColumnScheme } from '@/db/schema/schema-types';

import type { ProgressRow, ProgressSortKey, SortDir, ProgressTotals } from './report-progress';
import { buildFilterSql, type FilterCondition } from './progress-filters.server';
import { buildNegativeCodeExists, getResultCodeStatuses } from './result-code-statuses.server';
import {
  targetScopeCondition,
  testFlagForScope,
  type OperationsDataScope,
} from './data-scope.server';

const EMPTY_SCHEME: ProgressColumnScheme = { version: 1, columns: [] };

/**
 * 클로징 정의 W∪A — 두 EXISTS 의 OR.
 *
 * survey_responses.is_completed=true (실제 응답 완료) OR
 * contact_attempts.result_code = ANY(positive codes) (담당자 수동 마감).
 *
 * positive codes 는 `getResultCodeStatuses(surveyId).positive` 동적 추출.
 * DEFAULT 13개에서는 ['1.조사완료'] (기존 하드코딩과 일치).
 *
 * `getProgressRows` / `getProgressTotals` 의 `COUNT(*) FILTER (...)` 절에서
 * 동일 정의를 사용하므로 모듈 private 헬퍼로 단일화. 클로징 정의 변경 시
 * 한 곳만 수정.
 *
 * notDeletedResponse 와 동일 의미 (서브쿼리 내부 raw SQL 컨텍스트라 인라인 유지).
 */
function buildClosingFilter(positiveCodes: string[], isTest: boolean): SQL {
  let positiveBranch: SQL;
  if (positiveCodes.length === 0) {
    positiveBranch = sql`FALSE`;
  } else {
    // sql.join — length=1 array scalar unwrap 으로 ANY 가 22P02 (malformed array literal)
    // 던지는 케이스 회피. buildNegativeCodeExists 와 동일 패턴.
    const codeList = sql.join(
      positiveCodes.map((c) => sql`${c}`),
      sql`, `,
    );
    positiveBranch = sql`EXISTS (SELECT 1 FROM contact_attempts ca
                                 WHERE ca.contact_target_id = ct.id AND ca.result_code IN (${codeList}))`;
  }
  return sql`
    EXISTS (SELECT 1 FROM survey_responses sr
            WHERE sr.contact_target_id = ct.id
              AND sr.is_completed = true
              AND sr.deleted_at IS NULL
              AND sr.is_test = ${isTest})
       OR ${positiveBranch}
  `;
}

/**
 * 모집단 제외 정의 — negative codes OR unsubscribed_at.
 *
 * EXISTS 의 any-time 의미 — 한 회차라도 negative 코드 받으면 제외.
 * `unsubscribed_at IS NOT NULL` 도 자동 negative 효과 (메일 푸터 unsubscribe 흐름).
 *
 * negative codes 빈 배열이면 unsubscribed_at 만 평가.
 */
function buildExcludeFilter(negativeCodes: string[]): SQL {
  return sql`${buildNegativeCodeExists(negativeCodes, sql`ct.id`)} OR ct.unsubscribed_at IS NOT NULL`;
}

/**
 * `surveys.progress_columns` 가져오기. NULL → 빈 스킴 (4개 고정 컬럼만).
 *
 * `cache()` 로 RSC pass dedupe — 동일 surveyId 로 다중 RSC 가 호출해도
 * 1회 query. slice 3 의 `getContactColumnScheme` 와 동일한 패턴.
 */
export const getProgressColumnScheme = cache(
  async (surveyId: string): Promise<ProgressColumnScheme> => {
    const rows = await db
      .select({ progressColumns: surveys.progressColumns })
      .from(surveys)
      .where(eq(surveys.id, surveyId))
      .limit(1);
    const scheme = rows[0]?.progressColumns;
    return scheme ?? EMPTY_SCHEME;
  },
);

/**
 * 그룹 매핑된 attrs 키의 라벨 추출 (컨택리스트 라벨 우선).
 *
 * group attrs key 는 실제 저장된 group_value 로 attrs 키를 역추론한다.
 * (스킴 기반 표준명칭 휴리스틱은 쓰지 않는다: ContactColumnScheme 은 표시 컬럼만 담고
 *  업로드 시 선택한 group 컬럼은 contact_uploads.mapping.systemFields.group 에만 있다.
 *  '전시회' 같은 표준명칭 attrs 키가 실제 group 컬럼이 아닌데 스킴에 있으면 오인하므로 금지.)
 * 실제 group_value 역추론은 업로드/단건 추가 경로를 모두 커버하며, 동일 value 가 여러
 * attrs 키에 들어있는 모호성은 키를 안정 정렬해 결정적으로 첫 키를 고른다.
 *
 * 못 찾으면 '그룹' fallback. 컨택 0건 / group_value NULL only 케이스도 동일.
 *
 * `cache()` 로 RSC pass dedupe — header / 표 등 다중 RSC 동시 호출 가능성 대비.
 */
export const getProgressGroupLabel = cache(async (
  surveyId: string,
  scope: OperationsDataScope,
): Promise<string> => {
  // 실제 저장된 group_value 로 attrs 키 역추론 (write-side 가 어떤 컬럼을 group 으로 썼든 일관)
  const rows = await db
    .select({
      attrs: contactTargets.attrs,
      groupValue: contactTargets.groupValue,
    })
    .from(contactTargets)
    .where(
      sql`${contactTargets.surveyId} = ${surveyId}
        AND ${targetScopeCondition(scope)}
        AND ${contactTargets.groupValue} IS NOT NULL`,
    )
    .limit(1);

  const firstRow = rows[0];
  const attrs = firstRow?.attrs;
  const groupValue = firstRow?.groupValue;
  let groupAttrsKey: string | undefined;
  if (attrs && groupValue != null) {
    // 동일 value 가 여러 키에 들어있을 때의 모호성을 키 정렬로 결정적 처리
    const matchedKeys = Object.entries(attrs)
      .filter(([, v]) => v === groupValue)
      .map(([k]) => k)
      .sort();
    groupAttrsKey = matchedKeys[0];
  }

  if (!groupAttrsKey) return '그룹';

  // contact_columns 에서 사용자 편집 라벨 lookup (라벨 표기에만 사용)
  const surveyRow = await db
    .select({
      contactColumns: scope === 'test' ? surveys.testContactColumns : surveys.contactColumns,
    })
    .from(surveys)
    .where(eq(surveys.id, surveyId))
    .limit(1);
  const scheme = surveyRow[0]?.contactColumns as ContactColumnScheme | null | undefined;
  const col = scheme?.columns.find((c) => c.source === `attrs.${groupAttrsKey}`);
  return col?.label ?? groupAttrsKey;
});

export interface GetProgressRowsArgs {
  surveyId: string;
  scope: OperationsDataScope;
  condition: FilterCondition | null;
  page: number;
  size: number;
  sort: ProgressSortKey;
  dir: SortDir;
  metaKeys: string[];
}

const SORT_COL_MAP: Record<Exclude<ProgressSortKey, `meta:${string}`>, string> = {
  firstResid: 'first_resid',
  groupLabel: 'group_label',
  listCount: 'list_count',
  completedCount: 'completed_count',
  responseRate: '(completed_count::float / NULLIF(list_count, 0))',
};

/**
 * 단일 SQL GROUP BY 집계 — 페이지네이션 + 정렬 + 그룹 메타 컬럼 동적 SELECT.
 *
 * 클로징 정의 W∪A: survey_responses.is_completed=true OR
 * contact_attempts.result_code='1.조사완료'. EXISTS 두 번.
 *
 * NULL group_value 는 '(미분류)' 라벨로 표시.
 *
 * 구현 노트: PostgreSQL 은 ORDER BY 절의 expression 안에서 SELECT alias 를
 * 참조할 수 없음 (`ORDER BY (completed_count / list_count)` 같은 형태는
 * unknown column 에러). 그래서 GROUP BY 집계를 inner subquery 로 감싸고
 * outer SELECT 의 ORDER BY 가 inner alias 를 일반 컬럼처럼 참조하도록 함.
 *
 * SECURITY: metaKeys 는 progress_columns 에서 가져온 사용자 입력. attrs JSONB
 * 키는 parameter binding 으로 안전. sortExpr 는 whitelist 또는 inner alias
 * 참조 (meta_0..meta_N) 만 raw 임베드 — 사용자 입력이 SQL 에 직접 박히지 않음.
 */
export async function getProgressRows(args: GetProgressRowsArgs): Promise<ProgressRow[]> {
  const { surveyId, scope, condition, page, size, sort, dir, metaKeys } = args;
  const offset = Math.max(0, (page - 1) * size);
  const isTest = testFlagForScope(scope);

  const { positive: positiveCodes, negative: negativeCodes } =
    await getResultCodeStatuses(surveyId);
  const closingFilter = buildClosingFilter(positiveCodes, isTest);
  const excludeFilter = buildExcludeFilter(negativeCodes);

  const metaSelectSql = metaKeys
    .map((k, i) => sql`MIN(ct.attrs->>${k}) AS ${sql.identifier(`meta_${i}`)}`)
    .reduce<ReturnType<typeof sql>>(
      (acc, cur, i) => (i === 0 ? cur : sql`${acc}, ${cur}`),
      sql``,
    );

  let sortExpr;
  if (sort.startsWith('meta:')) {
    const key = sort.slice(5);
    const idx = metaKeys.indexOf(key);
    sortExpr =
      idx >= 0 ? sql.raw(`meta_${idx}`) : sql.raw(SORT_COL_MAP.responseRate);
  } else {
    const mapped = SORT_COL_MAP[sort as Exclude<ProgressSortKey, `meta:${string}`>];
    sortExpr = sql.raw(mapped ?? SORT_COL_MAP.responseRate);
  }
  const dirSql = dir === 'asc' ? sql.raw('ASC') : sql.raw('DESC');

  const filterSql = buildFilterSql(condition);

  const result = await db.execute(sql`
    SELECT * FROM (
      SELECT
        COALESCE(ct.group_value, '(미분류)') AS group_label,
        ct.group_value AS group_value_raw,
        MIN(ct.resid)::int AS first_resid,
        COUNT(*) FILTER (WHERE ${excludeFilter})::int AS excluded_count,
        COUNT(*) FILTER (WHERE NOT (${excludeFilter}))::int AS list_count,
        COUNT(*) FILTER (WHERE (${closingFilter}) AND NOT (${excludeFilter}))::int AS completed_count
        ${metaKeys.length > 0 ? sql`, ${metaSelectSql}` : sql``}
      FROM contact_targets ct
      WHERE ct.survey_id = ${surveyId}
        AND ct.is_test = ${isTest}
        AND ${filterSql}
      GROUP BY ct.group_value
    ) sub
    ORDER BY ${sortExpr} ${dirSql} NULLS LAST, group_value_raw NULLS LAST
    LIMIT ${size} OFFSET ${offset}
  `);

  return (result as unknown as Array<Record<string, unknown>>).map((r) => {
    const meta: Record<string, string | null> = {};
    metaKeys.forEach((k, i) => {
      const v = r[`meta_${i}`];
      meta[k] = typeof v === 'string' && v.length > 0 ? v : null;
    });
    return {
      groupLabel: String(r['group_label']),
      groupValueRaw: r['group_value_raw'] == null ? null : String(r['group_value_raw']),
      firstResid: r['first_resid'] == null ? null : Number(r['first_resid']),
      listCount: Number(r['list_count']),
      completedCount: Number(r['completed_count']),
      excludedCount: Number(r['excluded_count']),
      meta,
    };
  });
}

/**
 * 페이지네이션 무시 합계 — "총 N개 그룹 · 리스트 합계 X / 완료 Y".
 *
 * group_count 는 `getProgressRows` 의 `GROUP BY ct.group_value` (raw 컬럼) 과
 * 정확히 일치해야 한다 (footer "총 N개 그룹" + 페이지네이션 total 근거).
 *
 * 그래서 COUNT(DISTINCT ct.group_value) (NULL 제외) 에 NULL 그룹 존재 시 +1.
 * COALESCE(...,'(미분류)') 를 DISTINCT 안에서 쓰면 group_value 가 리터럴
 * '(미분류)' 인 행과 NULL 행이 한 그룹으로 합쳐져 GROUP BY 와 어긋난다.
 */
export async function getProgressTotals(
  surveyId: string,
  scope: OperationsDataScope,
  condition: FilterCondition | null,
): Promise<ProgressTotals> {
  const isTest = testFlagForScope(scope);
  const { positive: positiveCodes, negative: negativeCodes } =
    await getResultCodeStatuses(surveyId);
  const closingFilter = buildClosingFilter(positiveCodes, isTest);
  const excludeFilter = buildExcludeFilter(negativeCodes);
  const filterSql = buildFilterSql(condition);
  const result = await db.execute(sql`
    SELECT
      (COUNT(DISTINCT ct.group_value)
        + (CASE WHEN COUNT(*) FILTER (WHERE ct.group_value IS NULL) > 0 THEN 1 ELSE 0 END))::int AS group_count,
      COUNT(*) FILTER (WHERE NOT (${excludeFilter}))::int AS list_total,
      COUNT(*) FILTER (WHERE (${closingFilter}) AND NOT (${excludeFilter}))::int AS completed_total,
      COUNT(*) FILTER (WHERE ${excludeFilter})::int AS excluded_total
    FROM contact_targets ct
    WHERE ct.survey_id = ${surveyId}
      AND ct.is_test = ${isTest}
      AND ${filterSql}
  `);
  const r = (result as unknown as Array<Record<string, unknown>>)[0] ?? {};
  return {
    groupCount: Number(r['group_count'] ?? 0),
    listTotal: Number(r['list_total'] ?? 0),
    completedTotal: Number(r['completed_total'] ?? 0),
    excludedTotal: Number(r['excluded_total'] ?? 0),
  };
}
