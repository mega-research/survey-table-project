import 'server-only';

import { cache } from 'react';
import { eq, sql } from 'drizzle-orm';

import { db } from '@/db';
import { contactTargets } from '@/db/schema/contacts';
import { surveys } from '@/db/schema/surveys';
import type { ContactColumnScheme, ProgressColumnScheme } from '@/db/schema/schema-types';

import type { ProgressRow, ProgressSortKey, SortDir, ProgressTotals } from './report-progress';
import type { FilterCondition } from './progress-filters.server';
import { FILTER_SOURCE, escapeLikePattern } from './filter-shared';

const EMPTY_SCHEME: ProgressColumnScheme = { version: 1, columns: [] };

/**
 * 클로징 정의 W∪A — 두 EXISTS 의 OR.
 *
 * survey_responses.is_completed=true (실제 응답 완료) OR
 * contact_attempts.result_code='1.조사완료' (담당자 수동 마감).
 *
 * `getProgressRows` / `getProgressTotals` 의 `COUNT(*) FILTER (...)` 절에서
 * 동일 정의를 사용하므로 모듈 private 헬퍼로 단일화. 클로징 정의 변경 시
 * 한 곳만 수정 (Known Limitation: '1.조사완료' hardcoded → slice 6/7
 * `ContactResultCode.isClosing` 토글 전환 시 함께 동적화).
 */
const closingFilter = sql`
  EXISTS (SELECT 1 FROM survey_responses sr
          WHERE sr.contact_target_id = ct.id AND sr.is_completed = true AND sr.deleted_at IS NULL)
     OR EXISTS (SELECT 1 FROM contact_attempts ca
                WHERE ca.contact_target_id = ct.id AND ca.result_code = '1.조사완료')
`;

/**
 * 조건 → WHERE 절. null 이면 TRUE (전체 조회).
 *
 * SECURITY: condition.source 는 호출자에서 contactColumns 화이트리스트 검증 끝난 값만
 * 전달된다고 가정. value/from/to/blindIndex/key 모두 parameter binding 으로 안전.
 *
 * pii.* 매칭: condition.value 평문은 SQL 에 들어가지 않고 사전 계산된 blindIndex 만 사용.
 *
 * NULL 동작: ct.attrs->>key 가 NULL 이면 NULL ILIKE → false (자동 제외). pii.* 도 EXISTS
 * 가 false. system.resid 는 NOT NULL.
 */
function buildFilterSql(condition: FilterCondition | null) {
  if (!condition) return sql`TRUE`;

  if (condition.source === FILTER_SOURCE.RESID) {
    if (condition.mode === 'idlist') {
      if (condition.ranges.length === 0) return sql`FALSE`;
      const conds = condition.ranges.map((r) =>
        r.from === r.to
          ? sql`ct.resid = ${r.from}`
          : sql`ct.resid BETWEEN ${r.from} AND ${r.to}`,
      );
      // 자체 괄호 — 외부 AND 결합 (WHERE ct.survey_id = X AND ${filterSql}) 시 PG AND>OR
      // 우선순위로 인한 cross-survey 누락/누출 차단.
      return sql`(${sql.join(conds, sql` OR `)})`;
    }
    return sql`FALSE`; // text 폴백 — resid 가 정수 컬럼이라 비숫자 매칭 0건
  }

  if (condition.source.startsWith(FILTER_SOURCE.ATTRS_PREFIX)) {
    const key = condition.source.slice(FILTER_SOURCE.ATTRS_PREFIX.length);
    const escaped = escapeLikePattern(condition.value);
    // attrs key 도 parameter binding ($1) — PostgreSQL ->> 연산자는 텍스트 파라미터 수용.
    return sql`ct.attrs->>${key} ILIKE '%' || ${escaped} || '%'`;
  }

  if (condition.source.startsWith(FILTER_SOURCE.PII_PREFIX) && condition.mode === 'exact') {
    // pii.* 는 FilterCondition 타입상 항상 mode === 'exact'. mode 가드는 TS narrowing 용.
    const columnKey = condition.source.slice(FILTER_SOURCE.PII_PREFIX.length);
    return sql`EXISTS (
      SELECT 1 FROM contact_pii pp
      WHERE pp.contact_target_id = ct.id
        AND pp.column_key = ${columnKey}
        AND pp.blind_index = ${condition.blindIndex}
    )`;
  }

  // 알 수 없는 source — FilterCondition 타입 확장 후 이 함수 업데이트 누락된 경우의 safety net.
  // FALSE 로 두면 결과가 비어 즉시 인지된다 (TRUE 면 전체 조회로 silent fail).
  return sql`FALSE`;
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
 * 휴리스틱: 첫 contact_target 의 attrs 안에서 value === group_value 인 key 를 찾고,
 * contact_columns 에서 그 attrs.<key> 의 사용자 편집 라벨 사용.
 *
 * 못 찾으면 '그룹' fallback. 컨택 0건 / group_value NULL only 케이스도 동일.
 *
 * 시나리오 B 정책 ("엑셀 18개 헤더 모두 attrs 적재") 하에서 거의 항상 동작.
 * 단, 같은 value 가 두 attrs 키에 우연히 들어있으면 첫 번째 key 의 라벨 — fragile.
 *
 * `cache()` 로 RSC pass dedupe — header / 표 등 다중 RSC 동시 호출 가능성 대비.
 */
export const getProgressGroupLabel = cache(async (surveyId: string): Promise<string> => {
  // 첫 contact_target 의 attrs 와 group_value
  const rows = await db
    .select({
      attrs: contactTargets.attrs,
      groupValue: contactTargets.groupValue,
    })
    .from(contactTargets)
    .where(
      sql`${contactTargets.surveyId} = ${surveyId} AND ${contactTargets.groupValue} IS NOT NULL`,
    )
    .limit(1);

  if (rows.length === 0) return '그룹';
  const { attrs, groupValue } = rows[0];
  if (!attrs || groupValue == null) return '그룹';

  const groupAttrsKey = Object.entries(attrs).find(([, v]) => v === groupValue)?.[0];
  if (!groupAttrsKey) return '그룹';

  // contact_columns 에서 라벨 lookup
  const surveyRow = await db
    .select({ contactColumns: surveys.contactColumns })
    .from(surveys)
    .where(eq(surveys.id, surveyId))
    .limit(1);
  const scheme = surveyRow[0]?.contactColumns as ContactColumnScheme | null | undefined;
  const col = scheme?.columns.find((c) => c.source === `attrs.${groupAttrsKey}`);
  return col?.label ?? groupAttrsKey;
});

interface GetProgressRowsArgs {
  surveyId: string;
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
  const { surveyId, condition, page, size, sort, dir, metaKeys } = args;
  const offset = Math.max(0, (page - 1) * size);

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
        COUNT(*)::int AS list_count,
        COUNT(*) FILTER (WHERE ${closingFilter})::int AS completed_count
        ${metaKeys.length > 0 ? sql`, ${metaSelectSql}` : sql``}
      FROM contact_targets ct
      WHERE ct.survey_id = ${surveyId}
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
      groupLabel: String(r.group_label),
      groupValueRaw: r.group_value_raw == null ? null : String(r.group_value_raw),
      firstResid: r.first_resid == null ? null : Number(r.first_resid),
      listCount: Number(r.list_count),
      completedCount: Number(r.completed_count),
      meta,
    };
  });
}

/**
 * 페이지네이션 무시 합계 — "총 N개 그룹 · 리스트 합계 X / 완료 Y".
 * group_count 는 NULL 그룹도 1로 카운트.
 */
export async function getProgressTotals(
  surveyId: string,
  condition: FilterCondition | null,
): Promise<ProgressTotals> {
  const filterSql = buildFilterSql(condition);
  const result = await db.execute(sql`
    SELECT
      COUNT(DISTINCT COALESCE(ct.group_value, '(미분류)'))::int AS group_count,
      COUNT(*)::int AS list_total,
      COUNT(*) FILTER (WHERE ${closingFilter})::int AS completed_total
    FROM contact_targets ct
    WHERE ct.survey_id = ${surveyId}
      AND ${filterSql}
  `);
  const r = (result as unknown as Array<Record<string, unknown>>)[0] ?? {};
  return {
    groupCount: Number(r.group_count ?? 0),
    listTotal: Number(r.list_total ?? 0),
    completedTotal: Number(r.completed_total ?? 0),
  };
}
