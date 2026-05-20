import 'server-only';

import { blindIndex } from '@/lib/crypto/blind';
import {
  FILTER_SOURCE,
  placeholderFor as sharedPlaceholderFor,
  type ColumnCandidateWithPii,
} from './filter-shared';
import { parseIdListInput, type NumRange } from './range-list';

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
