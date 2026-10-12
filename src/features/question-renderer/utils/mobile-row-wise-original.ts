import type { HeaderCell, TableCell, TableColumn, TableRow } from '@/types/survey';
import { type ClassifiedLeaf, classifyTable } from '@/features/question-renderer/utils/classify-table';
import {
  excludeMobileDrilldownRepeatedRows,
  getMobileDrilldownRepeatedBodyRowIds,
  includesMobileDrilldownColumnHeader,
  resolveMobileDrilldownRepeatHeaderRange,
} from '@/utils/mobile-drilldown-repeat-header';
import {
  type MobileOriginalRowProjection,
  getMobileOriginalRowLabelCandidate,
  isMobileOriginalRowInteractiveCell,
  projectMobileOriginalRow,
} from '@/features/question-renderer/utils/mobile-original-row';
import { clampMobileDrilldownOmitLeadingColumns } from '@/utils/mobile-table-display-mode';
import { buildTableRowspanCoverage } from '@/features/question-renderer/utils/table-rowspan-coverage';

export interface OriginalRowDetailSettings {
  omitLeadingAuthoredColumns: number;
  repeatHeaderStartRow?: number | null | undefined;
  repeatHeaderEndRow?: number | null | undefined;
}

export interface MobileRowWiseOriginalQuestion {
  rowId: string;
  title: string;
  projection: MobileOriginalRowProjection;
  /**
   * 「앞쪽 열 제외」로 조각에서 빠진 열에 놓인 이 행의 응답 칸 — 대개 그 열은 글자(행 제목)지만
   * 「기타」 행처럼 입력칸이 놓이기도 한다. 조각에는 자리가 없어 행 제목 아래에 따로 그린다.
   * 빠뜨리면 응답자가 채울 수 없는 칸이 된다.
   */
  omittedAnswerCells: TableCell[];
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

  const omit = clampMobileDrilldownOmitLeadingColumns(
    input.settings.omitLeadingAuthoredColumns,
    input.authoredColumns.length,
  );
  const omittedColumnIds = new Set(
    input.authoredColumns.slice(0, omit).map((column) => column.id),
  );
  const omittedVisibleIndices = input.visibleColumns.flatMap((column, index) =>
    omittedColumnIds.has(column.id) ? [index] : [],
  );

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
        if (!projection) continue;
        const omittedAnswerCells = omittedVisibleIndices.flatMap((index) => {
          const cell = row.cells[index];
          return cell && isMobileOriginalRowInteractiveCell(cell) ? [cell] : [];
        });
        if (!projection.hasInteractiveCells && omittedAnswerCells.length === 0) continue;

        const title = getMobileOriginalRowLabelCandidate({
          authoredColumns: input.authoredColumns,
          row,
          omitLeadingAuthoredColumns: input.settings.omitLeadingAuthoredColumns,
          resolveChoiceLabel,
          rowLabelSourceCellId: leaf.labelSourceCellId,
          isLabelSourceHidden: input.isLabelSourceHidden,
          // 행 제목은 카드 머리글이라 라벨이 없으면 자리 자체를 비운다
          fallbackLabel: '',
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
        subgroup.questions.push({ rowId: row.id, title, projection, omittedAnswerCells });
      }

      const questions = subgroups.flatMap((subgroup) => subgroup.questions);
      if (questions.length === 0) return [];
      const rawSectionLabel =
        section.labelSourceCellId && input.isLabelSourceHidden?.(section.labelSourceCellId)
          ? ''
          : section.label.trim();
      const only = questions.length === 1 ? questions[0] : undefined;
      const duplicatesTitle = only !== undefined && rawSectionLabel === only.title;
      // 섹션 이름과 행 제목이 같으면 한 번만 보인다. 보통은 행 제목 쪽을 남기지만, 제목 열 자리에
      // 응답 칸이 놓여 행 제목을 섹션 열에서 빌려 온 행(「⑩ 기타」 + 입력칸)은 섹션 머리를 남긴다 —
      // 이웃 행들과 같은 머리 모양이 되고, 입력칸이 제목 자리를 채운다.
      const keepsSectionHeader = duplicatesTitle && only.omittedAnswerCells.length > 0;
      if (keepsSectionHeader) only.title = '';
      const label = duplicatesTitle && !keepsSectionHeader ? '' : rawSectionLabel;

      return [{
        id: section.labelSourceCellId ?? `section:${sectionIndex}`,
        label,
        subgroups,
      }];
    },
  );

  return { sections };
}
