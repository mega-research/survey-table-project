import 'server-only';

import { blindIndex } from '@/lib/crypto/blind';
import type { ContactResultCode } from '@/db/schema/schema-types';
import {
  FILTER_SOURCE,
  placeholderFor as sharedPlaceholderFor,
  type ColumnCandidateWithPii,
} from './filter-shared';
import { parseIdListInput, type NumRange } from './range-list';

export type ColumnCandidate = ColumnCandidateWithPii;

export type CombineOp = 'AND' | 'OR';
export type ConditionMode = 'idlist' | 'text' | 'exact' | 'enum' | 'boolean';

export interface FilterCondition {
  source: string;
  mode: ConditionMode;
  value: string;
  ranges?: NumRange[];
  /** mode === 'exact' (pii.*) 일 때만 populated. 그 외는 undefined. 소비자는 null-check 필수. */
  blindIndex?: string;
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
    const clause = buildClause(colsArr[i], qsArr[i], opsArr[i] ?? '', candidates, resultCodes);
    if (!clause) continue;
    // 출력 첫 절은 항상 op=null (URL 첫 절이 drop 되어도 invariant 보장).
    clauses.push({
      condition: clause.condition,
      op: clauses.length === 0 ? null : clause.op,
    });
  }
  return clauses;
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
  const candidate = candidates.find((c) => c.source === col);
  if (!candidate) return null;
  // op 는 AND/OR 만 결정 — 출력 첫 절 null 강제는 호출자가 담당 (통과 절 순서 기준).
  const op: CombineOp = opRaw === 'OR' ? 'OR' : 'AND';

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
    return { op, condition: { source: col, mode: 'text', value: trimmed } };
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
