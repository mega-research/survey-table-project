import type { HeaderCell, Question, TableColumn, TableRow } from '@/types/survey';
import { shouldDisplayColumn, shouldDisplayRow } from '@/utils/branch-logic';
import {
  recalculateColspansForVisibleColumns,
  recalculateRowspansForVisibleRows,
} from '@/utils/table-merge-helpers';

interface ProjectConditionalTableLayoutInput {
  columns: TableColumn[];
  rows: TableRow[];
  headerGrid?: HeaderCell[][] | undefined;
  allResponses?: Record<string, unknown> | undefined;
  allQuestions?: Question[] | undefined;
}

export interface ConditionalTableLayout {
  columns: TableColumn[];
  rows: TableRow[];
  headerGrid?: HeaderCell[][] | undefined;
}

export function projectConditionalTableLayout(
  input: ProjectConditionalTableLayoutInput,
): ConditionalTableLayout {
  const { allResponses, allQuestions } = input;
  if (!allResponses || !allQuestions) {
    return {
      columns: input.columns,
      rows: input.rows,
      ...(input.headerGrid ? { headerGrid: input.headerGrid } : {}),
    };
  }

  const visibleColumnIds = new Set(
    input.columns
      .filter((column) => shouldDisplayColumn(column, allResponses, allQuestions))
      .map((column) => column.id),
  );
  const columnProjection = recalculateColspansForVisibleColumns(
    input.columns,
    input.rows,
    visibleColumnIds,
    input.headerGrid,
  );
  const visibleRowIds = new Set(
    columnProjection.rows
      .filter((row) => shouldDisplayRow(row, allResponses, allQuestions))
      .map((row) => row.id),
  );

  return {
    columns: columnProjection.columns,
    rows: recalculateRowspansForVisibleRows(columnProjection.rows, visibleRowIds),
    ...(columnProjection.headerGrid ? { headerGrid: columnProjection.headerGrid } : {}),
  };
}
