'use client';

import { useCallback, useMemo, useRef } from 'react';
import type React from 'react';

import { PreviewCell } from '@/features/question-renderer/cells/preview-cell';
import { useElementWidthBeforePaint } from '@/features/question-renderer/hooks/use-element-width';
import { TablePreview } from '@/features/question-renderer/table-preview';
import { useAnswerQuotes, useContactAttrs } from '@/features/question-renderer/contact-attrs-context';
import { substituteTokens } from '@/lib/survey/substitute-tokens';
import type { HeaderCell, TableCell, TableColumn, TableRow } from '@/types/survey';
import { isMobileOriginalRowInteractiveCell } from '@/features/question-renderer/utils/mobile-original-row';
import {
  type MobilePieceSettings,
  arrangeMobilePiece,
  resolveHeaderOverflowDirections,
  resolvePieceFitColumnWidth,
} from '@/features/question-renderer/utils/mobile-piece-arrangement';

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
  /** 표가 자리보다 좁을 때 놓이는 쪽 — 기본은 가운데, 넓은 화면의 행 단위 배치는 `start` */
  align?: 'center' | 'start' | undefined;
  /**
   * 조각 좌우 반전 · 조각 한 화면 칸 수(원본 행 상세 설정) — 좁은 화면에서 한 행을 통째로 그리는 조각의
   * 호스트(행별 원본 문항 보기 · 선택 행 원본 보기)만 넘긴다. 넓은 화면의 행 단위 배치와 원본 한 줄 조각은
   * 넘기지 않는다. 판정은 utils/mobile-piece-arrangement 하나다.
   */
  pieceSettings?: MobilePieceSettings | undefined;
}

export function MobileOriginalRowTable(props: Props) {
  const {
    hideColumnLabels,
    renderCell,
    choiceControlType,
    scrollLeftRef,
    resetScrollKey,
    errorCellIds,
    instanceScope,
    align,
    pieceSettings,
  } = props;
  const { interactiveRowId } = props;
  // 그리기 직전에 순서와 폭 규칙을 정한다 — 꺼져 있으면 받은 열·행을 같은 참조로 돌려받는다
  const arrangement = useMemo(
    () =>
      arrangeMobilePiece(
        {
          columns: props.columns,
          headerGrid: props.headerGrid,
          rows: props.rows,
          interactiveRowId,
        },
        {
          reverseColumns: pieceSettings?.reverseColumns,
          columnsPerView: pieceSettings?.columnsPerView,
        },
      ),
    [
      props.columns,
      props.headerGrid,
      props.rows,
      interactiveRowId,
      pieceSettings?.reverseColumns,
      pieceSettings?.columnsPerView,
    ],
  );
  const { rows, headerGrid } = arrangement.piece;

  // 한 화면 칸 수 — 조각이 놓인 자리의 폭을 그리기 전에 재서 칸 폭을 낸다(원본 폭으로 한 번 그렸다가 바뀌면
  // 칸이 튄다). 자리 폭을 못 잰 동안(0)은 원본 폭 그대로다.
  const { fit } = arrangement;
  const slotRef = useRef<HTMLDivElement>(null);
  const slotWidth = useElementWidthBeforePaint(slotRef, fit === null);
  const fitColumnWidth = fit ? resolvePieceFitColumnWidth(slotWidth, fit) : null;
  const columns = useMemo(
    () =>
      fitColumnWidth === null
        ? arrangement.piece.columns
        : arrangement.piece.columns.map((column) => ({ ...column, width: fitColumnWidth })),
    [arrangement.piece.columns, fitColumnWidth],
  );
  const headerOverflow = useMemo(
    () =>
      fitColumnWidth === null
        ? undefined
        : resolveHeaderOverflowDirections({ columns: arrangement.piece.columns, headerGrid }),
    [arrangement.piece.columns, headerGrid, fitColumnWidth],
  );
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

  const table = (
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
      align={align}
      narrowCells={fitColumnWidth !== null}
      headerOverflow={headerOverflow}
    />
  );

  // 자리 폭을 재는 상자는 한 화면 칸 수가 적용되는 조각에만 둔다 — 그 밖의 조각은 마크업이 지금 그대로다
  if (fit === null) return table;
  return (
    <div ref={slotRef} data-piece-columns-per-view={fit.columnsPerView}>
      {table}
    </div>
  );
}
