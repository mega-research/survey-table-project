'use client';

import React, { useMemo, useRef } from 'react';

import { FileText } from 'lucide-react';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useElementWidth } from '@/hooks/use-element-width';
import { useHorizontalScrollIndicators } from '@/hooks/use-horizontal-scroll-indicators';
import { useScrollLeftSync } from '@/hooks/use-scroll-left-sync';
import { cn } from '@/lib/utils';
import { HeaderCell, TableCell, TableColumn, TableRow } from '@/types/survey';
import { expandHeaderGrid } from '@/utils/expand-header-grid';
import {
  HEADER_ROW_MIN_HEIGHT,
  STICKY_BODY_Z,
  STICKY_MAX_VIEWPORT_RATIO,
  type StickyLeftInfo,
  buildGridTemplateCols,
  calcTotalWidth,
  computeStickyLeftColumns,
  getAlignmentClasses,
  getGridCellAria,
  getHeaderCellStickyStyle,
} from '@/utils/table-grid-utils';

import { PreviewCell } from './cells';
import { HEADER_SCROLL_CLASS, TableScrollControls } from './table-scroll-controls';

const HEADER_CELL_CLASS =
  'flex items-center justify-center border-r border-b border-gray-300 bg-gray-50 px-4 py-3 text-center font-medium';

const EMPTY_LABEL = <span className="text-sm text-gray-400 italic" />;

interface TablePreviewProps {
  tableTitle?: string | undefined;
  columns?: TableColumn[] | undefined;
  rows?: TableRow[] | undefined;
  tableHeaderGrid?: HeaderCell[][] | undefined;
  className?: string | undefined;
  hideColumnLabels?: boolean | undefined;
  /** 셀 콘텐츠 렌더 오버라이드. undefined/null 반환 시 기본 PreviewCell 로 폴백. */
  renderCell?: (cell: TableCell) => React.ReactNode;
}

export const TablePreview = React.memo(function TablePreview({
  tableTitle,
  columns = [],
  rows = [],
  tableHeaderGrid,
  className,
  hideColumnLabels = false,
  renderCell,
}: TablePreviewProps) {
  const totalWidth = useMemo(() => calcTotalWidth(columns), [columns]);
  const gridTemplateCols = useMemo(() => buildGridTemplateCols(columns), [columns]);

  // 가로 스크롤: 헤더/바디 별도 컨테이너 + 썸-버튼 컨트롤 + 좌우 그라디언트 힌트 + sticky 좌측 열
  const tableContainerRef = useRef<HTMLDivElement>(null);
  const headerScrollRef = useRef<HTMLDivElement>(null);

  const { canScrollLeft, canScrollRight } = useHorizontalScrollIndicators(tableContainerRef, {
    deps: [columns.length, rows.length],
  });

  // 헤더가 null일 때는 동기화 불필요 (null ref 접근 방지)
  useScrollLeftSync(headerScrollRef, tableContainerRef, hideColumnLabels);

  // 스크롤 뷰포트 실측 폭 — 좁은 화면에서 넓은 텍스트 열이 sticky로 화면을 다
  // 덮지 않도록 누적 sticky 너비 상한 계산에 사용.
  const scrollViewportWidth = useElementWidth(tableContainerRef, columns.length === 0);

  const stickyInfo = useMemo<StickyLeftInfo | undefined>(() => {
    if (columns.length === 0) return undefined;
    const maxStickyWidth =
      scrollViewportWidth > 0 ? scrollViewportWidth * STICKY_MAX_VIEWPORT_RATIO : undefined;
    return computeStickyLeftColumns(columns, rows, maxStickyWidth);
  }, [columns, rows, scrollViewportWidth]);

  const gridContainerStyle = useMemo<React.CSSProperties>(
    () => ({
      display: 'grid',
      gridTemplateColumns: gridTemplateCols,
      width: `${totalWidth}px`,
      minWidth: `${totalWidth}px`,
    }),
    [gridTemplateCols, totalWidth],
  );

  if (columns.length === 0 || rows.length === 0) {
    return (
      <Card className={className}>
        <CardContent className="p-8">
          <div className="text-center text-gray-500">
            <FileText className="mx-auto mb-4 h-12 w-12 text-gray-400" />
            <p>테이블을 구성해주세요</p>
            <p className="text-sm">열과 행을 추가하여 테이블을 만들어보세요</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  const minHeight = stickyInfo && stickyInfo.stickyColCount > 0 ? HEADER_ROW_MIN_HEIGHT : undefined;
  const stickyCount = stickyInfo?.stickyColCount ?? 0;

  // 헤더 셀 렌더 — 다단계(tableHeaderGrid) 또는 단일 행(fallback). sticky 적용 포함.
  const renderHeaderCells = () => {
    if (hideColumnLabels) return null;

    if (tableHeaderGrid && tableHeaderGrid.length > 0) {
      return expandHeaderGrid(tableHeaderGrid).map(
        ({ cell, startCol, colSpan, rowSpan, gridColumn, gridRow }) => {
          const style: React.CSSProperties = {
            gridRow,
            gridColumn,
            minHeight,
            ...getHeaderCellStickyStyle(startCol, colSpan, stickyInfo),
          };

          return (
            <div
              key={cell.id}
              className={HEADER_CELL_CLASS}
              style={style}
              {...getGridCellAria('columnheader', colSpan, rowSpan)}
            >
              {cell.label || EMPTY_LABEL}
            </div>
          );
        },
      );
    }

    // 단일 행 헤더 (폴백) — 명시적 grid-column으로 sticky 좌표 보장
    return columns.map((column, colIdx) => {
      if (column.isHeaderHidden) return null;
      const startCol = colIdx + 1;
      const cs = column.colspan || 1;

      const style: React.CSSProperties = {
        gridColumn: cs > 1 ? `${startCol} / span ${cs}` : startCol,
        minHeight,
        ...getHeaderCellStickyStyle(startCol, cs, stickyInfo),
      };

      return (
        <div
          key={column.id}
          className={HEADER_CELL_CLASS}
          style={style}
          {...getGridCellAria('columnheader', cs)}
        >
          {column.label || EMPTY_LABEL}
        </div>
      );
    });
  };

  const headerRowCount = hideColumnLabels
    ? 0
    : tableHeaderGrid && tableHeaderGrid.length > 0
      ? tableHeaderGrid.length
      : 1;

  return (
    <Card className={className}>
      {tableTitle && (
        <CardHeader>
          <CardTitle>{tableTitle}</CardTitle>
        </CardHeader>
      )}
      <CardContent>
        <div className="relative">
          <div
            role="grid"
            aria-rowcount={headerRowCount + rows.length}
            aria-colcount={columns.length}
          >
            {/* 가로 스크롤 컨트롤 + (선택적) 헤더 라벨. 페이지 스크롤 기준 sticky.
                컨트롤은 hideColumnLabels 여부와 무관하게 렌더한다 — 헤더 라벨을 숨긴
                넓은 표도 가로 스크롤 수단이 필요하기 때문. */}
            <div className="sticky top-0 z-30 bg-white print:static print:z-auto">
              <TableScrollControls
                scrollRef={tableContainerRef}
                canScrollLeft={canScrollLeft}
                canScrollRight={canScrollRight}
              />
              {!hideColumnLabels && (
                <div className="relative">
                  <div ref={headerScrollRef} className={HEADER_SCROLL_CLASS}>
                    <div
                      role="rowgroup"
                      className="mx-auto rounded-t-md border-t border-r border-l border-gray-300 bg-gray-50 text-sm"
                      style={gridContainerStyle}
                    >
                      {renderHeaderCells()}
                    </div>
                  </div>
                  {/* 우측 페이드 — 오른쪽에 아직 열이 더 있다는 시각 힌트 */}
                  {canScrollRight && (
                    <div
                      aria-hidden="true"
                      className="pointer-events-none absolute inset-y-0 right-0 w-12 bg-gradient-to-l from-gray-50 via-gray-50/60 to-transparent print:hidden"
                    />
                  )}
                  {canScrollLeft && (
                    <div
                      aria-hidden="true"
                      className="pointer-events-none absolute inset-y-0 left-0 w-6 bg-gradient-to-r from-gray-50/80 to-transparent print:hidden"
                    />
                  )}
                </div>
              )}
            </div>

            {/* 바디: 가로 스크롤 + 우측/좌측 페이드. relative 래퍼로 페이드를 우측에
                고정한다(스크롤 컨테이너 안에 두면 콘텐츠와 함께 밀려 힌트 효과가 사라진다).
                잘린 셀 텍스트가 있는 바디는 bg-white 이므로 from-white 로 페이드아웃시킨다. */}
            <div className="relative">
              {/* iOS WebKit blank-tile 회피: -webkit-overflow-scrolling: touch +
                  display:grid + position:sticky 조합이 오른쪽 셀 미페인트를 유발한다.
                  iOS 13+ 모멘텀 스크롤은 기본이라 제거해도 무손실. 재추가 금지.
                  (interactive-table-response.tsx 와 동일 조치) */}
              <div
                ref={tableContainerRef}
                className="overflow-x-auto print:overflow-visible"
              >
                <div
                  role="rowgroup"
                  className={cn(
                    'mx-auto rounded-b-md border-r border-l border-gray-300 bg-white text-sm',
                    hideColumnLabels && 'rounded-t-md border-t',
                  )}
                  style={gridContainerStyle}
                >
                  {rows.map((row) =>
                    row.cells.map((cell, cellIndex) => {
                      if (cell.isHidden) return null;
                      const col = cellIndex + 1;
                      const cs = cell.colspan || 1;
                      const rs = cell.rowspan || 1;
                      const isSticky = cellIndex < stickyCount;
                      const isLastSticky = isSticky && cellIndex === stickyCount - 1;

                      const style: React.CSSProperties = {
                        gridColumn: cs > 1 ? `${col} / span ${cs}` : col,
                        ...(rs > 1 ? { gridRow: `span ${rs}` } : {}),
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
                          className={cn(
                            'min-w-0 border-r border-b border-gray-300 bg-white p-3',
                            getAlignmentClasses(cell.horizontalAlign, cell.verticalAlign),
                          )}
                          style={style}
                          data-row-id={row.id}
                          {...getGridCellAria('gridcell', cs, rs)}
                        >
                          {(() => {
                            const override = renderCell?.(cell);
                            return override !== undefined && override !== null ? (
                              override
                            ) : (
                              <PreviewCell cell={cell} />
                            );
                          })()}
                        </div>
                      );
                    }),
                  )}
                </div>
              </div>
              {/* 우측 페이드 — 잘린 셀 내용 위로 깔려 "오른쪽에 더 있다"를 알린다 */}
              {canScrollRight && (
                <div
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-y-0 right-0 w-12 bg-gradient-to-l from-black/10 to-transparent print:hidden"
                />
              )}
              {canScrollLeft && (
                <div
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-y-0 left-0 w-6 bg-gradient-to-r from-black/10 to-transparent print:hidden"
                />
              )}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
});
