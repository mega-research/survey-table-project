import { describe, expect, it } from 'vitest';

import type { ContactColumnScheme } from '@/db/schema/schema-types';
import { resolveGroupCriteria } from '@/lib/contacts/group-levels';

function scheme(columns: ContactColumnScheme['columns']): ContactColumnScheme {
  return { version: 1, headerRow: 1, columns };
}

describe('resolveGroupCriteria', () => {
  it('groupLevel 배정을 레벨 오름차순(대>중>소>세부)으로 반환한다 — 컬럼 순서와 무관', () => {
    const s = scheme([
      { key: '종사자 구간', label: '종사자 구간', source: 'attrs.종사자 구간', order: 1, groupLevel: 2 },
      { key: '산업 분류', label: '산업 분류', source: 'attrs.산업 분류', order: 2, groupLevel: 1 },
      { key: '기업명', label: '기업명', source: 'attrs.기업명', order: 3 },
    ]);
    expect(resolveGroupCriteria(s)).toEqual([
      { key: '산업 분류', label: '산업 분류', level: 1 },
      { key: '종사자 구간', label: '종사자 구간', level: 2 },
    ]);
  });

  it('legacy groupBy 토글 저장분은 컬럼 순서대로 레벨 1..4 로 해석한다', () => {
    const s = scheme([
      { key: '대분류', label: '대분류', source: 'attrs.대분류', order: 1, groupBy: true },
      { key: '기업명', label: '기업명', source: 'attrs.기업명', order: 2 },
      { key: '중분류', label: '중분류', source: 'attrs.중분류', order: 3, groupBy: true },
    ]);
    expect(resolveGroupCriteria(s)).toEqual([
      { key: '대분류', label: '대분류', level: 1 },
      { key: '중분류', label: '중분류', level: 2 },
    ]);
  });

  it('groupLevel 이 하나라도 있으면 legacy groupBy 는 무시한다', () => {
    const s = scheme([
      { key: 'A', label: 'A', source: 'attrs.A', order: 1, groupBy: true },
      { key: 'B', label: 'B', source: 'attrs.B', order: 2, groupLevel: 1 },
    ]);
    expect(resolveGroupCriteria(s)).toEqual([{ key: 'B', label: 'B', level: 1 }]);
  });

  it('같은 레벨이 중복 저장돼 있으면 컬럼 순서 앞쪽이 이긴다', () => {
    const s = scheme([
      { key: 'A', label: 'A', source: 'attrs.A', order: 1, groupLevel: 1 },
      { key: 'B', label: 'B', source: 'attrs.B', order: 2, groupLevel: 1 },
    ]);
    expect(resolveGroupCriteria(s)).toEqual([{ key: 'A', label: 'A', level: 1 }]);
  });

  it('attrs 가 아닌 소스(pii/system)는 레벨이 있어도 제외한다', () => {
    const s = scheme([
      {
        key: '전화번호',
        label: '전화번호',
        source: 'pii.전화번호',
        order: 1,
        piiType: 'phone',
        groupLevel: 1,
      } as ContactColumnScheme['columns'][number],
      { key: '산업 분류', label: '산업 분류', source: 'attrs.산업 분류', order: 2, groupLevel: 2 },
    ]);
    expect(resolveGroupCriteria(s)).toEqual([{ key: '산업 분류', label: '산업 분류', level: 2 }]);
  });

  it('스킴이 null 이면 빈 배열', () => {
    expect(resolveGroupCriteria(null)).toEqual([]);
  });
});
