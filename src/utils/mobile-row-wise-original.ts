import type { HeaderCell, TableCell, TableColumn, TableRow } from '@/types/survey';
import { type ClassifiedLeaf, classifyTable } from '@/utils/classify-table';
import {
  excludeMobileDrilldownRepeatedRows,
  getMobileDrilldownRepeatedBodyRowIds,
  includesMobileDrilldownColumnHeader,
  resolveMobileDrilldownRepeatHeaderRange,
} from '@/utils/mobile-drilldown-repeat-header';
import {
  type MobileOriginalRowProjection,
  getMobileOriginalRowLabelCandidate,
  projectMobileOriginalRow,
} from '@/utils/mobile-original-row';
import { buildTableRowspanCoverage } from '@/utils/table-rowspan-coverage';

export interface OriginalRowDetailSettings {
  omitLeadingAuthoredColumns: number;
  repeatHeaderStartRow?: number | null | undefined;
  repeatHeaderEndRow?: number | null | undefined;
}

export interface MobileRowWiseOriginalQuestion {
  rowId: string;
  title: string;
  projection: MobileOriginalRowProjection;
}

export interface MobileRowWiseOriginalSubgroup {
  id: string;
  label: string;
  questions: MobileRowWiseOriginalQuestion[];
}

export interface MobileRowWiseOriginalSection {
  id: string;
  label: string;
  subgroups: MobileRowWiseOriginalSubgroup[];
}

export interface MobileRowWiseOriginalModel {
  sections: MobileRowWiseOriginalSection[];
}

interface BuildMobileRowWiseOriginalModelInput {
  authoredColumns: TableColumn[];
  authoredRows: TableRow[];
  visibleColumns: TableColumn[];
  visibleHeaderGrid?: HeaderCell[][] | undefined;
  displayRows: TableRow[];
  hideColumnLabels: boolean;
  settings: OriginalRowDetailSettings;
  answerableCellTypes?: readonly TableCell['type'][] | undefined;
  resolveChoiceLabel?: ((cellId: string) => string | undefined) | undefined;
  isLabelSourceHidden?: ((cellId: string) => boolean) | undefined;
}

function orderByAuthoredRows(authoredRows: TableRow[], displayRows: TableRow[]): TableRow[] {
  const authoredPosition = new Map(authoredRows.map((row, index) => [row.id, index]));
  const displayPosition = new Map(displayRows.map((row, index) => [row.id, index]));
  return [...displayRows].sort((left, right) => {
    const leftPosition = authoredPosition.get(left.id) ?? authoredRows.length;
    const rightPosition = authoredPosition.get(right.id) ?? authoredRows.length;
    if (leftPosition !== rightPosition) return leftPosition - rightPosition;
    return (displayPosition.get(left.id) ?? 0) - (displayPosition.get(right.id) ?? 0);
  });
}

function subgroupIdentity(leaf: ClassifiedLeaf): string {
  return leaf.subGroupSourceCellId ?? `subgroup:${leaf.subGroup}`;
}

function materializeRowsForClassification(
  fullRows: TableRow[],
  navigationRows: TableRow[],
): TableRow[] {
  const coverage = buildTableRowspanCoverage(fullRows);
  return navigationRows.map((row) => {
    const coveredCells = coverage.get(row.id) ?? row.cells;
    return {
      ...row,
      cells: row.cells.map((cell, columnIndex) => {
        const source = coveredCells[columnIndex];
        if (
          !source ||
          source.id === cell.id ||
          (!cell.isHidden && !cell._isContinuation)
        ) {
          return cell;
        }
        const materialized = { ...source };
        delete materialized.rowspan;
        delete materialized.isHidden;
        delete materialized._isContinuation;
        return materialized;
      }),
    };
  });
}

export function buildMobileRowWiseOriginalModel(
  input: BuildMobileRowWiseOriginalModelInput,
): MobileRowWiseOriginalModel {
  const orderedDisplayRows = orderByAuthoredRows(input.authoredRows, input.displayRows);
  const repeatHeaderRange = resolveMobileDrilldownRepeatHeaderRange({
    mobileDrilldownRepeatHeaderStartRow: input.settings.repeatHeaderStartRow,
    mobileDrilldownRepeatHeaderEndRow: input.settings.repeatHeaderEndRow,
    hideColumnLabels: input.hideColumnLabels,
  });
  const repeatedRowIds = getMobileDrilldownRepeatedBodyRowIds(
    input.authoredRows,
    repeatHeaderRange,
  );
  const navigationRows = excludeMobileDrilldownRepeatedRows(
    orderedDisplayRows,
    repeatedRowIds,
  );
  const rowById = new Map(orderedDisplayRows.map((row) => [row.id, row]));
  const resolveChoiceLabel = input.resolveChoiceLabel ?? (() => undefined);
  const classificationRows = materializeRowsForClassification(
    orderedDisplayRows,
    navigationRows,
  );
  const classifiedSections = classifyTable({
    tableColumns: input.visibleColumns,
    tableRowsData: classificationRows,
    tableHeaderGrid: input.visibleHeaderGrid,
    answerableCellTypes: input.answerableCellTypes,
  });

  const sections = classifiedSections.flatMap<MobileRowWiseOriginalSection>(
    (section, sectionIndex) => {
      const subgroups: MobileRowWiseOriginalSubgroup[] = [];

      for (const leaf of section.leaves) {
        const row = rowById.get(leaf.rowId);
        if (!row) continue;
        const projection = projectMobileOriginalRow({
          authoredColumns: input.authoredColumns,
          visibleColumns: input.visibleColumns,
          visibleHeaderGrid: input.visibleHeaderGrid,
          displayRows: orderedDisplayRows,
          selectedRowId: row.id,
          omitLeadingAuthoredColumns: input.settings.omitLeadingAuthoredColumns,
          repeatedRowIds,
          includeColumnHeader: includesMobileDrilldownColumnHeader(repeatHeaderRange),
        });
        if (!projection?.hasInteractiveCells) continue;

        const title = getMobileOriginalRowLabelCandidate({
          authoredColumns: input.authoredColumns,
          row,
          omitLeadingAuthoredColumns: input.settings.omitLeadingAuthoredColumns,
          resolveChoiceLabel,
          rowLabelSourceCellId: leaf.labelSourceCellId,
          isLabelSourceHidden: input.isLabelSourceHidden,
        }).label;
        const subgroupLabel =
          leaf.subGroupSourceCellId && input.isLabelSourceHidden?.(leaf.subGroupSourceCellId)
            ? ''
            : leaf.subGroup.trim();
        const id = subgroupIdentity(leaf);
        const previous = subgroups.at(-1);
        const subgroup =
          previous?.id === id
            ? previous
            : (() => {
                const next: MobileRowWiseOriginalSubgroup = {
                  id: `${sectionIndex}:${id}:${subgroups.length}`,
                  label: subgroupLabel,
                  questions: [],
                };
                subgroups.push(next);
                return next;
              })();
        subgroup.questions.push({ rowId: row.id, title, projection });
      }

      const questions = subgroups.flatMap((subgroup) => subgroup.questions);
      if (questions.length === 0) return [];
      const rawSectionLabel =
        section.labelSourceCellId && input.isLabelSourceHidden?.(section.labelSourceCellId)
          ? ''
          : section.label.trim();
      const label =
        questions.length === 1 && rawSectionLabel === questions[0]?.title
          ? ''
          : rawSectionLabel;

      return [{
        id: section.labelSourceCellId ?? `section:${sectionIndex}`,
        label,
        subgroups,
      }];
    },
  );

  return { sections };
}
