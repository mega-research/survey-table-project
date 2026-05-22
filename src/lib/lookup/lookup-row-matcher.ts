import type { SurveyLookup } from '@/types/survey';

/**
 * keys 에 들어있는 모든 (lutKey → expected value) 쌍이 정확히 일치하는 첫 행 반환.
 *
 * 이전 버전은 lookup.keyColumns 를 순회했지만, 키/값 구분은 이제 조건 에디터(RightOperand)
 * 가 결정하므로 LUT 가 아닌 caller (keys 객체의 키 집합) 가 매칭할 컬럼을 정의한다.
 */
export function findLookupRow(
  lookup: SurveyLookup,
  keys: Record<string, string | undefined>,
): Record<string, string | number> | null {
  const lutKeys = Object.keys(keys);
  for (const row of lookup.rows) {
    let matched = true;
    for (const lutKey of lutKeys) {
      const expected = String(row[lutKey] ?? '').trim();
      const actual = (keys[lutKey] ?? '').trim();
      if (expected !== actual || actual === '') {
        matched = false;
        break;
      }
    }
    if (matched) return row;
  }
  return null;
}
