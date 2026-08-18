const INT32_MAX = 2147483647;
const ID_LIST_REGEX = /^\s*\d+(\s*-\s*\d+)?(\s*,\s*\d+(\s*-\s*\d+)?)*\s*$/;
/**
 * 토큰 수 상한 — 전체 검색이 범위 목록을 표시 컬럼마다 복제하므로
 * (토큰 수 × 컬럼 수) SQL 술어 폭증을 여기서 차단한다. 초과는 null(문법 불일치와 동일).
 */
const MAX_ID_LIST_TOKENS = 200;

export interface NumRange {
  from: number;
  to: number;
}

/**
 * "1-30, 45" 같은 범위/리스트 입력 파싱. 매치 실패 시 null.
 *
 * - 정규식 `^\s*\d+(\s*-\s*\d+)?(\s*,\s*\d+(\s*-\s*\d+)?)*\s*$` 매치만 통과
 * - 값은 양의 정수 (1 ≤ n ≤ INT32_MAX) — 0/음수/소수/INT32_MAX 초과/텍스트 모두 null
 * - 역방향 (50-10) 은 자동 swap (10-50)
 * - 빈 토큰/이중 콤마/공백만 → null
 *
 * progress-filters.server.ts 와 contacts-filters.server.ts 양쪽에서 공유.
 */
export function parseIdListInput(input: string): NumRange[] | null {
  if (!ID_LIST_REGEX.test(input)) return null;
  const tokens = input.split(',').map((t) => t.trim());
  if (tokens.length > MAX_ID_LIST_TOKENS) return null;
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
