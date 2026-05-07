import 'server-only';

import { eq, sql } from 'drizzle-orm';

import { db } from '@/db';
import { contactTargets } from '@/db/schema/contacts';
import { surveys } from '@/db/schema/surveys';
import type { ContactColumnScheme, ProgressColumnScheme } from '@/db/schema/schema-types';

import type { ProgressRow, ProgressSortKey, SortDir, ProgressTotals } from './report-progress';

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
          WHERE sr.contact_target_id = ct.id AND sr.is_completed = true)
     OR EXISTS (SELECT 1 FROM contact_attempts ca
                WHERE ca.contact_target_id = ct.id AND ca.result_code = '1.조사완료')
`;

/**
 * ILIKE wildcard escape — `%` `_` `\` 를 리터럴로 처리하기 위한 사전 escape.
 * profiles.server.ts 와 동일 패턴. q 가 빈 문자열이면 호출자가 단축 평가
 * (`q = ''`) 하므로 escape 적용 결과는 사용되지 않음.
 */
function escapeLikePattern(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
}

/**
 * `surveys.progress_columns` 가져오기. NULL → 빈 스킴 (4개 고정 컬럼만).
 */
export async function getProgressColumnScheme(surveyId: string): Promise<ProgressColumnScheme> {
  const rows = await db
    .select({ progressColumns: surveys.progressColumns })
    .from(surveys)
    .where(eq(surveys.id, surveyId))
    .limit(1);
  const scheme = rows[0]?.progressColumns;
  return scheme ?? EMPTY_SCHEME;
}

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
 */
export async function getProgressGroupLabel(surveyId: string): Promise<string> {
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
}

interface GetProgressRowsArgs {
  surveyId: string;
  q: string;
  page: number;
  size: number;
  sort: ProgressSortKey;
  dir: SortDir;
  metaKeys: string[];
}

const SORT_COL_MAP: Record<Exclude<ProgressSortKey, `meta:${string}`>, string> = {
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
  const { surveyId, q, page, size, sort, dir, metaKeys } = args;
  const offset = Math.max(0, (page - 1) * size);

  // ILIKE wildcard escape (profiles.server.ts 와 동일 패턴). `${q} = ''`
  // 단축 평가는 사용자 원본 비교라 escape 적용 X — ILIKE 패턴에만 적용.
  const qLike = escapeLikePattern(q);

  // 메타 키 SELECT 절 동적 생성. attrs JSONB 키는 parameter binding (안전).
  const metaSelectSql = metaKeys
    .map((k, i) => sql`MIN(ct.attrs->>${k}) AS ${sql.identifier(`meta_${i}`)}`)
    .reduce<ReturnType<typeof sql>>(
      (acc, cur, i) => (i === 0 ? cur : sql`${acc}, ${cur}`),
      sql``,
    );

  // 정렬 표현식 — outer SELECT scope 에서 inner subquery alias 참조.
  // meta:<key> 는 inner alias `meta_<idx>` 로 매핑. 매칭 실패 시 responseRate 폴백.
  // SORT_COL_MAP 화이트리스트 외 값은 모두 responseRate 로 강제 (defense-in-depth).
  let sortExpr;
  if (sort.startsWith('meta:')) {
    const key = sort.slice(5);
    const idx = metaKeys.indexOf(key);
    sortExpr =
      idx >= 0
        ? sql.raw(`meta_${idx}`)
        : sql.raw(SORT_COL_MAP.responseRate);
  } else {
    const mapped = SORT_COL_MAP[sort as Exclude<ProgressSortKey, `meta:${string}`>];
    sortExpr = sql.raw(mapped ?? SORT_COL_MAP.responseRate);
  }
  const dirSql = dir === 'asc' ? sql.raw('ASC') : sql.raw('DESC');

  const result = await db.execute(sql`
    SELECT * FROM (
      SELECT
        COALESCE(ct.group_value, '(미분류)') AS group_label,
        ct.group_value AS group_value_raw,
        COUNT(*)::int AS list_count,
        COUNT(*) FILTER (WHERE ${closingFilter})::int AS completed_count
        ${metaKeys.length > 0 ? sql`, ${metaSelectSql}` : sql``}
      FROM contact_targets ct
      WHERE ct.survey_id = ${surveyId}
        AND (${q} = '' OR COALESCE(ct.group_value, '(미분류)') ILIKE '%' || ${qLike} || '%')
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
export async function getProgressTotals(surveyId: string, q: string): Promise<ProgressTotals> {
  const qLike = escapeLikePattern(q);
  const result = await db.execute(sql`
    SELECT
      COUNT(DISTINCT COALESCE(ct.group_value, '(미분류)'))::int AS group_count,
      COUNT(*)::int AS list_total,
      COUNT(*) FILTER (WHERE ${closingFilter})::int AS completed_total
    FROM contact_targets ct
    WHERE ct.survey_id = ${surveyId}
      AND (${q} = '' OR COALESCE(ct.group_value, '(미분류)') ILIKE '%' || ${qLike} || '%')
  `);
  const r = (result as unknown as Array<Record<string, unknown>>)[0] ?? {};
  return {
    groupCount: Number(r.group_count ?? 0),
    listTotal: Number(r.list_total ?? 0),
    completedTotal: Number(r.completed_total ?? 0),
  };
}
