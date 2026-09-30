import { expandHeaderGrid } from '@/features/question-renderer/utils/expand-header-grid';
import type { ChoiceGroup, HeaderCell, TableCell, TableColumn } from '@/types/survey';
import { recalculateColspansForVisibleColumns } from '@/utils/table-merge-helpers';

/**
 * 「행 단위 그룹 카드」의 보기 그룹 한 섹션을 **원본 한 줄**로 그리기 위한 투영.
 *
 * 그룹을 켜면(`ChoiceGroup.mobileOriginalLine`) 세로 타일 대신 데스크톱 표와 같은 모양 —
 * 그 그룹이 선 열만 잘라 낸 헤더 + 보기 셀 한 줄 — 을 카드 폭에 등분해 그린다. 11점 척도처럼
 * 보기가 많은 그룹이 타일 11장으로 길게 늘어지는 것을 막는 옵션이다(기본 꺼짐, 기존 모양 유지).
 *
 * 헤더는 원본 헤더 그리드를 그룹 열로 클리핑한다 — 병합 셀은 걸친 만큼만 남고, 그룹 밖 열만
 * 덮는 셀은 빠진다. 헤더 그리드가 없으면 열 제목 한 줄(숨김 설정이면 헤더 없음).
 * 좌표는 CSS grid 기준(1-based)이고 보기 셀 줄은 헤더 아래 마지막 줄이다.
 */

export interface OriginalLineHeaderCell {
  id: string;
  label: string;
  textBold: boolean;
  gridColumn: string | number;
  gridRow: string | number;
}

export interface OriginalLineOption {
  cell: TableCell;
  /** 1-based grid 열 */
  gridColumn: number;
}

export interface ChoiceGroupOriginalLine {
  columnCount: number;
  headerRowCount: number;
  headers: OriginalLineHeaderCell[];
  options: OriginalLineOption[];
}

export interface ProjectChoiceGroupOriginalLineInput {
  group: ChoiceGroup | undefined;
  /** 행의 셀과 인덱스가 맞는 열 — 표시 조건으로 걸러진 뒤의 열이어야 한다 */
  columns: readonly TableColumn[];
  headerGrid?: HeaderCell[][] | undefined;
  hideColumnLabels: boolean;
  rowCells: readonly TableCell[];
  /** 그룹에 속한 이 행의 보기 셀(보이는 것만) */
  groupCells: readonly TableCell[];
  /**
   * 상세기재 보기가 있으면 타일로 둔다 — 한 줄 칸에는 입력칸 자리가 없다. 보기 소스 표는
   * 상세기재를 카드 밖 스택에 그려서 이 제약이 없다(false 로 넘긴다).
   */
  rejectTextInput: boolean;
}

/** 원본 한 줄로 그릴 수 없으면 null — 호출부는 종전 세로 타일로 그린다. */
export function projectChoiceGroupOriginalLine(
  input: ProjectChoiceGroupOriginalLineInput,
): ChoiceGroupOriginalLine | null {
  const { group, columns, rowCells, groupCells } = input;
  if (!group?.mobileOriginalLine || group.type === 'ranking') return null;
  if (groupCells.length === 0) return null;
  if (input.rejectTextInput && groupCells.some((cell) => cell.allowTextInput)) return null;

  const indexed = groupCells.map((cell) => ({
    cell,
    colIndex: rowCells.findIndex((c) => c.id === cell.id),
  }));
  if (indexed.some(({ colIndex }) => colIndex < 0 || !columns[colIndex])) return null;
  indexed.sort((a, b) => a.colIndex - b.colIndex);

  const keptIds = new Set(indexed.map(({ colIndex }) => columns[colIndex]!.id));
  const projected = recalculateColspansForVisibleColumns(
    [...columns],
    [],
    keptIds,
    input.headerGrid,
  );

  let headers: OriginalLineHeaderCell[] = [];
  let headerRowCount = 0;
  const grid = (projected.headerGrid ?? []).filter((row) => row.length > 0);
  if (grid.length > 0) {
    headers = expandHeaderGrid(grid).map((placed) => ({
      id: placed.cell.id,
      label: placed.cell.label,
      textBold: placed.cell.textBold === true,
      gridColumn: placed.gridColumn,
      gridRow: placed.gridRow,
    }));
    headerRowCount = grid.length;
  } else if (!input.hideColumnLabels) {
    const labeled = projected.columns.map((column, index) => ({
      id: column.id,
      label: column.label,
      textBold: column.textBold === true,
      gridColumn: index + 1,
      gridRow: 1,
    }));
    if (labeled.some((header) => header.label.trim() !== '')) {
      headers = labeled;
      headerRowCount = 1;
    }
  }

  return {
    columnCount: indexed.length,
    headerRowCount,
    headers,
    options: indexed.map(({ cell }, index) => ({ cell, gridColumn: index + 1 })),
  };
}
