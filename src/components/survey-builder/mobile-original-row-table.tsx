'use client';

import { useCallback, useMemo } from 'react';
import type React from 'react';

import { TablePreview } from '@/components/survey-builder/table-preview';
import type { HeaderCell, TableCell, TableColumn, TableRow } from '@/types/survey';
import { isMobileOriginalRowInteractiveCell } from '@/utils/mobile-original-row';

interface Props {
  columns: TableColumn[];
  row: TableRow;
  headerGrid?: HeaderCell[][] | undefined;
  hideColumnLabels: boolean;
  renderCell: (cell: TableCell) => React.ReactNode;
  scrollLeftRef?: React.MutableRefObject<number> | undefined;
  resetScrollKey?: string | number | undefined;
  errorCellIds?: Set<string> | undefined;
}

export function MobileOriginalRowTable({
  columns,
  row,
  headerGrid,
  hideColumnLabels,
  renderCell,
  scrollLeftRef,
  resetScrollKey,
  errorCellIds,
}: Props) {
  const rows = useMemo(() => [row], [row]);
  const renderMobileCell = useCallback(
    (cell: TableCell) => {
      if (cell.mobileDisplay !== 'hidden') return renderCell(cell);
      if (!isMobileOriginalRowInteractiveCell(cell)) {
        return <span aria-hidden="true" />;
      }
      return renderCell({ ...cell, content: '' });
    },
    [renderCell],
  );

  return (
    <TablePreview
      columns={columns}
      rows={rows}
      tableHeaderGrid={headerGrid}
      hideColumnLabels={hideColumnLabels}
      className="border-0 shadow-none"
      scrollLeftRef={scrollLeftRef}
      resetScrollKey={resetScrollKey}
      errorCellIds={errorCellIds}
      renderCell={renderMobileCell}
    />
  );
}
