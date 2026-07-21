import type { HeaderCell, TableCell, TableColumn, TableRow } from '@/types/survey';
import { clampMobileDrilldownOmitLeadingColumns } from '@/utils/mobile-table-display-mode';
import { recalculateColspansForVisibleColumns } from '@/utils/table-merge-helpers';
import { buildTableRowspanCoverage } from '@/utils/table-rowspan-coverage';

export const MOBILE_ORIGINAL_ROW_INTERACTIVE_TYPES = [
  'checkbox',
  'radio',
  'select',
  'input',
  'ranking',
  'choice_opt',
] as const satisfies readonly TableCell['type'][];

export const MOBILE_TABLE_COMPLETION_TYPES = [
  'checkbox',
  'radio',
  'select',
  'input',
  'ranking',
] as const satisfies readonly TableCell['type'][];

const INTERACTIVE = new Set<TableCell['type']>(MOBILE_ORIGINAL_ROW_INTERACTIVE_TYPES);

export function isMobileOriginalRowInteractiveCell(cell: TableCell): boolean {
  return !cell.isHidden && !cell._isContinuation && INTERACTIVE.has(cell.type);
}

export interface ProjectMobileOriginalRowInput {
  authoredColumns: TableColumn[];
  visibleColumns: TableColumn[];
  visibleHeaderGrid?: HeaderCell[][] | undefined;
  displayRows: TableRow[];
  selectedRowId: string;
  omitLeadingAuthoredColumns: number;
}

export interface MobileOriginalRowProjection {
  columns: TableColumn[];
  row: TableRow;
  headerGrid?: HeaderCell[][] | undefined;
  hasInteractiveCells: boolean;
  sourceRowIdByCellId: ReadonlyMap<string, string>;
}

export function projectMobileOriginalRow(
  input: ProjectMobileOriginalRowInput,
): MobileOriginalRowProjection | null {
  const omit = clampMobileDrilldownOmitLeadingColumns(
    input.omitLeadingAuthoredColumns,
    input.authoredColumns.length,
  );
  const omittedIds = new Set(input.authoredColumns.slice(0, omit).map((column) => column.id));
  const keptVisibleIds = new Set(
    input.visibleColumns.filter((column) => !omittedIds.has(column.id)).map((column) => column.id),
  );
  const projected = recalculateColspansForVisibleColumns(
    input.visibleColumns,
    input.displayRows,
    keptVisibleIds,
    input.visibleHeaderGrid,
  );
  const selected = projected.rows.find((row) => row.id === input.selectedRowId);
  if (!selected) return null;
  const coverage = buildTableRowspanCoverage(projected.rows);
  const selectedCoverage = coverage.get(selected.id) ?? selected.cells;
  const originalSourceRowIdByCellId = new Map<string, string>();
  for (const projectedRow of projected.rows) {
    for (const cell of projectedRow.cells) {
      originalSourceRowIdByCellId.set(cell.id, projectedRow.id);
    }
  }
  const sourceRowIdByCellId = new Map<string, string>();

  const row: TableRow = {
    ...selected,
    cells: selected.cells.map((cell, columnIndex) => {
      const source = selectedCoverage[columnIndex];
      const materializesAnchor =
        source != null && source.id !== cell.id && (cell.isHidden || cell._isContinuation);
      const normalized = { ...(materializesAnchor ? source : cell) };
      delete normalized.rowspan;
      if (materializesAnchor) {
        delete normalized.isHidden;
        delete normalized._isContinuation;
      }
      sourceRowIdByCellId.set(
        normalized.id,
        originalSourceRowIdByCellId.get(normalized.id) ?? selected.id,
      );
      return normalized;
    }),
  };

  return {
    columns: projected.columns,
    row,
    ...(projected.headerGrid ? { headerGrid: projected.headerGrid } : {}),
    hasInteractiveCells: row.cells.some(isMobileOriginalRowInteractiveCell),
    sourceRowIdByCellId,
  };
}

export function getMobileOriginalRowLabel({
  authoredColumns,
  row,
  omitLeadingAuthoredColumns,
  resolveChoiceLabel,
  rowLabelSourceCellId,
  isLabelSourceHidden,
}: {
  authoredColumns: TableColumn[];
  row: TableRow;
  omitLeadingAuthoredColumns: number;
  resolveChoiceLabel: (cellId: string) => string | undefined;
  rowLabelSourceCellId?: string | undefined;
  isLabelSourceHidden?: ((cellId: string) => boolean) | undefined;
}): string {
  return getMobileOriginalRowLabelCandidate({
    authoredColumns,
    row,
    omitLeadingAuthoredColumns,
    resolveChoiceLabel,
    rowLabelSourceCellId,
    isLabelSourceHidden,
  }).label;
}

export interface MobileOriginalRowLabelCandidate {
  label: string;
  sourceCellId?: string | undefined;
}

export function getMobileOriginalRowLabelCandidate({
  authoredColumns,
  row,
  omitLeadingAuthoredColumns,
  resolveChoiceLabel,
  rowLabelSourceCellId,
  isLabelSourceHidden,
}: {
  authoredColumns: TableColumn[];
  row: TableRow;
  omitLeadingAuthoredColumns: number;
  resolveChoiceLabel: (cellId: string) => string | undefined;
  rowLabelSourceCellId?: string | undefined;
  isLabelSourceHidden?: ((cellId: string) => boolean) | undefined;
}): MobileOriginalRowLabelCandidate {
  const omit = clampMobileDrilldownOmitLeadingColumns(
    omitLeadingAuthoredColumns,
    authoredColumns.length,
  );
  for (let index = omit - 1; index >= 0; index -= 1) {
    const cell = row.cells[index];
    if (
      cell != null &&
      (cell.type === 'text' || cell.type === 'image' || cell.type === 'video') &&
      !cell.isHidden &&
      !cell._isContinuation &&
      cell.mobileDisplay !== 'hidden' &&
      cell.content.trim()
    ) {
      return { label: cell.content.trim(), sourceCellId: cell.id };
    }
  }

  const rowLabel = row.label.trim();
  if (rowLabel) {
    const inferredSource = rowLabelSourceCellId
      ? undefined
      : [...row.cells].reverse().find((cell) => {
          if (cell.type === 'choice_opt') return resolveChoiceLabel(cell.id)?.trim() === rowLabel;
          return cell.content.trim() === rowLabel;
        });
    const sourceCellId = rowLabelSourceCellId ?? inferredSource?.id;
    const sourceIsHidden = sourceCellId
      ? (isLabelSourceHidden?.(sourceCellId)
        ?? inferredSource?.mobileDisplay === 'hidden')
      : false;
    if (!sourceIsHidden) {
      return {
        label: rowLabel,
        ...(sourceCellId ? { sourceCellId } : {}),
      };
    }
  }

  const choice = row.cells.find(
    (cell) =>
      cell.type === 'choice_opt' &&
      !cell.isHidden &&
      !cell._isContinuation &&
      cell.mobileDisplay !== 'hidden',
  );
  const choiceLabel = choice ? resolveChoiceLabel(choice.id)?.trim() : undefined;
  return choice && choiceLabel
    ? { label: choiceLabel, sourceCellId: choice.id }
    : { label: '(라벨 없음)' };
}
