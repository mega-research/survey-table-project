import type { HeaderCell, Question, TableColumn, TableRow } from '@/types/survey';
import type { BranchEvalCtx } from '@/utils/branch-eval';
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
  /** 조건 평가 컨텍스트. 빠뜨리면 attr/lookup 피연산자가 undefined 로 평가된다. */
  evalCtx?: BranchEvalCtx | undefined;
}

export interface ConditionalTableLayout {
  columns: TableColumn[];
  rows: TableRow[];
  headerGrid?: HeaderCell[][] | undefined;
}

export function projectConditionalTableLayout(
  input: ProjectConditionalTableLayoutInput,
): ConditionalTableLayout {
  const { allResponses, allQuestions, evalCtx } = input;
  if (!allResponses || !allQuestions) {
    return {
      columns: input.columns,
      rows: input.rows,
      ...(input.headerGrid ? { headerGrid: input.headerGrid } : {}),
    };
  }

  const visibleColumnIds = new Set(
    input.columns
      .filter((column) => shouldDisplayColumn(column, allResponses, allQuestions, evalCtx))
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
      .filter((row) => shouldDisplayRow(row, allResponses, allQuestions, evalCtx))
      .map((row) => row.id),
  );

  return {
    columns: columnProjection.columns,
    rows: recalculateRowspansForVisibleRows(columnProjection.rows, visibleRowIds),
    ...(columnProjection.headerGrid ? { headerGrid: columnProjection.headerGrid } : {}),
  };
}
