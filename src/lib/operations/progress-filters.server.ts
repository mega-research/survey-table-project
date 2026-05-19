import 'server-only';

import { blindIndex } from '@/lib/crypto/blind';
import type { PiiFieldType } from '@/lib/crypto/pii-fields';

const INT32_MAX = 2147483647;
const ID_LIST_REGEX = /^\s*\d+(\s*-\s*\d+)?(\s*,\s*\d+(\s*-\s*\d+)?)*\s*$/;

export interface NumRange {
  from: number;
  to: number;
}

export type FilterCondition =
  | { source: 'system.resid'; mode: 'idlist'; ranges: NumRange[] }
  | { source: 'system.resid'; mode: 'text'; value: string }
  | { source: `attrs.${string}`; mode: 'text'; value: string }
  | { source: `pii.${string}`; mode: 'exact'; value: string; blindIndex: string };

export interface ColumnCandidate {
  source: string;
  label: string;
  piiType?: PiiFieldType;
}

export function parseIdListInput(input: string): NumRange[] | null {
  if (!ID_LIST_REGEX.test(input)) return null;
  const tokens = input.split(',').map((t) => t.trim());
  const ranges: NumRange[] = [];
  for (const token of tokens) {
    if (token.length === 0) return null;
    const parts = token.split('-').map((p) => p.trim());
    if (parts.length === 1) {
      const n = Number(parts[0]);
      if (!Number.isInteger(n) || n > INT32_MAX || n < 1) return null;
      ranges.push({ from: n, to: n });
    } else if (parts.length === 2) {
      const a = Number(parts[0]);
      const b = Number(parts[1]);
      if (
        !Number.isInteger(a) ||
        !Number.isInteger(b) ||
        a > INT32_MAX ||
        b > INT32_MAX ||
        a < 1 ||
        b < 1
      ) {
        return null;
      }
      ranges.push({ from: Math.min(a, b), to: Math.max(a, b) });
    } else {
      return null;
    }
  }
  return ranges;
}

export function placeholderFor(source: string | null): string {
  if (!source) return '검색어';
  if (source === 'system.resid') return '예: 1-30, 45';
  if (source.startsWith('pii.')) return '정확한 값 입력 (부분 검색 불가)';
  return '부분일치';
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

  if (col === 'system.resid') {
    const ranges = parseIdListInput(trimmed);
    if (ranges !== null) {
      return { source: 'system.resid', mode: 'idlist', ranges };
    }
    return { source: 'system.resid', mode: 'text', value: trimmed };
  }

  if (col.startsWith('attrs.')) {
    return { source: col as `attrs.${string}`, mode: 'text', value: trimmed };
  }

  if (col.startsWith('pii.')) {
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
