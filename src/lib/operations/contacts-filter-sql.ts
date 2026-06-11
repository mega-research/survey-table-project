import { sql, type SQL } from 'drizzle-orm';

import type { FilterClause, FilterCondition } from './contacts-filters.server';
import { FILTER_SOURCE, escapeLikePattern } from './filter-shared';

/**
 * 컨택 필터 WHERE 빌더 — DB 의존 없는 순수 SQL 조립 모듈.
 *
 * contacts.server (조사대상목록) 와 campaigns.server (단체 메일 후보) 가 공유한다.
 * `@/db` 를 import 하지 않으므로 단위 테스트에서 db mock 없이 검증 가능하고,
 * campaigns.server 가 무거운 contacts.server 전체를 끌어오지 않게 한다.
 */

// 최신 회차의 result_code — buildClauseSql(enum) 과 contacts.server SELECT 양쪽에서 사용.
// outer correlation 은 명시적 qualifier 필수 — Drizzle 의 sql template literal 안에서
// ${contactTargets.id} 는 unqualified "id" 로 렌더되어 inner contact_attempts.id 와
// 충돌하므로 "contact_targets"."id" 직접 박는다.
export const latestResultCodeExpr = sql<string | null>`(
  SELECT result_code FROM contact_attempts
  WHERE contact_target_id = "contact_targets"."id"
  ORDER BY attempt_no DESC LIMIT 1
)`;

/**
 * 단일 절 SQL. cond.source 와 mode 별로 분기.
 *
 * SECURITY: cond.source 는 호출자에서 contactColumns 화이트리스트 검증 끝난 값만
 * 전달된다고 가정. value/from/to/blindIndex/key 모두 parameter binding 으로 안전.
 *
 * pii.* 평문 미노출 (사전 계산된 blindIndex 만 SQL 에 진입).
 */
export function buildClauseSql(cond: FilterCondition): SQL {
  if (cond.source === FILTER_SOURCE.RESID) {
    if (cond.mode === 'idlist') {
      if (!cond.ranges || cond.ranges.length === 0) return sql`FALSE`;
      const conds = cond.ranges.map((r) =>
        r.from === r.to
          ? sql`"contact_targets".resid = ${r.from}`
          : sql`"contact_targets".resid BETWEEN ${r.from} AND ${r.to}`,
      );
      // 자체 괄호 — 외부 AND 결합 (eq(surveyId) 또는 다중 절) 시 PG AND>OR 우선순위로
      // 인한 cross-survey 누락/누출 방지.
      return sql`(${sql.join(conds, sql` OR `)})`;
    }
    return sql`FALSE`;
  }

  if (cond.source === FILTER_SOURCE.CONTACT_RESULT && cond.mode === 'enum') {
    return sql`${latestResultCodeExpr} = ${cond.value}`;
  }

  if (cond.source === FILTER_SOURCE.WEB && cond.mode === 'boolean') {
    return cond.value === 'true'
      ? sql`"contact_targets".responded_at IS NOT NULL`
      : sql`"contact_targets".responded_at IS NULL`;
  }

  if (cond.source.startsWith(FILTER_SOURCE.ATTRS_PREFIX) && cond.mode === 'text') {
    const key = cond.source.slice(FILTER_SOURCE.ATTRS_PREFIX.length);
    const escaped = escapeLikePattern(cond.value);
    return sql`"contact_targets".attrs->>${key} ILIKE '%' || ${escaped} || '%'`;
  }

  if (cond.source.startsWith(FILTER_SOURCE.PII_PREFIX) && cond.mode === 'exact') {
    if (!cond.blindIndex) return sql`FALSE`;
    const columnKey = cond.source.slice(FILTER_SOURCE.PII_PREFIX.length);
    // contact_pii 도 id 컬럼이 있어 unquoted id 는 pp.id 로 해석된다 — 반드시 큰따옴표 사용.
    return sql`EXISTS (
      SELECT 1 FROM contact_pii pp
      WHERE pp.contact_target_id = "contact_targets"."id"
        AND pp.column_key = ${columnKey}
        AND pp.blind_index = ${cond.blindIndex}
    )`;
  }

  return sql`FALSE`;
}

/**
 * 절 배열 → WHERE 절. 좌→우 평가, 각 절 (...) 괄호로 우선순위 모호함 제거.
 *
 * 혼합 AND/OR 는 누적마다 명시적 괄호로 그룹화해 좌→우 평가를 강제한다.
 * PG 는 AND > OR 우선순위를 가지므로 `A OR B AND C` 를 평탄 연결하면
 * `A OR (B AND C)` 로 재해석되어 의도한 `(A OR B) AND C` 와 어긋난다.
 * 또한 호출자가 결과를 `and(eq(surveyId), ..., 결과)` 로 결합하므로
 * 그룹화가 빠지면 OR 가지가 surveyId 제약을 탈출해 cross-survey 누출 위험이 있다.
 *
 * 빈 배열 → TRUE (전체 조회).
 */
export function buildContactsFilterSql(clauses: FilterClause[]): SQL {
  if (clauses.length === 0) return sql`TRUE`;
  const first = clauses[0];
  if (!first) return sql`TRUE`;
  // 첫 절도 괄호로 감싸 buildClauseSql 의 결과가 내부 OR 체인이어도 외부 AND 와 안전하게 결합.
  let expr: SQL = sql`(${buildClauseSql(first.condition)})`;
  for (let i = 1; i < clauses.length; i++) {
    const clause = clauses[i];
    if (!clause) continue;
    const next = buildClauseSql(clause.condition);
    const op = clause.op === 'OR' ? sql.raw('OR') : sql.raw('AND');
    // 누적 결합마다 (...) 로 그룹화 — PG AND>OR 우선순위가 좌→우 평가를 뒤엎지 못하게 한다.
    expr = sql`(${expr} ${op} (${next}))`;
  }
  return expr;
}
