import type { QuotaCell } from '@/db/schema/schema-types';

/**
 * 쿼터 3조건 피벗 레이아웃 계산 (순수 모듈, 표시 전용).
 *
 * 저장 포맷은 건드리지 않는다 — `QuotaCell.categoryIds`는 항상 `config.dimensions`
 * 등록 순서(`lib/quota/matching.ts` `deriveCategoryIds`/`cellKeyOf` 규약)이고,
 * 피벗은 화면 배치만 바꾼다. 좌표 → categoryIds 변환은 `pivotCategoryIds` 사용.
 */

/** 에디터 `QuotaDimension`·현황판 `QuotaStatusDimension` 를 모두 수용하는 최소 구조. */
export interface QuotaPivotCategory {
  id: string;
  label: string;
}

export interface QuotaPivotDimension {
  id: string;
  label: string;
  categories: QuotaPivotCategory[];
}

export interface QuotaPivotColumn {
  outer: QuotaPivotCategory;
  inner: QuotaPivotCategory;
}

export interface QuotaPivot {
  rowDim: QuotaPivotDimension;
  colOuterDim: QuotaPivotDimension;
  colInnerDim: QuotaPivotDimension;
  /** 상단 그룹 순회 × 하위 순회 — 표시 열 순서 */
  columns: QuotaPivotColumn[];
}

/**
 * 3조건 전용 축 배정: 카테고리 수 내림차순으로 행 → 열 상단 그룹 → 열 하위.
 * 동수면 등록 순서 유지(stable sort). 열 수 = 두 열 축 카테고리 수의 곱이 되도록
 * 최다 카테고리 조건을 행으로 보낸다. 3개가 아니면 null.
 */
export function buildQuotaPivot(dimensions: QuotaPivotDimension[]): QuotaPivot | null {
  if (dimensions.length !== 3) return null;
  const sorted = [...dimensions].sort((a, b) => b.categories.length - a.categories.length);
  const [rowDim, colOuterDim, colInnerDim] = sorted;
  if (!rowDim || !colOuterDim || !colInnerDim) return null;
  return {
    rowDim,
    colOuterDim,
    colInnerDim,
    columns: colOuterDim.categories.flatMap((outer) =>
      colInnerDim.categories.map((inner) => ({ outer, inner })),
    ),
  };
}

/** 열 식별 키 — 합계 Map·React key 공용. */
export function pivotColKey(col: QuotaPivotColumn): string {
  return `${col.outer.id}:${col.inner.id}`;
}

/**
 * 열 세로 구분선 클래스 — 상단 그룹 경계는 진한 실선(slate-300), 그룹 내부는 옅은
 * 실선(slate-200), 마지막 열은 바깥 프레임에 맡긴다(이중 테두리 방지). 표본 배분표
 * 관행(그룹 실선/내부 점선)을 웹 헤어라인 톤으로 옮긴 것 — 에디터·현황판 공용.
 */
export function pivotColBorderClass(index: number, pivot: QuotaPivot): string {
  if (index >= pivot.columns.length - 1) return '';
  const innerCount = pivot.colInnerDim.categories.length;
  return (index + 1) % innerCount === 0
    ? 'border-r border-r-slate-300'
    : 'border-r border-r-slate-200';
}

/** 표시 좌표(행 카테고리 + 열)를 원래 dimensions 등록 순서의 categoryIds 로 재조립. */
export function pivotCategoryIds(
  dimensions: QuotaPivotDimension[],
  pivot: QuotaPivot,
  rowCatId: string,
  col: QuotaPivotColumn,
): string[] {
  return dimensions.map((dim) => {
    if (dim.id === pivot.rowDim.id) return rowCatId;
    if (dim.id === pivot.colOuterDim.id) return col.outer.id;
    return col.inner.id;
  });
}

export interface QuotaPivotTotals {
  /** rowCatId → 설정된 목표 합. 해당 행 전체가 미설정이면 null. */
  rows: Map<string, number | null>;
  /** `pivotColKey(col)` → 설정된 목표 합. 해당 열 전체가 미설정이면 null. */
  cols: Map<string, number | null>;
  grand: number | null;
}

/** 계 행/열/총계 — 설정된 셀만 합산(빈칸=무제한 제외), 스코프 전체 미설정이면 null. */
export function pivotTotals(
  cells: QuotaCell[],
  pivot: QuotaPivot,
  dimensions: QuotaPivotDimension[],
): QuotaPivotTotals {
  const targetByKey = new Map(cells.map((c) => [c.categoryIds.join(''), c.target]));
  const rows = new Map<string, number | null>();
  const cols = new Map<string, number | null>();
  let grand: number | null = null;

  const add = (prev: number | null | undefined, target: number | undefined): number | null =>
    target == null ? (prev ?? null) : (prev ?? 0) + target;

  for (const rowCat of pivot.rowDim.categories) {
    for (const col of pivot.columns) {
      const key = pivotCategoryIds(dimensions, pivot, rowCat.id, col).join('');
      const target = targetByKey.get(key);
      rows.set(rowCat.id, add(rows.get(rowCat.id), target));
      cols.set(pivotColKey(col), add(cols.get(pivotColKey(col)), target));
      grand = add(grand, target);
    }
  }
  return { rows, cols, grand };
}
