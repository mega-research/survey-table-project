import 'server-only';

import { sql, type SQL } from 'drizzle-orm';

import type { ContactResultCode } from '@/shared/contracts/contacts';
import {
  parseClausesFromUrl,
  parseHeaderFiltersFromUrl,
  splitHeaderValues,
  type ParseExtraHooks,
} from '@/server/read-models/contacts-filters';
import { buildContactsFilterSql, type ClauseColumnRefs } from '@/lib/operations/contacts-filter-sql.server';
import {
  escapeLikePattern,
  type FilterClause,
  type FilterCondition as ClauseFilterCondition,
} from '@/lib/operations/filter-shared';
import { STATUS_FILTERS } from '@/lib/operations/profiles-format';
import { type ColumnCandidate } from './progress-filters';
import { parseIdListInput } from '@/lib/operations/range-list';

/** 응답 전용 추가 컬럼 후보 — 명단 후보 앞에 노출. */
export const PROFILES_EXTRA_CANDIDATES: ColumnCandidate[] = [
  { source: 'idx', label: '순번' },
  { source: 'browser', label: '브라우저' },
];

/* ============================================================================
 * 다중 조건 필터 (조사 대상 절 파이프라인 재사용)
 *
 * 검색바(col/q/op)·헤더 깔때기(hcol/hm/hv) URL 어휘와 절 결합 규칙(AND/OR,
 * 괄호 그룹화)은 contacts-filters.server / contacts-filter-sql 을 그대로 쓰고,
 * 응답 내역 전용 source(idx/browser/status)만 훅으로 끼운다.
 * ==========================================================================*/

/** 응답 내역엔 결과코드 컬럼이 없다 — 공용 파서의 resultCodes 자리 채움용. */
const NO_RESULT_CODES: ContactResultCode[] = [];

/** 헤더 status 깔때기에 허용되는 값 — 'all' 제외한 실제 상태 어휘. */
const PROFILES_STATUS_VALUES: ReadonlySet<string> = new Set(
  STATUS_FILTERS.filter((s) => s !== 'all'),
);

const profilesParseHooks: ParseExtraHooks = {
  clause: (col, trimmed) => {
    if (col === 'idx') {
      // 비숫자 입력은 ranges=[] → SQL FALSE (0건) — 전체 노출 방지 의미 유지.
      return {
        source: 'idx',
        mode: 'idlist',
        value: trimmed,
        ranges: parseIdListInput(trimmed) ?? [],
      };
    }
    if (col === 'browser') return { source: 'browser', mode: 'text', value: trimmed };
    return null;
  },
  // 전체(system.all) 검색은 attrs/pii 전개(공용)에 브라우저 부분일치를 덧붙인다.
  allSubConditions: (trimmed) => [{ source: 'browser', mode: 'text', value: trimmed }],
  header: (col, mode, hv) => {
    if (col === 'status') {
      if (mode !== 'in') return null;
      const values = splitHeaderValues(hv).filter((v) => PROFILES_STATUS_VALUES.has(v));
      if (values.length === 0) return null;
      return { source: 'status', mode: 'in', value: '', values };
    }
    if (col === 'idx' || col === 'browser') {
      if (mode !== 'text') return null;
      const trimmed = hv.trim();
      if (trimmed.length === 0) return null;
      return col === 'idx'
        ? {
            source: 'idx',
            mode: 'idlist',
            value: trimmed,
            ranges: parseIdListInput(trimmed) ?? [],
          }
        : { source: 'browser', mode: 'text', value: trimmed };
    }
    return null;
  },
};

export function parseProfilesClausesFromUrl(
  cols: string[] | string | undefined,
  qs: string[] | string | undefined,
  ops: string[] | string | undefined,
  candidates: ColumnCandidate[],
): FilterClause[] {
  return parseClausesFromUrl(cols, qs, ops, candidates, NO_RESULT_CODES, profilesParseHooks);
}

export function parseProfilesHeaderFiltersFromUrl(
  hcols: string[] | string | undefined,
  hms: string[] | string | undefined,
  hvs: string[] | string | undefined,
  candidates: ColumnCandidate[],
): FilterClause[] {
  return parseHeaderFiltersFromUrl(hcols, hms, hvs, candidates, NO_RESULT_CODES, profilesParseHooks);
}

/** 절 SQL 이 참조할 numbered subquery 컬럼 — listResponsesForProfiles 가 주입. */
export interface ProfilesClauseCols {
  idx: SQL;
  browser: SQL;
  status: SQL;
  contactResid: SQL;
  contactAttrs: SQL;
  contactTargetId: SQL;
}

function profilesExtraCondSql(cond: ClauseFilterCondition, cols: ProfilesClauseCols): SQL | null {
  if (cond.source === 'idx' && cond.mode === 'idlist') {
    if (!cond.ranges || cond.ranges.length === 0) return sql`FALSE`;
    const conds = cond.ranges.map((r) =>
      r.from === r.to
        ? sql`${cols.idx} = ${r.from}`
        : sql`${cols.idx} BETWEEN ${r.from} AND ${r.to}`,
    );
    return sql`(${sql.join(conds, sql` OR `)})`;
  }
  if (cond.source === 'browser' && cond.mode === 'text') {
    const escaped = escapeLikePattern(cond.value);
    return sql`${cols.browser} ILIKE '%' || ${escaped} || '%'`;
  }
  if (cond.source === 'status' && cond.mode === 'in') {
    const values = cond.values ?? [];
    if (values.length === 0) return sql`FALSE`;
    const inList = sql.join(
      values.map((v) => sql`${v}`),
      sql`, `,
    );
    return sql`${cols.status} IN (${inList})`;
  }
  return null;
}

/** 절 배열 → WHERE SQL. 빈 배열은 TRUE (공용 결합 규칙 그대로). */
export function buildProfilesFilterSql(
  clauses: FilterClause[],
  cols: ProfilesClauseCols,
): SQL {
  const refs: ClauseColumnRefs = {
    resid: cols.contactResid,
    attrs: cols.contactAttrs,
    contactId: cols.contactTargetId,
    extra: (cond) => profilesExtraCondSql(cond, cols),
  };
  return buildContactsFilterSql(clauses, refs);
}
