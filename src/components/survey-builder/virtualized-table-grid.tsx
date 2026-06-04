'use client';

/**
 * 가상화 테이블 Grid — "측정 후 교체" + 행 단위 메모이제이션
 *
 * 성능 핵심:
 * - 각 행을 React.memo로 분리 → visibility 바뀐 행만 리렌더 (O(1))
 * - 뷰포트 밖 행: 캐시된 정확한 높이의 placeholder (지터 0)
 * - CSS Grid 구조 100% 보존 (border, rowspan, colspan)
 */
import React, { useMemo } from 'react';

import { cn } from '@/lib/utils';
import { useCellHeightCache } from '@/hooks/use-cell-height-cache';
import { useRowHeights } from '@/hooks/use-row-heights';
import { useRowVisibility } from '@/hooks/use-row-visibility';
import { useTablePerf } from '@/hooks/use-table-perf';
import type { TableColumn, TableRow } from '@/types/survey';
import {
  getAlignmentClasses,
  getGridCellAria,
  type StickyLeftInfo,
} from '@/utils/table-grid-utils';

const STICKY_BODY_Z = 10;

import { InteractiveCell } from './cells';

// ── 행 단위 메모이제이션 컴포넌트 ──

interface VirtualizedRowProps {
  row: TableRow;
  rowIdx: number;
  gridRow: number | undefined;
  completed: boolean;
  visible: boolean;
  cachedHeight: number | undefined;
  estimatedHeight: number;
  questionId: string;
  isTestMode: boolean;
  value?: Record<string, any>;
  onChange?: (value: Record<string, any>) => void;
  sentinelRef: (el: HTMLElement | null) => void;
  measureRef: (el: HTMLElement | null) => void;
  stickyInfo?: StickyLeftInfo;
}

const VirtualizedRow = React.memo(
  function VirtualizedRow({
    row,
    gridRow,
    completed,
    visible,
    cachedHeight,
    estimatedHeight,
    questionId,
    isTestMode,
    value,
    onChange,
    sentinelRef,
    measureRef,
    stickyInfo,
  }: VirtualizedRowProps) {
    const stickyCount = stickyInfo?.stickyColCount ?? 0;
    return (
      <>
        {row.cells.map((cell, cellIndex) => {
          if (cell.isHidden) return null;

          const col = cellIndex + 1;
          const rs = cell.rowspan || 1;
          const cs = cell.colspan || 1;
          const isFirstVisibleCell =
            cellIndex === 0 || row.cells.slice(0, cellIndex).every((c) => c.isHidden);
          const isSticky = cellIndex < stickyCount;
          const isLastSticky = isSticky && cellIndex === stickyCount - 1;
          // 좌측 sticky 정적 셀은 placeholder 대신 항상 실제 콘텐츠 렌더
          const renderContent = visible || isSticky;

          const style: React.CSSProperties = {
            gridRow: rs > 1 ? `${gridRow} / span ${rs}` : gridRow,
            gridColumn: cs > 1 ? `${col} / span ${cs}` : col,
          };
          if (isSticky && stickyInfo) {
            style.position = 'sticky';
            style.left = stickyInfo.leftOffsets[cellIndex];
            style.zIndex = STICKY_BODY_Z;
            if (isLastSticky) {
              style.boxShadow = '2px 0 4px rgba(0,0,0,0.06)';
            }
          }

          return (
            <div
              key={cell.id}
              ref={isFirstVisibleCell ? sentinelRef : undefined}
              className={cn(
                'min-w-0 border-r border-b border-gray-300 p-2 transition-colors duration-200 [overflow-wrap:anywhere]',
                isSticky
                  ? (completed ? 'bg-green-50' : 'bg-white')
                  : (completed ? 'bg-green-50/40' : 'bg-white'),
                getAlignmentClasses(cell.horizontalAlign, cell.verticalAlign),
              )}
              style={style}
              data-row-id={row.id}
              data-grid-cell
              {...getGridCellAria('gridcell', cs, rs)}
            >
              {renderContent ? (
                // visible=true일 때만 measureRef를 달아 정확한 높이 측정 (sticky 상시 렌더가 cache를 오염시키지 않도록)
                <div ref={isFirstVisibleCell && visible ? measureRef : undefined}>
                  <InteractiveCell
                    cell={cell}
                    questionId={questionId}
                    isTestMode={isTestMode}
                    value={value}
                    onChange={onChange}
                  />
                </div>
              ) : cachedHeight != null ? (
                <div style={{ height: cachedHeight }}>
                  <span className="sr-only">{cell.content}</span>
                </div>
              ) : (
                <div style={{ height: estimatedHeight }}>
                  <span className="sr-only">{cell.content}</span>
                </div>
              )}
            </div>
          );
        })}
      </>
    );
  },
  // 커스텀 비교: visible, completed, row, stickyInfo 변경 시에만 리렌더
  (prev, next) =>
    prev.visible === next.visible &&
    prev.completed === next.completed &&
    prev.row === next.row &&
    prev.gridRow === next.gridRow &&
    prev.cachedHeight === next.cachedHeight &&
    prev.value === next.value &&
    prev.stickyInfo === next.stickyInfo,
);

// ── Props ──

interface VirtualizedTableGridProps {
  questionId: string;
  displayRows: TableRow[];
  visibleColumns: TableColumn[];
  rowCompletionMap: Map<string, boolean>;
  rowGridMap: Map<string, number>;
  isTestMode?: boolean;
  value?: Record<string, any>;
  onChange?: (value: Record<string, any>) => void;
  renderSelectorRows?: () => React.ReactNode;
  gridTemplateCols: string;
  totalWidth: number;
  stickyInfo?: StickyLeftInfo;
  // 컨테이너가 내부 세로 스크롤 영역일 때 IntersectionObserver root로 사용 (미지정 시 뷰포트)
  scrollRootRef?: React.RefObject<HTMLElement | null>;
}

// ── 메인 컴포넌트 ──

export const VirtualizedTableGrid = React.memo(function VirtualizedTableGrid({
  questionId,
  displayRows,
  visibleColumns,
  rowCompletionMap,
  rowGridMap,
  isTestMode = false,
  value,
  onChange,
  renderSelectorRows,
  gridTemplateCols,
  totalWidth,
  stickyInfo,
  scrollRootRef,
}: VirtualizedTableGridProps) {
  useTablePerf(`VirtualizedTable(${displayRows.length}×${visibleColumns.length})`);

  const columnWidths = useMemo(
    () => visibleColumns.map((col) => col.width ?? 150),
    [visibleColumns],
  );

  const estimatedHeights = useRowHeights({ displayRows, columnWidths });
  const heightCache = useCellHeightCache(displayRows, columnWidths);
  const { isVisible, sentinelRef } = useRowVisibility(displayRows, scrollRootRef);

  return (
    <div
      role="rowgroup"
      className="mx-auto rounded-b-md border-l border-r border-gray-300 bg-white text-sm"
      style={{
        display: 'grid',
        gridTemplateColumns: gridTemplateCols,
        minWidth: totalWidth ? `${totalWidth}px` : '100%',
        width: totalWidth ? `${totalWidth}px` : '100%',
      }}
    >
      {displayRows.map((row, rowIdx) => (
        <VirtualizedRow
          key={row.id}
          row={row}
          rowIdx={rowIdx}
          gridRow={rowGridMap.get(row.id)}
          completed={rowCompletionMap.get(row.id) ?? false}
          visible={isVisible(rowIdx)}
          cachedHeight={heightCache.get(row.id)}
          estimatedHeight={estimatedHeights[rowIdx] ?? 44}
          questionId={questionId}
          isTestMode={isTestMode}
          value={value}
          onChange={onChange}
          sentinelRef={sentinelRef(rowIdx)}
          measureRef={heightCache.measureRef(row.id)}
          stickyInfo={stickyInfo}
        />
      ))}

      {renderSelectorRows?.()}
    </div>
  );
});
