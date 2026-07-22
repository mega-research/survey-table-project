'use client';

import { useCallback } from 'react';
import type React from 'react';

import { PreviewCell } from '@/components/survey-builder/cells/preview-cell';
import { TablePreview } from '@/components/survey-builder/table-preview';
import { useContactAttrs } from '@/lib/survey/contact-attrs-context';
import { substituteTokens } from '@/lib/survey/substitute-tokens';
import type { HeaderCell, TableCell, TableColumn, TableRow } from '@/types/survey';
import { isMobileOriginalRowInteractiveCell } from '@/utils/mobile-original-row';

interface Props {
  columns: TableColumn[];
  rows: TableRow[];
  interactiveRowId: string;
  headerGrid?: HeaderCell[][] | undefined;
  hideColumnLabels: boolean;
  renderCell: (cell: TableCell) => React.ReactNode;
  choiceControlType?:
    | 'radio'
    | 'checkbox'
    | ((cell: TableCell) => 'radio' | 'checkbox')
    | undefined;
  scrollLeftRef?: React.MutableRefObject<number> | undefined;
  resetScrollKey?: string | number | undefined;
  errorCellIds?: Set<string> | undefined;
}

export function MobileOriginalRowTable(props: Props) {
  const {
    columns,
    headerGrid,
    hideColumnLabels,
    renderCell,
    choiceControlType,
    scrollLeftRef,
    resetScrollKey,
    errorCellIds,
  } = props;
  const { rows, interactiveRowId } = props;
  const attrs = useContactAttrs();

  const resolveChoiceControlType = useCallback(
    (cell: TableCell) =>
      typeof choiceControlType === 'function'
        ? choiceControlType(cell)
        : (choiceControlType ?? 'checkbox'),
    [choiceControlType],
  );

  const renderMobileCell = useCallback(
    (cell: TableCell, row: TableRow) => {
      const hidden = cell.mobileDisplay === 'hidden';
      if (row.id !== interactiveRowId) {
        if (hidden && !isMobileOriginalRowInteractiveCell(cell)) {
          return <span aria-hidden="true" />;
        }
        const previewCell = {
          ...cell,
          content: hidden ? '' : substituteTokens(cell.content, attrs),
        };
        return (
          <PreviewCell
            cell={previewCell}
            choiceControlType={resolveChoiceControlType(cell)}
            disableControls
          />
        );
      }
      if (!hidden) return renderCell(cell);
      if (!isMobileOriginalRowInteractiveCell(cell)) return <span aria-hidden="true" />;
      return renderCell({ ...cell, content: '' });
    },
    [attrs, interactiveRowId, renderCell, resolveChoiceControlType],
  );

  return (
    <TablePreview
      columns={columns}
      rows={rows}
      tableHeaderGrid={headerGrid}
      hideColumnLabels={hideColumnLabels}
      className="border-0 shadow-none"
      contentClassName="p-0"
      scrollLeftRef={scrollLeftRef}
      resetScrollKey={resetScrollKey}
      errorCellIds={errorCellIds}
      renderCell={renderMobileCell}
      choiceControlType={choiceControlType}
      stickyHeader={false}
      preserveRowHeights
    />
  );
}
