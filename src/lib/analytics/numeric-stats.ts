import { parseNumericInput } from '@/utils/numeric-input';

import type { NumericStats } from './types';

/**
 * 문자열 응답 배열에서 숫자 통계를 계산한다.
 * - 빈값/공백/비숫자는 제외하되, 실제 입력된 0 은 유효값으로 포함한다.
 * - 유효 숫자가 하나도 없으면 null.
 */
export function computeNumericStats(
  rawValues: Array<string | null | undefined>,
): NumericStats | null {
  const nums: number[] = [];
  for (const raw of rawValues) {
    if (raw == null) continue;
    const n = parseNumericInput(String(raw));
    if (n !== null) nums.push(n);
  }
  if (nums.length === 0) return null;

  const sorted = [...nums].sort((a, b) => a - b);
  const count = sorted.length;
  const sum = sorted.reduce((s, n) => s + n, 0);
  const mid = Math.floor(count / 2);
  const median = count % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];

  return {
    count,
    sum,
    mean: sum / count,
    min: sorted[0],
    max: sorted[count - 1],
    median,
  };
}
