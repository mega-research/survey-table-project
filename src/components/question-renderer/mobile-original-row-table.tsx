'use client';

import { useCallback } from 'react';
import type React from 'react';

import { PreviewCell } from '@/components/question-renderer/cells/preview-cell';
import { TablePreview } from '@/components/question-renderer/table-preview';
import { useAnswerQuotes, useContactAttrs } from '@/lib/survey/contact-attrs-context';
import { substituteTokens } from '@/lib/survey/substitute-tokens';
import type { HeaderCell, TableCell, TableColumn, TableRow } from '@/types/survey';
import { isMobileOriginalRowInteractiveCell } from '@/components/question-renderer/utils/mobile-original-row';

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
  instanceScope?: string | undefined;
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
    instanceScope,
  } = props;
  const { rows, interactiveRowId } = props;
  const attrs = useContactAttrs();
  const quotes = useAnswerQuotes();

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
        const substitutedContent = hidden ? '' : substituteTokens(cell.content, attrs, quotes);
        const previewCell = { ...cell, content: substitutedContent };
        return (
          <PreviewCell
            cell={previewCell}
            // image/video 는 PreviewCell 이 자체적으로(또는 위임한 ImageCell/VideoCell 이)
            // cell.content 를 다시 치환할 수 있어, 위에서 이미 치환한 값을 명시적으로
            // 넘겨 이중 치환을 막는다(cell-options-container.tsx 의 opt-in 패턴과 동일).
            // 다른 타입은 previewCell.content 폴백을 그대로 쓰므로 영향 없다.
            content={substitutedContent}
            choiceControlType={resolveChoiceControlType(cell)}
            disableControls
          />
        );
      }
      if (!hidden) return renderCell(cell);
      if (!isMobileOriginalRowInteractiveCell(cell)) return <span aria-hidden="true" />;
      return renderCell({ ...cell, content: '' });
    },
    [attrs, quotes, interactiveRowId, renderCell, resolveChoiceControlType],
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
      getCellInstanceId={
        instanceScope
          ? (cell, row) => `${instanceScope}:${row.id}:${cell.id}`
          : undefined
      }
      renderCell={renderMobileCell}
      choiceControlType={choiceControlType}
      stickyHeader={false}
      preserveRowHeights
      applyCellBackground={false}
    />
  );
}
