import type { ChoiceGroup, HeaderCell, TableCell, TableColumn, TableRow } from '@/types/survey';
import { recalculateColspansForVisibleColumns } from '@/utils/table-merge-helpers';

import { resolveChoiceGroupMobileView } from './choice-group-mobile-view';

/**
 * 「행 단위 그룹 카드」의 보기 그룹 한 섹션을 **원본 표 조각**으로 그리기 위한 투영.
 *
 * 그룹을 켜면(`ChoiceGroup.mobileOriginalLine`) 세로 타일 대신 「행별 원본」과 같은 모양 —
 * 그 그룹이 선 열만 잘라 낸 원본 헤더 + 그 행의 보기 셀 — 을 원본 열 폭 그대로(가로 스크롤)
 * 그린다. 11점 척도처럼 보기가 많은 그룹이 타일 11장으로 길게 늘어지는 것을 막는 옵션이다
 * (기본 꺼짐, 기존 모양 유지). 헤더는 원본 헤더 그리드를 그룹 열로 클리핑한다 — 병합 셀은
 * 걸친 만큼만 남고, 그룹 밖 열만 덮는 셀은 빠진다.
 *
 * 척도 막대(`ChoiceGroup.mobileScaleBar`)를 그릴 수 없는 그룹의 폴백도 이 조각이다.
 *
 * 결과는 `MobileOriginalRowTable` 에 그대로 넘긴다 — 셀 렌더(선택 쓰기·상세기재)는 행별 원본과
 * 같은 호출부 렌더러가 맡는다.
 */

export interface ChoiceGroupOriginalLine {
  columns: TableColumn[];
  row: TableRow;
  headerGrid?: HeaderCell[][] | undefined;
  showColumnHeader: boolean;
}

export interface ProjectChoiceGroupOriginalLineInput {
  group: ChoiceGroup | undefined;
  /** 행의 셀과 인덱스가 맞는 열 — 표시 조건으로 걸러진 뒤의 열이어야 한다 */
  columns: readonly TableColumn[];
  headerGrid?: HeaderCell[][] | undefined;
  hideColumnLabels: boolean;
  row: TableRow;
  /** 그룹에 속한 이 행의 보기 셀(보이는 것만) */
  groupCells: readonly TableCell[];
}

/** 원본 조각으로 그릴 수 없으면 null — 호출부는 종전 세로 타일로 그린다. */
export function projectChoiceGroupOriginalLine(
  input: ProjectChoiceGroupOriginalLineInput,
): ChoiceGroupOriginalLine | null {
  const { group, columns, row, groupCells } = input;
  if (resolveChoiceGroupMobileView(group) === 'tiles') return null;
  if (groupCells.length === 0) return null;

  const colIndices = groupCells.map((cell) => row.cells.findIndex((c) => c.id === cell.id));
  if (colIndices.some((index) => index < 0 || !columns[index])) return null;

  return projectOriginalColumnPiece({
    columns,
    headerGrid: input.headerGrid,
    hideColumnLabels: input.hideColumnLabels,
    row,
    columnIds: new Set(colIndices.map((index) => columns[index]!.id)),
  });
}

export interface ProjectOriginalColumnPieceInput {
  /** 행의 셀과 인덱스가 맞는 열 */
  columns: readonly TableColumn[];
  headerGrid?: HeaderCell[][] | undefined;
  hideColumnLabels: boolean;
  row: TableRow;
  /** 조각에 남길 열 */
  columnIds: ReadonlySet<string>;
}

/**
 * 행 하나를 일부 열만 잘라 낸 원본 표 조각 — 헤더는 그 열로 클리핑한다(병합 셀은 걸친 만큼만,
 * 밖의 열만 덮는 셀은 빠진다). 원본 한 줄과 「행별 척도」의 막대 아닌 부분이 쓴다.
 */
export function projectOriginalColumnPiece(
  input: ProjectOriginalColumnPieceInput,
): ChoiceGroupOriginalLine | null {
  const projected = recalculateColspansForVisibleColumns(
    [...input.columns],
    [input.row],
    new Set(input.columnIds),
    input.headerGrid,
  );
  const projectedRow = projected.rows[0];
  if (!projectedRow) return null;

  // 행 병합(rowspan)은 조각 안에서 의미가 없다 — 한 행짜리 표다
  const cells = projectedRow.cells.map((cell) => {
    const next = { ...cell };
    delete next.rowspan;
    return next;
  });
  const headerGrid = (projected.headerGrid ?? []).filter((headerRow) => headerRow.length > 0);
  const hasColumnLabel = projected.columns.some(
    (column) => !column.isHeaderHidden && column.label.trim() !== '',
  );
  const showColumnHeader = headerGrid.length > 0 || (!input.hideColumnLabels && hasColumnLabel);

  return {
    columns: projected.columns,
    row: { ...projectedRow, cells },
    ...(headerGrid.length > 0 ? { headerGrid } : {}),
    showColumnHeader,
  };
}
