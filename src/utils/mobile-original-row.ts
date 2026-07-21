import type { HeaderCell, TableCell, TableColumn, TableRow } from '@/types/survey';
import { clampMobileDrilldownOmitLeadingColumns } from '@/utils/mobile-table-display-mode';
import { recalculateColspansForVisibleColumns } from '@/utils/table-merge-helpers';

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

  const row: TableRow = {
    ...selected,
    cells: selected.cells.map((cell) => {
      const normalized = { ...cell };
      delete normalized.rowspan;
      return normalized;
    }),
  };

  return {
    columns: projected.columns,
    row,
    ...(projected.headerGrid ? { headerGrid: projected.headerGrid } : {}),
    hasInteractiveCells: row.cells.some(isMobileOriginalRowInteractiveCell),
  };
}

export function getMobileOriginalRowLabel({
  authoredColumns,
  row,
  omitLeadingAuthoredColumns,
  resolveChoiceLabel,
}: {
  authoredColumns: TableColumn[];
  row: TableRow;
  omitLeadingAuthoredColumns: number;
  resolveChoiceLabel: (cellId: string) => string | undefined;
}): string {
  const omit = clampMobileDrilldownOmitLeadingColumns(
    omitLeadingAuthoredColumns,
    authoredColumns.length,
  );
  for (let index = omit - 1; index >= 0; index -= 1) {
    const cell = row.cells[index];
    if (
      cell?.type === 'text' &&
      !cell.isHidden &&
      !cell._isContinuation &&
      cell.mobileDisplay !== 'hidden' &&
      cell.content.trim()
    ) {
      return cell.content.trim();
    }
  }

  const explicitlyHiddenLabels = getMobileOriginalRowHiddenLabelCandidates({
    row,
    resolveChoiceLabel,
  });
  if (row.label.trim() && !explicitlyHiddenLabels.includes(row.label.trim())) {
    return row.label.trim();
  }

  const choice = row.cells.find(
    (cell) =>
      cell.type === 'choice_opt' &&
      !cell.isHidden &&
      !cell._isContinuation &&
      cell.mobileDisplay !== 'hidden',
  );
  return (choice && resolveChoiceLabel(choice.id)) || '(라벨 없음)';
}

export function getMobileOriginalRowHiddenLabelCandidates({
  row,
  resolveChoiceLabel,
}: {
  row: TableRow;
  resolveChoiceLabel: (cellId: string) => string | undefined;
}): string[] {
  return row.cells.flatMap((cell) => {
    if (cell.mobileDisplay !== 'hidden') return [];
    const labels = cell.content.trim() ? [cell.content.trim()] : [];
    if (cell.type !== 'choice_opt') return labels;
    const choiceLabel = resolveChoiceLabel(cell.id)?.trim();
    return choiceLabel ? [...labels, choiceLabel] : labels;
  });
}
