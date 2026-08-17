import 'server-only';

import { blindIndex } from '@/lib/crypto/blind';
import type { ContactResultCode } from '@/db/schema/schema-types';
import {
  FILTER_SOURCE,
  HEADER_FILTER_MODES,
  HEADER_FILTER_VALUE_SEPARATOR,
  placeholderFor as sharedPlaceholderFor,
  type ColumnCandidateWithPii,
  type HeaderFilterMode,
} from './filter-shared';
import { parseIdListInput, type NumRange } from './range-list';

export type ColumnCandidate = ColumnCandidateWithPii;

export type CombineOp = 'AND' | 'OR';
export type ConditionMode = 'idlist' | 'text' | 'exact' | 'enum' | 'boolean' | 'in' | 'any';

export interface FilterCondition {
  source: string;
  mode: ConditionMode;
  value: string;
  ranges?: NumRange[];
  /** mode === 'exact' (pii.*) 일 때만 populated. 그 외는 undefined. 소비자는 null-check 필수. */
  blindIndex?: string;
  /** mode === 'in' (헤더 체크박스 필터) 일 때만 populated. 컬럼 내 OR 값 목록. */
  values?: string[];
  /** mode === 'any' (전체 컬럼 검색) 일 때만 populated. OR 로 전개할 하위 조건. */
  subConditions?: FilterCondition[];
}

export interface FilterClause {
  condition: FilterCondition;
  op: CombineOp | null;
}

/** 조사 대상용 — attrs.* fallback 은 '검색어' (위젯 분기 있어 일반화). */
export function placeholderFor(source: string): string {
  return sharedPlaceholderFor(source);
}

function toArray(v: string[] | string | undefined): string[] {
  if (v === undefined) return [];
  return Array.isArray(v) ? v : [v];
}

export function parseClausesFromUrl(
  cols: string[] | string | undefined,
  qs: string[] | string | undefined,
  ops: string[] | string | undefined,
  candidates: ColumnCandidate[],
  resultCodes: ContactResultCode[],
): FilterClause[] {
  const colsArr = toArray(cols);
  const qsArr = toArray(qs);
  const opsArr = toArray(ops);
  const len = Math.min(colsArr.length, qsArr.length);
  if (len === 0) return [];
  const clauses: FilterClause[] = [];
  for (let i = 0; i < len; i++) {
    const col = colsArr[i];
    const q = qsArr[i];
    if (col === undefined || q === undefined) continue;
    const clause = buildClause(col, q, opsArr[i] ?? '', candidates, resultCodes);
    if (!clause) continue;
    // 출력 첫 절은 항상 op=null (URL 첫 절이 drop 되어도 invariant 보장).
    clauses.push({
      condition: clause.condition,
      op: clauses.length === 0 ? null : clause.op,
    });
  }
  return clauses;
}

/**
 * 헤더 필터 URL(hcol[]/hm[]/hv[]) → FilterClause[]. 전부 AND 결합 (첫 절만 op=null).
 *
 * 엑셀 오토필터 시맨틱: 컬럼 내 OR(in 값 목록), 컬럼 간 AND.
 * - attrs.*: in(구분자 조인 값 목록) 또는 text(고카디널리티 부분검색 폴백)
 * - pii.*: exact 만 (blind index 전문 일치)
 * - system.contact_result: in — 유효 결과코드만 통과
 * - system.web: in — 'true'/'false' 만 통과
 * 같은 컬럼이 중복 등장하면 마지막 항목이 이긴다 (드롭다운 재적용 시나리오).
 * 검증 실패 절은 silent drop (URL 직접 조작 가드).
 */
export function parseHeaderFiltersFromUrl(
  hcols: string[] | string | undefined,
  hms: string[] | string | undefined,
  hvs: string[] | string | undefined,
  candidates: ColumnCandidate[],
  resultCodes: ContactResultCode[],
): FilterClause[] {
  const colsArr = toArray(hcols);
  const modesArr = toArray(hms);
  const valuesArr = toArray(hvs);
  const len = Math.min(colsArr.length, modesArr.length, valuesArr.length);
  if (len === 0) return [];

  // 같은 컬럼 중복 → 마지막이 이김.
  const bySource = new Map<string, FilterCondition>();
  for (let i = 0; i < len; i++) {
    const col = colsArr[i];
    const modeRaw = modesArr[i];
    const hv = valuesArr[i];
    if (col === undefined || modeRaw === undefined || hv === undefined) continue;
    if (!(HEADER_FILTER_MODES as readonly string[]).includes(modeRaw)) continue;
    const condition = buildHeaderCondition(col, modeRaw as HeaderFilterMode, hv, candidates, resultCodes);
    if (!condition) continue;
    bySource.set(col, condition);
  }

  return [...bySource.values()].map((condition, idx) => ({
    condition,
    op: idx === 0 ? null : ('AND' as const),
  }));
}

function buildHeaderCondition(
  col: string,
  mode: HeaderFilterMode,
  hv: string,
  candidates: ColumnCandidate[],
  resultCodes: ContactResultCode[],
): FilterCondition | null {
  const candidate = candidates.find((c) => c.source === col);
  if (!candidate) return null;

  if (col.startsWith(FILTER_SOURCE.ATTRS_PREFIX)) {
    if (mode === 'in') {
      const values = splitHeaderValues(hv);
      if (values.length === 0) return null;
      return { source: col, mode: 'in', value: '', values };
    }
    if (mode === 'text') {
      const trimmed = hv.trim();
      if (trimmed.length === 0) return null;
      // 헤더 필터 텍스트 폴백에서도 범위 문법은 숫자 범위 검색으로 승격.
      return attrsTextOrIdlistCondition(col, trimmed);
    }
    return null;
  }

  if (col.startsWith(FILTER_SOURCE.PII_PREFIX)) {
    if (mode !== 'exact' || !candidate.piiType) return null;
    const trimmed = hv.trim();
    if (trimmed.length === 0) return null;
    const bi = blindIndex(candidate.piiType, trimmed);
    if (!bi) return null;
    return { source: col, mode: 'exact', value: trimmed, blindIndex: bi };
  }

  if (col === FILTER_SOURCE.CONTACT_RESULT) {
    if (mode !== 'in') return null;
    const valid = new Set(resultCodes.map((rc) => rc.code));
    const values = splitHeaderValues(hv).filter((v) => valid.has(v));
    if (values.length === 0) return null;
    return { source: col, mode: 'in', value: '', values };
  }

  if (col === FILTER_SOURCE.WEB) {
    if (mode !== 'in') return null;
    const values = splitHeaderValues(hv).filter((v) => v === 'true' || v === 'false');
    if (values.length === 0) return null;
    return { source: col, mode: 'in', value: '', values };
  }

  return null;
}

/**
 * attrs 검색어 해석 — 범위 문법이면 idlist(숫자 범위 검색), 아니면 text(부분검색).
 *
 * 범위 문법 판정: parseIdListInput 통과 + `-` 또는 `,` 포함.
 * 단일 숫자("15")는 부분검색 유지 — 혼합 텍스트 컬럼의 숫자 부분검색을 깨지 않기 위함.
 * 정확 매칭이 필요하면 "15-15" 로 입력한다.
 */
function attrsTextOrIdlistCondition(col: string, trimmed: string): FilterCondition {
  if (/[-,]/.test(trimmed)) {
    const ranges = parseIdListInput(trimmed);
    if (ranges !== null) {
      return { source: col, mode: 'idlist', value: trimmed, ranges };
    }
  }
  return { source: col, mode: 'text', value: trimmed };
}

/** 구분자 조인 값 목록 → 공백 트림 + 빈 토큰 제거. */
function splitHeaderValues(hv: string): string[] {
  return hv
    .split(HEADER_FILTER_VALUE_SEPARATOR)
    .map((v) => v.trim())
    .filter((v) => v.length > 0);
}

function buildClause(
  col: string,
  q: string,
  opRaw: string,
  candidates: ColumnCandidate[],
  resultCodes: ContactResultCode[],
): FilterClause | null {
  const trimmed = q.trim();
  if (trimmed.length === 0) return null;
  // op 는 AND/OR 만 결정 — 출력 첫 절 null 강제는 호출자가 담당 (통과 절 순서 기준).
  const op: CombineOp = opRaw === 'OR' ? 'OR' : 'AND';

  // 전체 컬럼 검색 — candidates 화이트리스트 안의 attrs/pii 로만 전개하므로
  // whitelist 조회 없이 자체 처리 (전개 자체가 화이트리스트 검증).
  if (col === FILTER_SOURCE.ALL) {
    // 전체가 기본값이라 범위 입력(1-10)도 여기로 들어온다 — 범위 문법이면
    // attrs 컬럼별 숫자 범위 매칭(idlist)을 텍스트 부분검색과 함께 OR 로 건다.
    const allRanges = /[-,]/.test(trimmed) ? parseIdListInput(trimmed) : null;
    const subConditions: FilterCondition[] = [];
    for (const c of candidates) {
      // 숨긴 컬럼 제외 — 보이지 않는 컬럼의 매칭은 결과를 설명 불가능하게 만든다.
      if (c.hidden) continue;
      if (c.source.startsWith(FILTER_SOURCE.ATTRS_PREFIX)) {
        subConditions.push({ source: c.source, mode: 'text', value: trimmed });
        if (allRanges !== null) {
          subConditions.push({ source: c.source, mode: 'idlist', value: trimmed, ranges: allRanges });
        }
      } else if (c.source.startsWith(FILTER_SOURCE.PII_PREFIX) && c.piiType) {
        const bi = blindIndex(c.piiType, trimmed);
        if (bi) {
          subConditions.push({ source: c.source, mode: 'exact', value: trimmed, blindIndex: bi });
        }
      }
    }
    if (subConditions.length === 0) return null;
    return {
      op,
      condition: { source: FILTER_SOURCE.ALL, mode: 'any', value: trimmed, subConditions },
    };
  }

  const candidate = candidates.find((c) => c.source === col);
  if (!candidate) return null;

  if (col === FILTER_SOURCE.RESID) {
    const ranges = parseIdListInput(trimmed);
    if (ranges !== null) {
      return { op, condition: { source: 'system.resid', mode: 'idlist', value: trimmed, ranges } };
    }
    // 비숫자 입력 → text 폴백. resid 가 정수 컬럼이라 buildClauseSql 에서 FALSE 로 평가.
    return { op, condition: { source: 'system.resid', mode: 'text', value: trimmed } };
  }

  if (col === FILTER_SOURCE.CONTACT_RESULT) {
    const code = resultCodes.find((rc) => rc.code === trimmed);
    if (!code) return null;
    return { op, condition: { source: 'system.contact_result', mode: 'enum', value: trimmed } };
  }

  if (col === FILTER_SOURCE.WEB) {
    if (trimmed !== 'true' && trimmed !== 'false') return null;
    return { op, condition: { source: 'system.web', mode: 'boolean', value: trimmed } };
  }

  if (col.startsWith(FILTER_SOURCE.ATTRS_PREFIX)) {
    return { op, condition: attrsTextOrIdlistCondition(col, trimmed) };
  }

  if (col.startsWith(FILTER_SOURCE.PII_PREFIX)) {
    if (!candidate.piiType) return null;
    // blindIndex 내부에서 normalizePii 호출 — 정규화 실패는 빈 문자열 반환으로 감지.
    const bi = blindIndex(candidate.piiType, trimmed);
    if (!bi) return null;
    return { op, condition: { source: col, mode: 'exact', value: trimmed, blindIndex: bi } };
  }

  return null;
}
