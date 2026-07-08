import { describe, expect, it } from 'vitest';

import {
  buildQuotaPivot,
  pivotCategoryIds,
  pivotColBorderClass,
  pivotColKey,
  pivotTotals,
} from '@/components/operations/quota/quota-pivot';

const cat = (id: string, label: string) => ({ id, label });

// 등록 순서: 성별(2) → 연령대(3) → 지역(4). 예시 표와 동일하게
// 최다인 지역이 행, 연령대가 열 상단 그룹, 성별이 열 하위가 되어야 한다.
const gender = { id: 'dim-g', label: '성별', categories: [cat('m', '남'), cat('f', '여')] };
const age = {
  id: 'dim-a',
  label: '연령대',
  categories: [cat('a20', '20대'), cat('a30', '30대'), cat('a40', '40대')],
};
const region = {
  id: 'dim-r',
  label: '지역',
  categories: [cat('r1', '안동시'), cat('r2', '영주시'), cat('r3', '상주시'), cat('r4', '문경시')],
};
const dimensions = [gender, age, region];

describe('buildQuotaPivot', () => {
  it('카테고리 수 내림차순으로 행 → 열 상단 → 열 하위를 배정한다', () => {
    const pivot = buildQuotaPivot(dimensions);
    expect(pivot?.rowDim.id).toBe('dim-r');
    expect(pivot?.colOuterDim.id).toBe('dim-a');
    expect(pivot?.colInnerDim.id).toBe('dim-g');
  });

  it('열은 상단 그룹 순회 × 하위 순회 순서로 나열된다', () => {
    const pivot = buildQuotaPivot(dimensions);
    expect(pivot?.columns.map((c) => pivotColKey(c))).toEqual([
      'a20:m',
      'a20:f',
      'a30:m',
      'a30:f',
      'a40:m',
      'a40:f',
    ]);
  });

  it('카테고리 수가 같으면 등록 순서를 유지한다', () => {
    const age2 = { ...age, categories: age.categories.slice(0, 2) };
    const pivot = buildQuotaPivot([gender, age2, region]);
    expect(pivot?.rowDim.id).toBe('dim-r');
    expect(pivot?.colOuterDim.id).toBe('dim-g');
    expect(pivot?.colInnerDim.id).toBe('dim-a');
  });

  it('조건이 3개가 아니면 null 을 반환한다', () => {
    expect(buildQuotaPivot([gender, age])).toBeNull();
    expect(
      buildQuotaPivot([gender, age, region, { id: 'dim-x', label: '기타', categories: [] }]),
    ).toBeNull();
  });
});

describe('pivotCategoryIds', () => {
  it('표시 좌표(행·열)를 원래 조건 등록 순서의 categoryIds 로 재조립한다', () => {
    const pivot = buildQuotaPivot(dimensions);
    if (!pivot) throw new Error('pivot null');
    const col = pivot.columns[0];
    if (!col) throw new Error('column empty');
    // 표시상 행=지역(r3), 열=20대×남 → 저장 순서는 [성별, 연령대, 지역]
    expect(pivotCategoryIds(dimensions, pivot, 'r3', col)).toEqual(['m', 'a20', 'r3']);
  });
});

describe('pivotColBorderClass', () => {
  it('그룹 내부는 옅은 실선, 그룹 경계는 진한 실선, 마지막 열은 구분선 없음', () => {
    const pivot = buildQuotaPivot(dimensions);
    if (!pivot) throw new Error('pivot null');
    // 열 순서: a20:m, a20:f, a30:m, ... — inner(성별) 2개 단위로 그룹
    expect(pivotColBorderClass(0, pivot)).toContain('slate-200');
    expect(pivotColBorderClass(1, pivot)).toContain('slate-300');
    expect(pivotColBorderClass(pivot.columns.length - 1, pivot)).toBe('');
  });
});

describe('pivotTotals', () => {
  const pivotOf = () => {
    const pivot = buildQuotaPivot(dimensions);
    if (!pivot) throw new Error('pivot null');
    return pivot;
  };

  it('행/열/총계를 설정된 셀만 합산한다', () => {
    const totals = pivotTotals(
      [
        { categoryIds: ['m', 'a20', 'r1'], target: 13 },
        { categoryIds: ['f', 'a20', 'r1'], target: 11 },
        { categoryIds: ['m', 'a30', 'r2'], target: 8 },
      ],
      pivotOf(),
      dimensions,
    );
    expect(totals.rows.get('r1')).toBe(24);
    expect(totals.rows.get('r2')).toBe(8);
    expect(totals.cols.get('a20:m')).toBe(13);
    expect(totals.cols.get('a20:f')).toBe(11);
    expect(totals.grand).toBe(32);
  });

  it('스코프 전체가 미설정(무제한)이면 null', () => {
    const totals = pivotTotals(
      [{ categoryIds: ['m', 'a20', 'r1'], target: 5 }],
      pivotOf(),
      dimensions,
    );
    expect(totals.rows.get('r4')).toBeNull();
    expect(totals.cols.get('a40:f')).toBeNull();
  });

  it('셀이 하나도 없으면 grand 도 null', () => {
    expect(pivotTotals([], pivotOf(), dimensions).grand).toBeNull();
  });
});
