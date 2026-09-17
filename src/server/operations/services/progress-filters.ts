import 'server-only';

import { sql, type SQL } from 'drizzle-orm';

import { blindIndex } from '@/lib/crypto/blind';
import {
  FILTER_SOURCE,
  escapeLikePattern,
  placeholderFor as sharedPlaceholderFor,
  type ColumnCandidateWithPii,
} from '@/lib/operations/filter-shared';
import { parseIdListInput, type NumRange } from '@/lib/operations/range-list';

export type ColumnCandidate = ColumnCandidateWithPii;

export type FilterCondition =
  | { source: 'system.resid'; mode: 'idlist'; ranges: NumRange[] }
  | { source: 'system.resid'; mode: 'text'; value: string }
  | { source: `attrs.${string}`; mode: 'text'; value: string }
  | { source: `pii.${string}`; mode: 'exact'; value: string; blindIndex: string };

/** 진척 보고용 — attrs.* fallback 은 '부분일치' (단일 검색바라 부분일치 의미가 분명). */
export function placeholderFor(source: string | null): string {
  return sharedPlaceholderFor(source, '부분일치');
}

export function parseConditionFromUrl(
  col: string | null,
  q: string | null,
  candidates: ColumnCandidate[],
): FilterCondition | null {
  if (!col) return null;
  const trimmed = (q ?? '').trim();
  if (trimmed.length === 0) return null;

  const candidate = candidates.find((c) => c.source === col);
  if (!candidate) return null;

  if (col === FILTER_SOURCE.RESID) {
    const ranges = parseIdListInput(trimmed);
    if (ranges !== null) {
      return { source: 'system.resid', mode: 'idlist', ranges };
    }
    return { source: 'system.resid', mode: 'text', value: trimmed };
  }

  if (col.startsWith(FILTER_SOURCE.ATTRS_PREFIX)) {
    return { source: col as `attrs.${string}`, mode: 'text', value: trimmed };
  }

  if (col.startsWith(FILTER_SOURCE.PII_PREFIX)) {
    if (!candidate.piiType) return null;
    const bi = blindIndex(candidate.piiType, trimmed);
    if (!bi) return null;
    return {
      source: col as `pii.${string}`,
      mode: 'exact',
      value: trimmed,
      blindIndex: bi,
    };
  }

  return null;
}

/** buildFilterSql 의 컬럼 참조 — 진척률은 `ct` alias, 응답 내역은 numbered subquery alias. */
export interface FilterColumnRefs {
  resid: SQL;
  attrs: SQL;
  contactId: SQL;
}

const DEFAULT_FILTER_COLS: FilterColumnRefs = {
  resid: sql`ct.resid`,
  attrs: sql`ct.attrs`,
  contactId: sql`ct.id`,
};

/**
 * 조건 → WHERE 절 SQL. null 이면 TRUE (전체 조회).
 *
 * SECURITY: condition.source 는 호출자에서 화이트리스트 검증 끝난 값만 전달된다고 가정.
 * value/from/to/blindIndex/key 모두 parameter binding. pii.* 평문은 SQL 에 들어가지 않고
 * 사전 계산된 blindIndex 만 사용.
 *
 * cols 를 주입받아 진척률(`ct`)·응답 내역(`numbered`) 양쪽에서 재사용.
 */
export function buildFilterSql(
  condition: FilterCondition | null,
  cols: FilterColumnRefs = DEFAULT_FILTER_COLS,
): SQL {
  if (!condition) return sql`TRUE`;

  if (condition.source === FILTER_SOURCE.RESID) {
    if (condition.mode === 'idlist') {
      if (condition.ranges.length === 0) return sql`FALSE`;
      const conds = condition.ranges.map((r) =>
        r.from === r.to
          ? sql`${cols.resid} = ${r.from}`
          : sql`${cols.resid} BETWEEN ${r.from} AND ${r.to}`,
      );
      // 자체 괄호 — 외부 AND 결합 시 PG AND>OR 우선순위로 인한 cross-survey 누락 차단.
      return sql`(${sql.join(conds, sql` OR `)})`;
    }
    return sql`FALSE`; // text 폴백 — resid 정수 컬럼이라 비숫자 매칭 0건
  }

  if (condition.source.startsWith(FILTER_SOURCE.ATTRS_PREFIX)) {
    const key = condition.source.slice(FILTER_SOURCE.ATTRS_PREFIX.length);
    const escaped = escapeLikePattern(condition.value);
    return sql`${cols.attrs}->>${key} ILIKE '%' || ${escaped} || '%'`;
  }

  if (condition.source.startsWith(FILTER_SOURCE.PII_PREFIX) && condition.mode === 'exact') {
    const columnKey = condition.source.slice(FILTER_SOURCE.PII_PREFIX.length);
    return sql`EXISTS (
      SELECT 1 FROM contact_pii pp
      WHERE pp.contact_target_id = ${cols.contactId}
        AND pp.column_key = ${columnKey}
        AND pp.blind_index = ${condition.blindIndex}
    )`;
  }

  // 알 수 없는 source — safety net. FALSE 로 두면 결과가 비어 즉시 인지된다.
  return sql`FALSE`;
}
