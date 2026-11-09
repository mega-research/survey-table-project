import { describe, expect, it } from 'vitest';

import type { FilterCondition } from '@/lib/operations/filter-shared';
import { compactIdList } from '@/lib/operations/range-list';

import { type ColumnCandidate, parseClausesFromUrl } from './contacts-filter-parse';

/**
 * 컨택원 수정 화면은 ID 목록 칸 값을 `compactIdList` 로 합쳐 서버에 보낸다. 합친 값을 서버가
 * 읽은 결과는 원래 값을 읽은 결과와 **같은 대상**을 골라야 한다 — 숫자 매칭은 번호 집합으로,
 * 단일 숫자 텍스트 폴백(`ILIKE '%' || value || '%'`)은 원문 value 까지 같아야 한다.
 */
const candidates: ColumnCandidate[] = [
  { source: 'system.resid', label: '시스템ID' },
  { source: 'attrs.ID', label: 'ID' },
];

function parseOne(source: string, value: string): FilterCondition {
  const [clause] = parseClausesFromUrl([source], [value], [''], candidates, []);
  if (!clause) throw new Error(`해석 실패: ${source}=${value}`);
  return clause.condition;
}

/** 대상을 정하는 성질만 — 숫자 매칭은 번호 집합, 텍스트 폴백이면 원문 value. */
function matchingShape(c: FilterCondition) {
  const ids = new Set<number>();
  for (const r of c.ranges ?? []) for (let n = r.from; n <= r.to; n++) ids.add(n);
  return {
    mode: c.mode,
    ids: [...ids].sort((a, b) => a - b),
    textFallback: c.textFallback === true,
    ...(c.textFallback === true || c.mode === 'text' ? { value: c.value } : {}),
  };
}

const INPUTS = [
  '1 2 3 4 5',
  '3 1 2 9 200 201',
  '5 5',
  '5-5',
  '5,',
  '5 5-5',
  '4-6 5',
  '10-5',
  '1-10, 5, 11 12-15',
  '7',
  '1 3 5',
];

describe('compactIdList 전후 서버 해석 동치', () => {
  for (const source of ['attrs.ID', 'system.resid']) {
    for (const input of INPUTS) {
      it(`${source} — "${input}" → "${compactIdList(input)}"`, () => {
        expect(matchingShape(parseOne(source, compactIdList(input)))).toEqual(
          matchingShape(parseOne(source, input)),
        );
      });
    }
  }
});
