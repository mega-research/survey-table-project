import 'server-only';

import { cache } from 'react';
import { eq, sql, type SQL } from 'drizzle-orm';

import { db } from '@/db';
import { contactTargets } from '@/db/schema/contacts';
import { surveys } from '@/db/schema/surveys';
import type { ProgressColumnScheme } from '@/db/schema/schema-types';

import type { ProgressRow, ProgressSortKey, SortDir, ProgressTotals } from './report-progress';
import { buildFilterSql, type FilterCondition } from './progress-filters.server';
import { isUnsubscribeResultCode } from './filter-shared';
import { buildNegativeCodeExists, getResultCodeStatuses } from './result-code-statuses.server';
import { normalizeContactColumnScheme } from './contacts';
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
 * 모집단 제외 정의 — negative codes OR 자격미달 응답.
 *
 * EXISTS 의 any-time 의미 — 한 회차라도 negative 코드 받으면 제외.
 *
 * 수신거부(unsubscribed_at·수신거부 결과코드)는 제외하지 않는다 (2026-08-27 결정) —
 * 조사 거절 의사 또는 메일 수신 거부일 뿐 조사 대상 자격을 벗어난 것이 아니므로
 * 모집단(분모)에는 남는다. 단체메일 배제와는 별개 축이다.
 *
 * 자격미달(status='screened_out')은 조사 대상 조건 불충족이라 애초에 모집단이 아니다.
 * 완료 수(분자)에서는 is_completed=false 로 이미 빠지므로, 여기서 분모까지 빼면
 * 응답률 = 완료 / (전체 - 부적격) 이 된다.
 *
 * negative codes 빈 배열이면 자격미달만 평가.
 * isTest 는 buildClosingFilter 와 같은 스코프 플래그를 받는다 — 반대 파티션의
 * 자격미달 응답이 분모를 깎지 않게 하기 위함이다.
 */
function buildScreenedOutExists(isTest: boolean): SQL {
  return sql`EXISTS (SELECT 1 FROM survey_responses sr
                     WHERE sr.contact_target_id = ct.id
                       AND sr.status = 'screened_out'
                       AND sr.deleted_at IS NULL
                       AND sr.is_test = ${isTest})`;
}

/**
 * 진척률 분모 제외용 negative 코드 — 수신거부 계열 코드는 설정이 negative 여도
 * 분모를 깎지 않는다 (수신거부 = 분모 유지 정책의 설정 무관 강제). 기본 코드셋을
 * 아직 저장하지 않은 기존 설문(수신거부 negative 잔존)도 이 필터가 정렬한다.
 */
function progressNegativeCodes(negativeCodes: string[]): string[] {
  return negativeCodes.filter((c) => !isUnsubscribeResultCode(c));
}

function buildExcludeFilter(negativeCodes: string[], isTest: boolean): SQL {
  return sql`${buildNegativeCodeExists(progressNegativeCodes(negativeCodes), sql`ct.id`)}
    OR ${buildScreenedOutExists(isTest)}`;
}

/**
 * 제외 사유별 내역 — 겹치지 않는 버킷으로 쪼갠다.
 *
 * 한 컨택이 여러 사유에 동시에 해당할 수 있으므로(예: 자격미달 응답 + 담당자가 나중에
 * 찍은 부적격 코드) 단순 COUNT 를 나열하면 합이 제외 총계를 넘는다. 푸터가
 * "제외 N = a + b" 로 읽히려면 버킷이 배타적이어야 한다.
 *
 * 우선순위는 응답자 행동 > 담당자 판정 순이다. 자격미달은 응답 내용으로 확정된
 * 사실이라 가장 구체적이고, 결과코드는 담당자 판정이다.
 */
function buildExcludeBreakdownSelect(negativeCodes: string[], isTest: boolean): SQL {
  const screened = buildScreenedOutExists(isTest);
  const negative = sql`(${buildNegativeCodeExists(progressNegativeCodes(negativeCodes), sql`ct.id`)})`;
  return sql`
      COUNT(*) FILTER (WHERE ${screened})::int AS excluded_screened_out,
      COUNT(*) FILTER (WHERE NOT (${screened}) AND ${negative})::int AS excluded_negative_code`;
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
  // getContactColumnScheme 를 거치지 않고 직접 읽는 경로라 같은 보정이 필요하다.
  const scheme = normalizeContactColumnScheme(surveyRow[0]?.contactColumns ?? null);
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
  /**
   * 분류 기준 attrs 키 목록 (순서 = 표 컬럼 순서, 최대 4개). 빈 배열/미지정이면
   * 기본 group_value 기준. 호출부(page RSC)에서 contactColumns 의 groupBy 컬럼
   * 목록으로 검증된 값만 전달.
   */
  groupByKeys?: string[];
}

/** 그룹 키 개수 — 기본(group_value) 모드는 1. */
function groupKeyCount(groupByKeys: string[] | undefined): number {
  return groupByKeys && groupByKeys.length > 0 ? groupByKeys.length : 1;
}

/**
 * 그룹 키를 한 번만 계산해 group_key_0..N 컬럼으로 노출하는 base 서브쿼리.
 *
 * COALESCE(expr)·GROUP BY expr 에 같은 파라미터를 두 번 바인딩하면 PG 가
 * $1/$2 를 다른 expression 으로 취급해 GROUP BY 오류가 나므로, 서브쿼리에서
 * 별칭 컬럼으로 만든 뒤 바깥에서는 bare column 으로만 참조한다.
 * 별칭을 ct 로 유지해 기존 filter/EXISTS SQL (`ct.*` 참조)이 그대로 동작한다.
 */
function buildGroupedBase(groupByKeys: string[] | undefined): SQL {
  // attrs 값이 빈 문자열이면 미분류 취급 (NULLIF). 기본 group_value 는 기존 동작 유지.
  const exprs =
    groupByKeys && groupByKeys.length > 0
      ? groupByKeys.map(
          (k, i) => sql`NULLIF(ctt.attrs->>${k}, '') AS ${sql.identifier(`group_key_${i}`)}`,
        )
      : [sql`ctt.group_value AS ${sql.identifier('group_key_0')}`];
  const joined = exprs.reduce((acc, cur) => sql`${acc}, ${cur}`);
  return sql`(SELECT ctt.*, ${joined} FROM contact_targets ctt) ct`;
}

/** GROUP BY 절 — ct.group_key_0[, ct.group_key_1 ...] */
function buildGroupByClause(count: number): SQL {
  const cols = Array.from({ length: count }, (_, i) =>
    sql`ct.${sql.identifier(`group_key_${i}`)}`,
  );
  return cols.reduce((acc, cur) => sql`${acc}, ${cur}`);
}

const SORT_COL_MAP: Record<
  Exclude<ProgressSortKey, `meta:${string}` | `group:${string}`>,
  string
> = {
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
 * NULL group_value 는 '(미분류)' 라벨로 표시하고 하나의 그룹으로 집계한다.
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
  const { surveyId, scope, condition, page, size, sort, dir, metaKeys, groupByKeys } = args;
  const offset = Math.max(0, (page - 1) * size);
  const isTest = testFlagForScope(scope);
  const keyCount = groupKeyCount(groupByKeys);

  const { positive: positiveCodes, negative: negativeCodes } =
    await getResultCodeStatuses(surveyId);
  const closingFilter = buildClosingFilter(positiveCodes, isTest);
  const excludeFilter = buildExcludeFilter(negativeCodes, isTest);

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
  } else if (sort.startsWith('group:')) {
    // group:<attrs키> — 활성 기준 키를 인덱스로 해석 후 inner alias 만 raw 임베드.
    // 사용자 입력(키)은 SQL 에 직접 박히지 않는다.
    const idx = (groupByKeys ?? []).indexOf(sort.slice(6));
    sortExpr =
      idx >= 0 && idx < keyCount
        ? sql.raw(`group_raw_${idx}`)
        : sql.raw(SORT_COL_MAP.responseRate);
  } else {
    const mapped =
      SORT_COL_MAP[sort as Exclude<ProgressSortKey, `meta:${string}` | `group:${string}`>];
    sortExpr = sql.raw(mapped ?? SORT_COL_MAP.responseRate);
  }
  const dirSql = dir === 'asc' ? sql.raw('ASC') : sql.raw('DESC');

  const filterSql = buildFilterSql(condition);

  // 그룹 값 SELECT (group_raw_0..N) + 라벨 concat + GROUP BY 절
  const groupRawSelect = Array.from({ length: keyCount }, (_, i) =>
    sql`ct.${sql.identifier(`group_key_${i}`)} AS ${sql.identifier(`group_raw_${i}`)}`,
  ).reduce((acc, cur) => sql`${acc}, ${cur}`);
  const groupLabelParts = Array.from({ length: keyCount }, (_, i) =>
    sql`COALESCE(ct.${sql.identifier(`group_key_${i}`)}, '(미분류)')`,
  ).reduce((acc, cur) => sql`${acc}, ${cur}`);
  // ORDER BY 안정 tiebreaker — 그룹 값 컬럼 전체 (동률 시 결정적 순서)
  const tiebreaker = Array.from({ length: keyCount }, (_, i) =>
    sql.raw(`group_raw_${i} NULLS LAST`),
  ).reduce((acc, cur) => sql`${acc}, ${cur}`);

  const result = await db.execute(sql`
    SELECT * FROM (
      SELECT
        concat_ws(' / ', ${groupLabelParts}) AS group_label,
        ${groupRawSelect},
        MIN(ct.resid)::int AS first_resid,
        COUNT(*) FILTER (WHERE ${excludeFilter})::int AS excluded_count,
        COUNT(*) FILTER (WHERE NOT (${excludeFilter}))::int AS list_count,
        COUNT(*) FILTER (WHERE (${closingFilter}) AND NOT (${excludeFilter}))::int AS completed_count
        ${metaKeys.length > 0 ? sql`, ${metaSelectSql}` : sql``}
      FROM ${buildGroupedBase(groupByKeys)}
      WHERE ct.survey_id = ${surveyId}
        AND ct.is_test = ${isTest}
        AND ${filterSql}
        GROUP BY ${buildGroupByClause(keyCount)}
    ) sub
    ORDER BY ${sortExpr} ${dirSql} NULLS LAST, ${tiebreaker}
    LIMIT ${size} OFFSET ${offset}
  `);

  return (result as unknown as Array<Record<string, unknown>>).map((r) => {
    const meta: Record<string, string | null> = {};
    metaKeys.forEach((k, i) => {
      const v = r[`meta_${i}`];
      meta[k] = typeof v === 'string' && v.length > 0 ? v : null;
    });
    const groupValues = Array.from({ length: keyCount }, (_, i) => {
      const v = r[`group_raw_${i}`];
      return v == null ? null : String(v);
    });
    // 조합 행 식별 키 — 값에 못 나오는 unit separator(0x1f) 조인. 전부 null 이면 null.
    const groupValueRaw = groupValues.every((v) => v == null)
      ? null
      : groupValues.map((v) => v ?? '').join('');
    return {
      groupLabel: String(r['group_label']),
      groupValueRaw,
      groupValues,
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
 * group_count 는 `getProgressRows` 의 `GROUP BY group_key_0..N` 와 정확히 일치해야
 * 한다 (footer "총 N개 그룹" + 페이지네이션 total 근거). 같은 groupByKeys 를 전달할 것.
 *
 * 조합 그룹 수는 스칼라 서브쿼리의 GROUP BY 를 세는 방식 — COUNT(DISTINCT) 는
 * NULL 그룹 처리와 다중 키 조합에서 의미가 달라 사용하지 않는다. 서브쿼리의
 * ct alias 는 자체 스코프라 바깥 ct 와 충돌하지 않는다.
 */
export async function getProgressTotals(
  surveyId: string,
  scope: OperationsDataScope,
  condition: FilterCondition | null,
  groupByKeys?: string[],
): Promise<ProgressTotals> {
  const isTest = testFlagForScope(scope);
  const keyCount = groupKeyCount(groupByKeys);
  const { positive: positiveCodes, negative: negativeCodes } =
    await getResultCodeStatuses(surveyId);
  const closingFilter = buildClosingFilter(positiveCodes, isTest);
  const excludeFilter = buildExcludeFilter(negativeCodes, isTest);
  const filterSql = buildFilterSql(condition);
  const result = await db.execute(sql`
    SELECT
      (SELECT COUNT(*)::int FROM (
        SELECT 1 FROM ${buildGroupedBase(groupByKeys)}
        WHERE ct.survey_id = ${surveyId}
          AND ct.is_test = ${isTest}
          AND ${filterSql}
        GROUP BY ${buildGroupByClause(keyCount)}
      ) grouped) AS group_count,
      COUNT(*) FILTER (WHERE NOT (${excludeFilter}))::int AS list_total,
      COUNT(*) FILTER (WHERE (${closingFilter}) AND NOT (${excludeFilter}))::int AS completed_total,
      COUNT(*) FILTER (WHERE ${excludeFilter})::int AS excluded_total,
      ${buildExcludeBreakdownSelect(negativeCodes, isTest)}
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
    excludedScreenedOut: Number(r['excluded_screened_out'] ?? 0),
    excludedNegativeCode: Number(r['excluded_negative_code'] ?? 0),
  };
}
