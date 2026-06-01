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
  let sum = 0;
  for (const raw of rawValues) {
    if (raw == null) continue;
    const n = parseNumericInput(String(raw));
    if (n !== null) {
      nums.push(n);
      sum += n;
    }
  }
  if (nums.length === 0) return null;

  // 중앙값을 위해 정렬은 필요. 로컬 배열이므로 in-place 정렬(복사 불필요).
  nums.sort((a, b) => a - b);
  const count = nums.length;
  const mid = Math.floor(count / 2);
  const median = count % 2 === 0 ? (nums[mid - 1] + nums[mid]) / 2 : nums[mid];

  return {
    count,
    sum,
    mean: sum / count,
    min: nums[0],
    max: nums[count - 1],
    median,
  };
}
