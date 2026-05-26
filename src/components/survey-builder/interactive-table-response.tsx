'use client';

import React, { useCallback, useEffect, useMemo, useRef } from 'react';

import { ChevronDown, ChevronRight, FileText, ListChecks } from 'lucide-react';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useDynamicRowLayout } from '@/hooks/use-dynamic-row-layout';
import { useDynamicRowState } from '@/hooks/use-dynamic-row-state';
import { useHorizontalScrollIndicators } from '@/hooks/use-horizontal-scroll-indicators';
import { useMobileView } from '@/hooks/use-media-query';
import { useScrollLeftSync } from '@/hooks/use-scroll-left-sync';
import { useTablePerf } from '@/hooks/use-table-perf';
import { cn } from '@/lib/utils';
import { DynamicRowGroupConfig, HeaderCell, Question, TableCell, TableColumn, TableRow } from '@/types/survey';
import { shouldDisplayColumn, shouldDisplayDynamicGroup, shouldDisplayRow } from '@/utils/branch-logic';
import {
  buildGridTemplateCols,
  calcTotalWidth,
  computeStickyLeftColumns,
  getAlignmentClasses,
  getGridCellAria,
  getHeaderCellStickyStyle,
  HEADER_ROW_MIN_HEIGHT,
  STICKY_BODY_Z,
  type StickyLeftInfo,
} from '@/utils/table-grid-utils';
import {
  recalculateColspansForVisibleColumns,
  recalculateRowspansForVisibleRows,
} from '@/utils/table-merge-helpers';

import { InteractiveCell } from './cells';
import { DynamicRowSelectorModal } from './dynamic-row-selector-modal';
import { MobileTableStepper } from './mobile-table-stepper';
import { HEADER_SCROLL_CLASS, TableScrollControls } from './table-scroll-controls';
import { VirtualizedTableGrid } from './virtualized-table-grid';

const VIRTUALIZATION_THRESHOLD = 100;

const HEADER_CELL_BASE_CLASS =
  'flex min-w-0 items-center justify-center border-r border-b border-gray-300 bg-gray-50 px-3 py-2 text-center font-semibold text-gray-800 [overflow-wrap:anywhere]';

// ── 셀렉터 행 (동적 행 선택 버튼) ──

interface SelectorRowProps {
  groupId: string;
  label?: string;
  buttonAlign?: 'left' | 'center' | 'right';
  selectedCount: number;
  onSelect: (groupId: string) => void;
  gridRow?: number;
  isExpanded: boolean;
  onToggleExpand: (groupId: string) => void;
  /** 좌측 sticky 열 영역이 덮는 폭만큼 padding-left 부여 */
  stickyLeftPadding?: number;
}

const SelectorRow = React.memo(function SelectorRow({
  groupId,
  label,
  selectedCount,
  onSelect,
  gridRow,
  isExpanded,
  onToggleExpand,
}: SelectorRowProps) {
  // buttonAlign은 가로 스크롤에서 항상 보이도록 좌측 sticky로 통일한다.
  return (
    <div
      className="border-r border-b border-gray-300 bg-white"
      style={{ gridColumn: '1 / -1', gridRow }}
    >
      <div className="sticky left-0 flex w-fit items-center gap-2 py-2 pr-3 pl-3">
        {/* 펼침/접힘 chevron — 선택된 행이 있을 때만 토글 */}
        {selectedCount > 0 && (
          <button
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700"
            onClick={(e) => { e.stopPropagation(); onToggleExpand(groupId); }}
            aria-label={isExpanded ? '접기' : '펼치기'}
          >
            <ChevronDown className={cn(
              'h-4 w-4 transition-transform',
              isExpanded ? '' : '-rotate-90',
            )} />
          </button>
        )}

        {/* 그룹 바 본체 — 클릭 시 모달 열기 */}
        <button
          className="flex flex-1 items-center gap-2 rounded-md px-2 py-1 text-left transition-colors hover:bg-gray-100"
          onClick={() => onSelect(groupId)}
        >
          <ListChecks className="h-3.5 w-3.5 shrink-0 text-gray-500" />
          <span className="text-sm font-medium text-gray-700">
            {label || '항목 선택'}
          </span>
          {selectedCount > 0 && (
            <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-gray-200 px-1.5 text-xs font-semibold text-gray-700">
              {selectedCount}
            </span>
          )}
          <ChevronRight className="h-3.5 w-3.5 shrink-0 text-gray-400" />
        </button>
      </div>
    </div>
  );
});

// ── 헤더 셀 렌더링 (다단계 + 단일 폴백) ──

interface HeaderCellsProps {
  visibleHeaderGrid?: HeaderCell[][];
  visibleColumns: TableColumn[];
  hideColumnLabels: boolean;
  /** sticky 비활성화 시 undefined (헬퍼도 전원 OFF) */
  stickyInfo?: StickyLeftInfo;
}

function HeaderCells({
  visibleHeaderGrid,
  visibleColumns,
  hideColumnLabels,
  stickyInfo,
}: HeaderCellsProps): React.ReactNode {
  if (hideColumnLabels) return null;

  const minHeight = stickyInfo ? HEADER_ROW_MIN_HEIGHT : undefined;

  // 다단계 헤더 — occupied로 rowspan 점유 추적
  if (visibleHeaderGrid && visibleHeaderGrid.length > 0) {
    const totalRows = visibleHeaderGrid.length;
    const occupied = Array.from({ length: totalRows }, () => new Map<number, boolean>());

    return visibleHeaderGrid.flatMap((headerRow, rowIdx) => {
      let col = 1;
      return headerRow.map((cell) => {
        while (occupied[rowIdx]?.get(col)) col++;

        const startCol = col;
        const cs = cell.colspan || 1;
        const rs = cell.rowspan || 1;

        if (rs > 1) {
          for (let r = rowIdx + 1; r < rowIdx + rs && r < totalRows; r++) {
            for (let c = startCol; c < startCol + cs; c++) {
              occupied[r].set(c, true);
            }
          }
        }
        col += cs;

        const style: React.CSSProperties = {
          gridRow: rs > 1 ? `${rowIdx + 1} / span ${rs}` : rowIdx + 1,
          gridColumn: cs > 1 ? `${startCol} / span ${cs}` : startCol,
          minHeight,
          ...getHeaderCellStickyStyle(startCol, cs, stickyInfo),
        };

        return (
          <div
            key={cell.id}
            className={HEADER_CELL_BASE_CLASS}
            style={style}
            {...getGridCellAria('columnheader', cs, rs)}
          >
            {cell.label || <span className="text-sm text-gray-400 italic" />}
          </div>
        );
      });
    });
  }

  // 단일 행 헤더 (폴백) — 명시적 grid-column으로 column 위치 보장
  return visibleColumns.map((column, colIdx) => {
    const startCol = colIdx + 1;
    const cs = column.colspan || 1;

    if (column.isHeaderHidden) {
      // 헤더 grid 배경이 bg-gray-50 연속이므로 빈 셀 불필요.
      // 좌측 sticky 영역만 sticky-left 유지를 위해 빈 셀 배치.
      const stickyStyle = getHeaderCellStickyStyle(startCol, cs, stickyInfo);
      if (!stickyStyle) return null;
      return (
        <div
          key={column.id}
          aria-hidden="true"
          className="border-r border-b border-gray-300 bg-gray-50"
          style={{
            gridRow: 1,
            gridColumn: cs > 1 ? `${startCol} / span ${cs}` : startCol,
            minHeight,
            ...stickyStyle,
          }}
        />
      );
    }

    const style: React.CSSProperties = {
      gridColumn: cs > 1 ? `${startCol} / span ${cs}` : startCol,
      minHeight,
      ...getHeaderCellStickyStyle(startCol, cs, stickyInfo),
    };

    return (
      <div
        key={column.id}
        className={HEADER_CELL_BASE_CLASS}
        style={style}
        {...getGridCellAria('columnheader', cs)}
      >
        {column.label || <span className="text-sm text-gray-400 italic" />}
      </div>
    );
  });
}

// ── 공통: 행의 셀들을 CSS Grid 셀로 렌더 ──

interface RenderRowCellsProps {
  row: TableRow;
  gridRow: number | undefined;
  completed: boolean;
  questionId: string;
  isTestMode: boolean;
  value?: Record<string, any>;
  onChange?: (v: Record<string, any>) => void;
  stickyInfo?: StickyLeftInfo;
}

function renderRowCells({
  row,
  gridRow,
  completed,
  questionId,
  isTestMode,
  value,
  onChange,
  stickyInfo,
}: RenderRowCellsProps) {
  const stickyCount = stickyInfo?.stickyColCount ?? 0;

  // Phase 5-D: 같은 행 + 같은 radioGroupName 셀들 묶음 분석.
  // 같은 그룹 셀 ≥ 2개일 때만 활성 (단일 셀 그룹은 묶을 의미 없음).
  // 같은 열에 걸친 그룹(다른 행끼리 묶음)은 이번 단계 범위 외 — 백엔드 P1 정책이 다중체크를 처리.
  const radioGroupBuckets = new Map<string, string[]>();
  for (const c of row.cells) {
    if (c.type !== 'radio' || c.isHidden || !c.radioGroupName) continue;
    const list = radioGroupBuckets.get(c.radioGroupName) ?? [];
    list.push(c.id);
    radioGroupBuckets.set(c.radioGroupName, list);
  }

  return row.cells.map((cell, cellIndex) => {
    if (cell.isHidden) return null;
    const col = cellIndex + 1;
    const rs = cell.rowspan || 1;
    const cs = cell.colspan || 1;
    const isSticky = cellIndex < stickyCount;
    const isLastSticky = isSticky && cellIndex === stickyCount - 1;

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
        className={cn(
          'min-w-0 border-r border-b border-gray-300 p-2 transition-colors duration-200 [overflow-wrap:anywhere]',
          // sticky 셀은 뒤가 비치면 안 되므로 불투명 배경 고정
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
        <InteractiveCell
          cell={cell}
          questionId={questionId}
          isTestMode={isTestMode}
          value={value}
          onChange={onChange}
          {...resolveRadioGroupProps(cell, row.id, radioGroupBuckets)}
        />
      </div>
    );
  });
}

/**
 * Phase 5-D: 같은 행 + 같은 radioGroupName 셀에 대해 HTML name + sibling 클리어 props 결정.
 * 그룹 멤버 ≥ 2 일 때만 활성 (1개면 묶을 의미 없음).
 */
function resolveRadioGroupProps(
  cell: TableCell,
  rowId: string,
  buckets: Map<string, string[]>,
): { groupName?: string; siblingCellIds?: string[] } {
  if (cell.type !== 'radio' || !cell.radioGroupName) return {};
  const groupCells = buckets.get(cell.radioGroupName);
  if (!groupCells || groupCells.length < 2) return {};
  return {
    groupName: `${rowId}-${cell.radioGroupName}`,
    siblingCellIds: groupCells.filter((cid) => cid !== cell.id),
  };
}

// ── 메인 컴포넌트 ──

interface InteractiveTableResponseProps {
  questionId: string;
  tableTitle?: string;
  columns?: TableColumn[];
  rows?: TableRow[];
  tableHeaderGrid?: HeaderCell[][];
  value?: Record<string, any>;
  onChange?: (value: Record<string, any>) => void;
  className?: string;
  isTestMode?: boolean;
  allResponses?: Record<string, unknown>;
  allQuestions?: Question[];
  dynamicRowConfigs?: DynamicRowGroupConfig[];
  hideColumnLabels?: boolean;
  /** 헤더·좌측 열 sticky 동작 활성화. 기본 true. 빌더 프리뷰 등에서 끌 수 있음 */
  enableSticky?: boolean;
}

export const InteractiveTableResponse = React.memo(function InteractiveTableResponse({
  questionId,
  tableTitle,
  columns = [],
  rows = [],
  tableHeaderGrid,
  value,
  onChange,
  className,
  isTestMode = false,
  allResponses,
  allQuestions,
  dynamicRowConfigs,
  hideColumnLabels = false,
  enableSticky = true,
}: InteractiveTableResponseProps) {
  // 같은 render tick 안에 여러 cell 이 동시에 onChange 를 호출할 때 (예: emptyDefault prefill)
  // 부모 prop 의 batch 지연으로 stale 한 객체가 덮어쓰는 race 를 방지하기 위해
  // 누적 ref 에서 매번 머지해 부모에 전달한다. 응답자 모드 전용.
  const accumulatedResponseRef = useRef<Record<string, unknown>>(value ?? {});
  useEffect(() => {
    if (!isTestMode) accumulatedResponseRef.current = value ?? {};
  }, [value, isTestMode]);

  const mergedOnChange = useCallback(
    (next: Record<string, unknown>) => {
      if (!onChange) return;
      if (isTestMode) {
        onChange(next);
        return;
      }
      // 동일 값이면 부모 setState 트리거 안 함 — emptyDefault prefill 등에서 N개 cell 이 동시에
      // 같은 값을 쓰는 케이스의 cascade re-render 회피.
      const cur = accumulatedResponseRef.current;
      let changed = false;
      for (const k of Object.keys(next)) {
        if (cur[k] !== next[k]) {
          changed = true;
          break;
        }
      }
      if (!changed) return;
      const merged = { ...cur, ...next };
      accumulatedResponseRef.current = merged;
      onChange(merged);
    },
    [onChange, isTestMode],
  );

  // 1) 동적 행 상태 — store 구독, 상태, 핸들러
  const {
    currentResponse,
    groupConfigMap,
    dynamicRows,
    hasDynamicRows,
    selectedRowIds,
    activeGroupId,
    handleSelectGroup,
    handleDynamicRowSelect,
    closeModal,
    expandedGroupIds,
    toggleGroupExpanded,
  } = useDynamicRowState({
    questionId,
    rows,
    dynamicRowConfigs,
    isTestMode,
    value,
    onChange: mergedOnChange,
  });

  const tableContainerRef = useRef<HTMLDivElement>(null);
  const headerScrollRef = useRef<HTMLDivElement>(null);
  useTablePerf(`InteractiveTable(${rows.length}×${columns.length})`);
  const isMobileView = useMobileView();

  // displayCondition에서 참조하는 질문 ID만 추출 → 관련 응답만 의존
  const relevantResponseKeys = useMemo(() => {
    const ids = new Set<string>();
    const collect = (conditions?: { sourceQuestionId?: string }[]) => {
      if (!conditions) return;
      for (const c of conditions) {
        if (c.sourceQuestionId) ids.add(c.sourceQuestionId);
      }
    };
    for (const col of columns) collect(col.displayCondition?.conditions);
    for (const row of rows) collect(row.displayCondition?.conditions);
    if (dynamicRowConfigs) {
      for (const group of dynamicRowConfigs) collect(group.displayCondition?.conditions);
    }
    return ids;
  }, [columns, rows, dynamicRowConfigs]);

  // 관련 응답만 안정적으로 추출 (JSON 직렬화로 값 비교)
  const relevantResponsesJson = useMemo(() => {
    if (!allResponses || relevantResponseKeys.size === 0) return '';
    const subset: Record<string, unknown> = {};
    for (const key of relevantResponseKeys) {
      if (key in allResponses) subset[key] = allResponses[key];
    }
    return JSON.stringify(subset);
  }, [allResponses, relevantResponseKeys]);

  // displayCondition 기반 가시 열 필터링 + colspan 재계산
  const { visibleColumns, columnFilteredRows, visibleHeaderGrid } = useMemo(() => {
    if (!allResponses || !allQuestions || columns.length === 0) {
      return { visibleColumns: columns, columnFilteredRows: rows, visibleHeaderGrid: tableHeaderGrid };
    }
    const hasColumnConditions = columns.some((col) => col.displayCondition);
    if (!hasColumnConditions) {
      return { visibleColumns: columns, columnFilteredRows: rows, visibleHeaderGrid: tableHeaderGrid };
    }
    const visibleColumnIds = new Set<string>();
    for (const col of columns) {
      if (shouldDisplayColumn(col, allResponses, allQuestions)) {
        visibleColumnIds.add(col.id);
      }
    }
    const result = recalculateColspansForVisibleColumns(columns, rows, visibleColumnIds, tableHeaderGrid);
    return {
      visibleColumns: result.columns,
      columnFilteredRows: result.rows,
      visibleHeaderGrid: result.headerGrid,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [columns, rows, tableHeaderGrid, relevantResponsesJson, allQuestions]);

  // displayCondition 기반 가시 행 필터링 + 동적 행 필터링 + rowspan 재계산
  const visibleRows = useMemo(() => {
    if (columnFilteredRows.length === 0) return columnFilteredRows;
    let filtered = columnFilteredRows;

    if (allResponses && allQuestions) {
      const hasConditions = filtered.some((row) => row.displayCondition);
      if (hasConditions) {
        const conditionVisibleIds = new Set<string>();
        for (const row of filtered) {
          if (shouldDisplayRow(row, allResponses, allQuestions)) {
            conditionVisibleIds.add(row.id);
          }
        }
        filtered = filtered.filter((row) => conditionVisibleIds.has(row.id));
      }
    }

    if (hasDynamicRows) {
      // 동적 그룹 소속 행은 메인 그리드에서 제외 (아코디언에서 렌더)
      filtered = filtered.filter((row) => {
        if (row.dynamicGroupId && groupConfigMap.has(row.dynamicGroupId)) {
          return false;
        }
        if (row.showWhenDynamicGroupId && groupConfigMap.has(row.showWhenDynamicGroupId)) {
          return false;
        }
        return true;
      });
    }

    const visibleRowIds = new Set(filtered.map((r) => r.id));
    return recalculateRowspansForVisibleRows(columnFilteredRows, visibleRowIds);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [columnFilteredRows, relevantResponsesJson, allQuestions, hasDynamicRows, selectedRowIds, groupConfigMap]);

  // 가로 스크롤 인디케이터 (좌/우 섀도우·버튼 표시 여부)
  const { canScrollLeft, canScrollRight } = useHorizontalScrollIndicators(
    tableContainerRef,
    {
      disabled: isMobileView,
      deps: [visibleColumns.length, visibleRows.length],
    },
  );

  // 헤더-바디 scrollLeft 상호 동기화 (각각 별도 가로 스크롤 컨테이너)
  useScrollLeftSync(headerScrollRef, tableContainerRef, isMobileView);

  // Grid 관련 계산
  const totalWidth = useMemo(() => calcTotalWidth(visibleColumns), [visibleColumns]);
  const gridTemplateCols = useMemo(() => buildGridTemplateCols(visibleColumns), [visibleColumns]);

  // 헤더 행 수 계산
  const headerRowCount = useMemo(() => {
    if (hideColumnLabels) return 0;
    if (visibleHeaderGrid && visibleHeaderGrid.length > 0) return visibleHeaderGrid.length;
    return 1;
  }, [hideColumnLabels, visibleHeaderGrid]);

  // 그룹 조건부 표시: 숨겨야 할 그룹 ID 집합
  const hiddenGroupIds = useMemo(() => {
    if (!allResponses || !allQuestions || !dynamicRowConfigs) return undefined;
    const hidden = new Set<string>();
    for (const g of dynamicRowConfigs) {
      if (g.enabled && g.displayCondition && !shouldDisplayDynamicGroup(g, allResponses, allQuestions)) {
        hidden.add(g.groupId);
      }
    }
    return hidden.size > 0 ? hidden : undefined;
  }, [dynamicRowConfigs, allResponses, allQuestions]);

  // 3) 동적 행 레이아웃 — displayRows, gridMap
  const {
    displayRows,
    rowGridMap,
    selectorGridMap,
    groupSelectedCountMap,
    expandedGroupRows,
  } = useDynamicRowLayout({
    rows,
    columnFilteredRows,
    visibleRows,
    groupConfigMap,
    selectedRowIds,
    hasDynamicRows,
    headerRowCount,
    expandedGroupIds,
    hiddenGroupIds,
  });

  // 행별 완료 상태 맵 (displayRows + 펼친 그룹 행 포함)
  const rowCompletionMap = useMemo(() => {
    const map = new Map<string, boolean>();
    const checkRow = (row: TableRow) => {
      const completed = row.cells.every((cell) => {
        if (cell._isContinuation) return true;
        if (['text', 'checkbox', 'radio', 'select', 'input'].includes(cell.type)) {
          const val = currentResponse[cell.id];
          return val !== undefined && val !== null && val !== '';
        }
        return true;
      });
      map.set(row.id, completed);
    };
    for (const row of displayRows) checkRow(row);
    for (const groupRows of expandedGroupRows.values()) {
      for (const row of groupRows) checkRow(row);
    }
    return map;
  }, [displayRows, expandedGroupRows, currentResponse]);

  // 좌측 sticky 열 판정 (모바일이거나 비활성화면 비적용)
  const stickyInfo = useMemo<StickyLeftInfo | undefined>(() => {
    if (!enableSticky || isMobileView) return undefined;
    return computeStickyLeftColumns(visibleColumns, displayRows);
  }, [enableSticky, isMobileView, visibleColumns, displayRows]);

  const stickyLeftPadding = useMemo(() => {
    if (!stickyInfo || stickyInfo.stickyColCount === 0) return 0;
    const idx = stickyInfo.stickyColCount - 1;
    return (stickyInfo.leftOffsets[idx] ?? 0) + (visibleColumns[idx]?.width || 150);
  }, [stickyInfo, visibleColumns]);

  // 헤더/바디 grid 컨테이너 공용 스타일 (가로 폭·템플릿 동일하게 정렬)
  const gridContainerStyle = useMemo<React.CSSProperties>(() => ({
    display: 'grid',
    gridTemplateColumns: gridTemplateCols,
    minWidth: totalWidth ? `${totalWidth}px` : '100%',
    width: totalWidth ? `${totalWidth}px` : '100%',
  }), [gridTemplateCols, totalWidth]);

  // 헤더 셀 렌더링 (다단계/단일 폴백 공용 — 파일 상단 HeaderCells 참고)
  const renderHeaderCells = useCallback(
    () => (
      <HeaderCells
        visibleHeaderGrid={visibleHeaderGrid}
        visibleColumns={visibleColumns}
        hideColumnLabels={hideColumnLabels}
        stickyInfo={stickyInfo}
      />
    ),
    [visibleHeaderGrid, visibleColumns, hideColumnLabels, stickyInfo],
  );

  // 4) 셀렉터 행 + 펼친 그룹 행 렌더링 (가상화/비가상화 공용)
  const renderSelectorRows = useCallback(
    () =>
      Array.from(selectorGridMap.entries()).flatMap(([groupId, selectorGridRow]) => {
        const config = groupConfigMap.get(groupId);
        if (!config) return [];
        // hiddenGroupIds로 이미 grid-row에서 제외됨 — 렌더도 스킵
        if (hiddenGroupIds?.has(groupId)) return [];

        const isExpanded = expandedGroupIds.has(groupId);
        const elements: React.ReactNode[] = [
          <SelectorRow
            key={`selector-${groupId}`}
            groupId={groupId}
            label={config.label}
            buttonAlign={config.buttonAlign}
            selectedCount={groupSelectedCountMap.get(groupId) ?? 0}
            onSelect={handleSelectGroup}
            gridRow={selectorGridRow}
            isExpanded={isExpanded}
            onToggleExpand={toggleGroupExpanded}
            stickyLeftPadding={stickyLeftPadding}
          />,
        ];

        // 펼친 그룹의 선택된 행들 렌더
        if (isExpanded) {
          for (const row of expandedGroupRows.get(groupId) ?? []) {
            elements.push(
              <React.Fragment key={row.id}>
                {renderRowCells({
                  row,
                  gridRow: rowGridMap.get(row.id),
                  completed: rowCompletionMap.get(row.id) ?? false,
                  questionId, isTestMode, value,
                  onChange: mergedOnChange,
                  stickyInfo,
                })}
              </React.Fragment>,
            );
          }
        }

        return elements;
      }),
    [selectorGridMap, groupConfigMap, groupSelectedCountMap, handleSelectGroup,
     expandedGroupIds, toggleGroupExpanded, expandedGroupRows, rowGridMap,
     rowCompletionMap, questionId, isTestMode, value, onChange, hiddenGroupIds,
     stickyInfo, stickyLeftPadding],
  );

  // ── 빈 테이블 ──
  if (columns.length === 0 || rows.length === 0) {
    return (
      <Card className={className}>
        <CardContent className="p-8">
          <div className="text-center text-gray-500">
            <FileText className="mx-auto mb-4 h-12 w-12 text-gray-400" />
            <p>테이블 질문이 구성되지 않았습니다</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  // ── 가상화 여부 판단 ──
  const shouldVirtualize = displayRows.length >= VIRTUALIZATION_THRESHOLD;

  // ── 데스크톱 Grid 뷰 ──
  const renderTableView = () => (
    <div className="relative">
      {/* 외부 grid 래퍼 — ARIA 의미 */}
      <div
        role="grid"
        aria-rowcount={headerRowCount + displayRows.length}
        aria-colcount={visibleColumns.length}
      >
        {/* 헤더: 페이지 스크롤 기준 sticky 래퍼 + 별도 가로 스크롤 컨테이너 */}
        {!hideColumnLabels && (
          <div className="sticky top-0 z-30 -mx-4 bg-white md:mx-0 print:static print:z-auto">
            {/* 가로 스크롤 컨트롤 (버튼 + 진행도) — sticky 영역이라 항상 조작 가능 */}
            <TableScrollControls
              scrollRef={tableContainerRef}
              canScrollLeft={canScrollLeft}
              canScrollRight={canScrollRight}
            />
            <div className="relative">
              <div ref={headerScrollRef} className={HEADER_SCROLL_CLASS}>
                <div
                  role="rowgroup"
                  className="mx-auto rounded-t-md border-t border-l border-r border-gray-300 bg-gray-50 text-sm"
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
          </div>
        )}

        {/* 바디: 가로 스크롤 전용, 세로는 페이지 자연 흐름 */}
        <div
          ref={tableContainerRef}
          className="-mx-4 overflow-x-auto px-4 pb-4 md:mx-0 md:px-0 print:overflow-visible"
          style={{ WebkitOverflowScrolling: 'touch' }}
        >
          {shouldVirtualize ? (
            /* 가상화: 바디만 렌더 */
            <VirtualizedTableGrid
              questionId={questionId}
              displayRows={displayRows}
              visibleColumns={visibleColumns}
              rowCompletionMap={rowCompletionMap}
              rowGridMap={rowGridMap}
              isTestMode={isTestMode}
              value={value}
              onChange={mergedOnChange}
              gridTemplateCols={gridTemplateCols}
              totalWidth={totalWidth}
              renderSelectorRows={renderSelectorRows}
              stickyInfo={stickyInfo}
            />
          ) : (
            /* 바디 전용 grid */
            <div
              role="rowgroup"
              className={cn(
                'mx-auto rounded-b-md border-l border-r border-gray-300 bg-white text-sm',
                hideColumnLabels && 'rounded-t-md border-t',
              )}
              style={gridContainerStyle}
            >
              {/* 바디 — 명시적 grid-row 배치 */}
              {displayRows.map((row) => (
                <React.Fragment key={row.id}>
                  {renderRowCells({
                    row,
                    gridRow: rowGridMap.get(row.id),
                    completed: rowCompletionMap.get(row.id) ?? false,
                    questionId, isTestMode, value,
                    onChange: mergedOnChange,
                    stickyInfo,
                  })}
                </React.Fragment>
              ))}

              {/* 셀렉터 행들 — 명시적 grid-row 배치 */}
              {renderSelectorRows()}
            </div>
          )}
        </div>
      </div>
    </div>
  );

  return (
    <>
      <Card className={className}>
        {tableTitle && (
          <CardHeader>
            <CardTitle className="text-lg font-medium">{tableTitle}</CardTitle>
          </CardHeader>
        )}
        <CardContent className={cn(isMobileView ? 'p-3 sm:p-4' : 'p-0 sm:px-6 sm:pb-6')}>
          <div className="w-full">
            {isMobileView ? (
              <MobileTableStepper
                questionId={questionId}
                displayRows={displayRows}
                visibleColumns={visibleColumns}
                visibleHeaderGrid={visibleHeaderGrid}
                currentResponse={currentResponse}
                hideColumnLabels={hideColumnLabels}
                isTestMode={isTestMode}
                value={value}
                onChange={mergedOnChange}
                hasDynamicRows={hasDynamicRows}
                selectedRowIds={selectedRowIds}
                groupConfigMap={groupConfigMap}
                onSelectGroup={handleSelectGroup}
              />
            ) : (
              renderTableView()
            )}
          </div>

          {isTestMode && (
            <div className="mx-4 mt-4 mb-4 rounded-lg bg-blue-50 p-3 sm:mx-0 sm:mb-0">
              <div className="text-sm text-blue-700">
                <span className="font-medium">테스트 모드:</span> 위 테이블에서 실제로 응답해보세요.
                응답 데이터는 저장되지 않습니다.
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {activeGroupId && (
        <DynamicRowSelectorModal
          open={!!activeGroupId}
          onOpenChange={(open) => { if (!open) closeModal(); }}
          dynamicRows={dynamicRows.filter((r) => r.dynamicGroupId === activeGroupId)}
          selectedRowIds={selectedRowIds.filter((id) =>
            dynamicRows.some((r) => r.id === id && r.dynamicGroupId === activeGroupId)
          )}
          label={groupConfigMap.get(activeGroupId)?.label}
          onConfirm={handleDynamicRowSelect}
        />
      )}
    </>
  );
});
