import 'server-only';

import { blindIndex } from '@/lib/crypto/blind';
import { normalizePii, type PiiFieldType } from '@/lib/crypto/pii-fields';
import type { ContactResultCode } from '@/db/schema/schema-types';
import { parseIdListInput, type NumRange } from './range-list';

export type CombineOp = 'AND' | 'OR';
export type ConditionMode = 'idlist' | 'text' | 'exact' | 'enum' | 'boolean';

export interface FilterCondition {
  source: string;
  mode: ConditionMode;
  value: string;
  ranges?: NumRange[];
  blindIndex?: string;
}

export interface FilterClause {
  condition: FilterCondition;
  op: CombineOp | null;
}

export interface ColumnCandidate {
  source: string;
  label: string;
  piiType?: PiiFieldType;
}

export function placeholderFor(source: string): string {
  if (source === 'system.resid') return '예: 1-30, 45';
  if (source.startsWith('pii.')) return '정확한 값 입력 (부분 검색 불가)';
  return '검색어';
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
    const clause = buildClause(colsArr[i], qsArr[i], opsArr[i] ?? '', candidates, resultCodes, i);
    if (clause) clauses.push(clause);
  }
  return clauses;
}

function buildClause(
  col: string,
  q: string,
  opRaw: string,
  candidates: ColumnCandidate[],
  resultCodes: ContactResultCode[],
  index: number,
): FilterClause | null {
  const trimmed = q.trim();
  if (trimmed.length === 0) return null;
  const candidate = candidates.find((c) => c.source === col);
  if (!candidate) return null;
  const op: CombineOp | null = index === 0 ? null : opRaw === 'OR' ? 'OR' : 'AND';

  if (col === 'system.resid') {
    const ranges = parseIdListInput(trimmed);
    if (ranges !== null) {
      return { op, condition: { source: 'system.resid', mode: 'idlist', value: trimmed, ranges } };
    }
    return { op, condition: { source: 'system.resid', mode: 'text', value: trimmed } };
  }

  if (col === 'system.contact_result') {
    const code = resultCodes.find((rc) => rc.code === trimmed);
    if (!code) return null;
    return { op, condition: { source: 'system.contact_result', mode: 'enum', value: trimmed } };
  }

  if (col === 'system.web') {
    if (trimmed !== 'true' && trimmed !== 'false') return null;
    return { op, condition: { source: 'system.web', mode: 'boolean', value: trimmed } };
  }

  if (col.startsWith('attrs.')) {
    return { op, condition: { source: col, mode: 'text', value: trimmed } };
  }

  if (col.startsWith('pii.')) {
    if (!candidate.piiType) return null;
    const normalized = normalizePii(candidate.piiType, trimmed);
    if (!normalized) return null;
    const bi = blindIndex(candidate.piiType, trimmed);
    if (!bi) return null;
    return { op, condition: { source: col, mode: 'exact', value: trimmed, blindIndex: bi } };
  }

  return null;
}
