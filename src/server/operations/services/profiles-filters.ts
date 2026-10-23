import { type SQL, sql } from 'drizzle-orm';
import 'server-only';

import {
  type ClauseColumnRefs,
  buildContactsFilterSql,
} from '@/lib/operations/contacts-filter-sql.server';
import {
  type FilterCondition as ClauseFilterCondition,
  FILTER_NONE_VALUE,
  FILTER_NOT_NONE_VALUE,
  type FilterClause,
  type HeaderFilterMode,
  escapeLikePattern,
} from '@/lib/operations/filter-shared';
import { answerKeyOf, entryKeyOf } from '@/lib/operations/profile-columns-format';
import { STATUS_FILTERS } from '@/lib/operations/profiles-format';
import { parseIdListInput } from '@/lib/operations/range-list';
import {
  type ParseExtraHooks,
  parseClausesFromUrl,
  parseHeaderFiltersFromUrl,
  splitHeaderValues,
} from '@/server/read-models/contacts-filter-parse';
import type { ContactResultCode } from '@/shared/contracts/contacts';

import { type ColumnCandidate } from './progress-filters';

/** 응답 전용 추가 컬럼 후보 — 명단 후보 앞에 노출. */
export const PROFILES_EXTRA_CANDIDATES: ColumnCandidate[] = [
  { source: 'idx', label: '순번' },
  { source: 'browser', label: '브라우저' },
];

/* ============================================================================
 * 다중 조건 필터 (조사 대상 절 파이프라인 재사용)
 *
 * 검색바(col/q/op)·헤더 깔때기(hcol/hm/hv) URL 어휘와 절 결합 규칙(AND/OR,
 * 괄호 그룹화)은 contacts-filter-parse / contacts-filter-sql 을 그대로 쓰고,
 * 응답 내역 전용 source(idx/browser/status/entry.*)만 훅으로 끼운다.
 * ==========================================================================*/

/** 응답 내역엔 결과코드 컬럼이 없다 — 공용 파서의 resultCodes 자리 채움용. */
const NO_RESULT_CODES: ContactResultCode[] = [];

/** 헤더 status 깔때기에 허용되는 값 — 'all' 제외한 실제 상태 어휘. */
const PROFILES_STATUS_VALUES: ReadonlySet<string> = new Set(
  STATUS_FILTERS.filter((s) => s !== 'all'),
);

/**
 * 후보에 오른 이어 넘길 값 열(`entry.<name>`) — 표에 보이는 열만 페이지가 후보로 올린다.
 * 후보에 없는 entry 열 주소는 공용 분기로 흘러 버려진다(주소 조작 가드).
 */
function entryCandidateSources(candidates: ColumnCandidate[]): string[] {
  return candidates.filter((c) => !c.hidden && entryKeyOf(c.source) !== null).map((c) => c.source);
}

/**
 * 후보에 오른 응답값 열(`answer.<문항 id>[.<칸 id>]`) — 페이지가 표에 보이는 열 중 암호화 저장이
 * 아닌 것만 후보로 올린다(암호문은 부분일치를 걸 수 없다). 후보에 없는 열 주소는 버려진다.
 */
function answerCandidateSources(candidates: ColumnCandidate[]): string[] {
  return candidates.filter((c) => !c.hidden && answerKeyOf(c.source) !== null).map((c) => c.source);
}

/** 응답값 열 헤더 깔때기 — 부분일치(text) 또는 「값 없음/있음」 토글(센티널 단독 in). */
function answerHeaderCondition(
  col: string,
  mode: HeaderFilterMode,
  hv: string,
): ClauseFilterCondition | null {
  if (mode === 'text') {
    const trimmed = hv.trim();
    return trimmed.length === 0 ? null : { source: col, mode: 'text', value: trimmed };
  }
  if (mode === 'in') {
    const raw = splitHeaderValues(hv);
    if (raw.length !== 1) return null;
    if (raw[0] === FILTER_NONE_VALUE) {
      return { source: col, mode: 'in', value: '', values: [], includeNull: true };
    }
    if (raw[0] === FILTER_NOT_NONE_VALUE) {
      return { source: col, mode: 'in', value: '', values: [], excludeNull: true };
    }
  }
  return null;
}

function profilesParseHooks(candidates: ColumnCandidate[]): ParseExtraHooks {
  const entrySources = entryCandidateSources(candidates);
  const answerSources = answerCandidateSources(candidates);
  return {
    clause: (col, trimmed) => {
      if (entrySources.includes(col)) return { source: col, mode: 'text', value: trimmed };
      if (answerSources.includes(col)) return { source: col, mode: 'text', value: trimmed };
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
    // 전체(system.all) 검색은 attrs/pii 전개(공용)에 브라우저·이어 넘길 값·응답값 열 부분일치를 덧붙인다.
    allSubConditions: (trimmed) => [
      { source: 'browser', mode: 'text', value: trimmed },
      ...entrySources.map((source) => ({ source, mode: 'text' as const, value: trimmed })),
      ...answerSources.map((source) => ({ source, mode: 'text' as const, value: trimmed })),
    ],
    header: (col, mode, hv) => {
      if (answerSources.includes(col)) return answerHeaderCondition(col, mode, hv);
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
}

export function parseProfilesClausesFromUrl(
  cols: string[] | string | undefined,
  qs: string[] | string | undefined,
  ops: string[] | string | undefined,
  candidates: ColumnCandidate[],
): FilterClause[] {
  return parseClausesFromUrl(
    cols,
    qs,
    ops,
    candidates,
    NO_RESULT_CODES,
    profilesParseHooks(candidates),
  );
}

export function parseProfilesHeaderFiltersFromUrl(
  hcols: string[] | string | undefined,
  hms: string[] | string | undefined,
  hvs: string[] | string | undefined,
  candidates: ColumnCandidate[],
): FilterClause[] {
  return parseHeaderFiltersFromUrl(
    hcols,
    hms,
    hvs,
    candidates,
    NO_RESULT_CODES,
    profilesParseHooks(candidates),
  );
}

/** 절 SQL 이 참조할 numbered subquery 컬럼 — listResponsesForProfiles 가 주입. */
export interface ProfilesClauseCols {
  idx: SQL;
  browser: SQL;
  status: SQL;
  contactResid: SQL;
  contactAttrs: SQL;
  contactTargetId: SQL;
  /** survey_responses.metadata->'entryParams' (jsonb) — 이어 넘길 값 부분일치용. */
  entryParams: SQL;
  /** survey_responses.question_responses (jsonb) — 응답값 열 부분일치·빈 값 판정용. */
  answers: SQL;
}

/** 응답값 열이 가리키는 값의 글자 — 문항 전체면 `->> 문항`, 표 칸이면 `-> 문항 ->> 칸`. */
function answerTextSql(answers: SQL, ref: { questionId: string; cellId: string | null }): SQL {
  return ref.cellId === null
    ? sql`(${answers} ->> ${ref.questionId})`
    : sql`(${answers} -> ${ref.questionId} ->> ${ref.cellId})`;
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
  const entryName = entryKeyOf(cond.source);
  if (entryName !== null && cond.mode === 'text') {
    const escaped = escapeLikePattern(cond.value);
    return sql`${cols.entryParams}->>${entryName} ILIKE '%' || ${escaped} || '%'`;
  }
  const answerRef = answerKeyOf(cond.source);
  if (answerRef !== null) {
    const text = answerTextSql(cols.answers, answerRef);
    if (cond.mode === 'text') {
      const escaped = escapeLikePattern(cond.value);
      return sql`${text} ILIKE '%' || ${escaped} || '%'`;
    }
    if (cond.mode === 'in' && cond.includeNull) return sql`COALESCE(btrim(${text}), '') = ''`;
    if (cond.mode === 'in' && cond.excludeNull) return sql`COALESCE(btrim(${text}), '') <> ''`;
    return sql`FALSE`;
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
export function buildProfilesFilterSql(clauses: FilterClause[], cols: ProfilesClauseCols): SQL {
  const refs: ClauseColumnRefs = {
    resid: cols.contactResid,
    attrs: cols.contactAttrs,
    contactId: cols.contactTargetId,
    extra: (cond) => profilesExtraCondSql(cond, cols),
  };
  return buildContactsFilterSql(clauses, refs);
}
