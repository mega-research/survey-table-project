'use client';

import { type ReactNode, useMemo, useRef } from 'react';

import {
  type DrilldownStatus,
  MobileDrilldownShell,
} from '@/components/survey-builder/mobile-drilldown-shell';
import { MobileOriginalRowTable } from '@/components/survey-builder/mobile-original-row-table';
import { useContactAttrs } from '@/lib/survey/contact-attrs-context';
import { substituteTokens } from '@/lib/survey/substitute-tokens';
import type { Question, TableCell } from '@/types/survey';
import { type ClassifiedLeaf, type ClassifiedSection, classifyTable } from '@/utils/classify-table';
import { getMobileOriginalRowLabel, projectMobileOriginalRow } from '@/utils/mobile-original-row';
import { clampMobileDrilldownOmitLeadingColumns } from '@/utils/mobile-table-display-mode';

const EMPTY_COLUMNS: NonNullable<Question['tableColumns']> = [];
const EMPTY_ROWS: NonNullable<Question['tableRowsData']> = [];

interface ChoiceTableDrilldownProps {
  question: Question;
  selectedIds: string[];
  renderChoiceCell: (cell: TableCell) => ReactNode;
  resolveChoiceLabel: (cellId: string) => string | undefined;
  counter: ReactNode;
}

export function ChoiceTableDrilldown({
  question,
  selectedIds,
  renderChoiceCell,
  resolveChoiceLabel,
  counter,
}: ChoiceTableDrilldownProps) {
  const attrs = useContactAttrs();
  const columns = question.tableColumns ?? EMPTY_COLUMNS;
  const rows = question.tableRowsData ?? EMPTY_ROWS;
  const omit = clampMobileDrilldownOmitLeadingColumns(
    question.mobileDrilldownOmitLeadingColumns,
    columns.length,
  );
  const rowById = useMemo(() => new Map(rows.map((row) => [row.id, row])), [rows]);
  const sections = useMemo(
    () =>
      classifyTable({
        tableColumns: columns,
        tableRowsData: rows,
        tableHeaderGrid: question.tableHeaderGrid,
        answerableCellTypes: ['choice_opt'],
      }),
    [columns, question.tableHeaderGrid, rows],
  );
  const selectedIdSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const titledSections = useMemo(
    () =>
      sections.map((section) => {
        const leaves = section.leaves.map((leaf) => {
          const row = rowById.get(leaf.rowId);
          return row
            ? {
                ...leaf,
                label: substituteTokens(
                  getMobileOriginalRowLabel({
                    authoredColumns: columns,
                    row,
                    omitLeadingAuthoredColumns: omit,
                    resolveChoiceLabel,
                  }),
                  attrs,
                ),
              }
            : leaf;
        });
        const firstRow = section.leaves[0] ? rowById.get(section.leaves[0].rowId) : undefined;
        const sectionLabelIsHidden =
          firstRow?.cells
            .slice(0, omit)
            .some(
              (cell) =>
                cell.type === 'text' &&
                cell.mobileDisplay === 'hidden' &&
                cell.content.trim() === section.label.trim(),
            ) ?? false;
        return {
          ...section,
          label:
            leaves.length === 1
              ? (leaves[0]?.label ?? '')
              : sectionLabelIsHidden
                ? ''
                : section.label,
          leaves,
        };
      }),
    [attrs, columns, omit, resolveChoiceLabel, rowById, sections],
  );
  const horizontalScrollRef = useRef(0);

  const getLeafStatus = (leaf: ClassifiedLeaf): DrilldownStatus => {
    const choices = (rowById.get(leaf.rowId)?.cells ?? []).filter(
      (cell) => cell.type === 'choice_opt' && !cell.isHidden && !cell._isContinuation,
    );
    return {
      completed: choices.filter((cell) => selectedIdSet.has(cell.id)).length,
      total: choices.length,
      unit: '개 선택',
    };
  };

  const getSectionStatus = (section: ClassifiedSection): DrilldownStatus => {
    const statuses = section.leaves.map(getLeafStatus);
    return {
      completed: statuses.reduce((sum, status) => sum + status.completed, 0),
      total: statuses.reduce((sum, status) => sum + status.total, 0),
      unit: '개 선택',
    };
  };

  const renderLeafDetail = (leaf: ClassifiedLeaf) => {
    const row = rowById.get(leaf.rowId);
    if (!row) return null;
    const projection = projectMobileOriginalRow({
      authoredColumns: columns,
      visibleColumns: columns,
      visibleHeaderGrid: question.tableHeaderGrid ?? undefined,
      displayRows: rows,
      selectedRowId: leaf.rowId,
      omitLeadingAuthoredColumns: omit,
    });
    if (!projection?.hasInteractiveCells) {
      return (
        <div className="space-y-3 rounded-xl border border-gray-200 bg-white p-4">
          {row.cells
            .filter((cell) => cell.type === 'choice_opt' && !cell.isHidden && !cell._isContinuation)
            .map((cell) => (
              <div key={cell.id}>{renderChoiceCell(cell)}</div>
            ))}
        </div>
      );
    }
    return (
      <MobileOriginalRowTable
        columns={projection.columns}
        row={projection.row}
        headerGrid={projection.headerGrid}
        hideColumnLabels={question.hideColumnLabels ?? false}
        scrollLeftRef={horizontalScrollRef}
        renderCell={renderChoiceCell}
      />
    );
  };

  return (
    <MobileDrilldownShell
      sections={titledSections}
      leafNavigation="always"
      getSectionStatus={getSectionStatus}
      getLeafStatus={getLeafStatus}
      renderLeafDetail={renderLeafDetail}
      footer={counter}
      onReturnToRoot={() => {
        horizontalScrollRef.current = 0;
      }}
    />
  );
}
