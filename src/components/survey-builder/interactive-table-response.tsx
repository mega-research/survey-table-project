'use client';

import React, { useCallback, useEffect, useMemo, useRef } from 'react';

import { ChevronDown, ChevronRight, FileText, ListChecks } from 'lucide-react';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useDynamicRows } from '@/hooks/use-dynamic-rows';
import { useElementWidth } from '@/hooks/use-element-width';
import { useHorizontalScrollIndicators } from '@/hooks/use-horizontal-scroll-indicators';
import { useMobileView } from '@/hooks/use-media-query';
import { useScrollLeftSync } from '@/hooks/use-scroll-left-sync';
import { useTablePerf } from '@/hooks/use-table-perf';
import { cn } from '@/lib/utils';
import {
  DynamicRowGroupConfig,
  HeaderCell,
  Question,
  TableCell,
  TableColumn,
  TableRow,
} from '@/types/survey';
import {
  shouldDisplayColumn,
  shouldDisplayDynamicGroup,
  shouldDisplayRow,
} from '@/utils/branch-logic';
import { decideDrilldown } from '@/utils/classify-table';
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
import { recalculateColspansForVisibleColumns } from '@/utils/table-merge-helpers';

import { InteractiveCell } from './cells';
import { DynamicRowSelectorModal } from './dynamic-row-selector-modal';
import { MobileTableDrilldown } from './mobile-table-drilldown';
import { MobileTableStepper } from './mobile-table-stepper';
import { HEADER_SCROLL_CLASS, TableScrollControls } from './table-scroll-controls';
import { VirtualizedTableGrid } from './virtualized-table-grid';

const VIRTUALIZATION_THRESHOLD = 100;

const HEADER_CELL_BASE_CLASS =
  'flex min-w-0 items-center justify-center border-r border-b border-gray-300 bg-gray-50 px-3 py-2 text-center font-semibold text-gray-800 [overflow-wrap:anywhere]';

// ── 셀렉터 행 (동적 행 선택 버튼) ──

interface SelectorRowProps {
  groupId: string;
  label?: string | undefined;
  buttonAlign?: 'left' | 'center' | 'right' | undefined;
  selectedCount: number;
  onSelect: (groupId: string) => void;
  gridRow?: number | undefined;
  isExpanded: boolean;
  onToggleExpand: (groupId: string) => void;
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
            onClick={(e) => {
              e.stopPropagation();
              onToggleExpand(groupId);
            }}
            aria-label={isExpanded ? '접기' : '펼치기'}
          >
            <ChevronDown
              className={cn('h-4 w-4 transition-transform', isExpanded ? '' : '-rotate-90')}
            />
          </button>
        )}

        {/* 그룹 바 본체 — 클릭 시 모달 열기 */}
        <button
          className="flex flex-1 items-center gap-2 rounded-md px-2 py-1 text-left transition-colors hover:bg-gray-100"
          onClick={() => onSelect(groupId)}
        >
          <ListChecks className="h-3.5 w-3.5 shrink-0 text-gray-500" />
          <span className="text-sm font-medium text-gray-700">{label || '항목 선택'}</span>
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
  visibleHeaderGrid?: HeaderCell[][] | undefined;
  visibleColumns: TableColumn[];
  hideColumnLabels: boolean;
  /** sticky 비활성화 시 undefined (헬퍼도 전원 OFF) */
  stickyInfo?: StickyLeftInfo | undefined;
}

function HeaderCells({
  visibleHeaderGrid,
  visibleColumns,
  hideColumnLabels,
  stickyInfo,
}: HeaderCellsProps): React.ReactNode {
  if (hideColumnLabels) return null;

  const minHeight = stickyInfo ? HEADER_ROW_MIN_HEIGHT : undefined;

  // 다단계 헤더 — expandHeaderGrid로 occupied 점유 추적
  if (visibleHeaderGrid && visibleHeaderGrid.length > 0) {
    return expandHeaderGrid(visibleHeaderGrid).map(
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
            className={HEADER_CELL_BASE_CLASS}
            style={style}
            {...getGridCellAria('columnheader', colSpan, rowSpan)}
          >
            {cell.label || <span className="text-sm text-gray-400 italic" />}
          </div>
        );
      },
    );
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
  value?: Record<string, any> | undefined;
  onChange?: ((v: Record<string, any>) => void) | undefined;
  stickyInfo?: StickyLeftInfo | undefined;
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
          'min-w-0 border-r border-b border-gray-300 p-2 [overflow-wrap:anywhere] transition-colors duration-200',
          // sticky 셀은 뒤가 비치면 안 되므로 불투명 배경 고정
          isSticky
            ? completed
              ? 'bg-green-50'
              : 'bg-white'
            : completed
              ? 'bg-green-50/40'
              : 'bg-white',
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
  tableTitle?: string | undefined;
  columns?: TableColumn[] | undefined;
  rows?: TableRow[] | undefined;
  tableHeaderGrid?: HeaderCell[][] | undefined;
  value?: Record<string, any> | undefined;
  onChange?: (value: Record<string, any>) => void;
  className?: string | undefined;
  isTestMode?: boolean | undefined;
  allResponses?: Record<string, unknown> | undefined;
  allQuestions?: Question[] | undefined;
  dynamicRowConfigs?: DynamicRowGroupConfig[] | undefined;
  hideColumnLabels?: boolean | undefined;
  /** 헤더·좌측 열 sticky 동작 활성화. 기본 true. 빌더 프리뷰 등에서 끌 수 있음 */
  enableSticky?: boolean | undefined;
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
      return {
        visibleColumns: columns,
        columnFilteredRows: rows,
        visibleHeaderGrid: tableHeaderGrid,
      };
    }
    const hasColumnConditions = columns.some((col) => col.displayCondition);
    if (!hasColumnConditions) {
      return {
        visibleColumns: columns,
        columnFilteredRows: rows,
        visibleHeaderGrid: tableHeaderGrid,
      };
    }
    const visibleColumnIds = new Set<string>();
    for (const col of columns) {
      if (shouldDisplayColumn(col, allResponses, allQuestions)) {
        visibleColumnIds.add(col.id);
      }
    }
    const result = recalculateColspansForVisibleColumns(
      columns,
      rows,
      visibleColumnIds,
      tableHeaderGrid,
    );
    return {
      visibleColumns: result.columns,
      columnFilteredRows: result.rows,
      visibleHeaderGrid: result.headerGrid,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [columns, rows, tableHeaderGrid, relevantResponsesJson, allQuestions]);

  // 행 displayCondition 평가 결과 — null 이면 조건 필터 없음.
  // 동적 행 필터링·rowspan 재계산은 useDynamicRows(동적 행 파이프라인)가 소유하고,
  // branch-logic 의존인 조건 평가만 여기(호출자) 소유로 남긴다.
  const conditionVisibleRowIds = useMemo(() => {
    if (!allResponses || !allQuestions) return null;
    const hasConditions = columnFilteredRows.some((row) => row.displayCondition);
    if (!hasConditions) return null;
    const ids = new Set<string>();
    for (const row of columnFilteredRows) {
      if (shouldDisplayRow(row, allResponses, allQuestions)) {
        ids.add(row.id);
      }
    }
    return ids;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [columnFilteredRows, relevantResponsesJson, allQuestions]);

  // 헤더-바디 scrollLeft 상호 동기화 (각각 별도 가로 스크롤 컨테이너)
  // 헤더는 hideColumnLabels=false 일 때만 마운트되므로, 토글 시 리스너 재부착이
  // 필요하다(ref/disabled는 안 바뀌어 deps 없이는 effect가 재실행되지 않음).
  useScrollLeftSync(headerScrollRef, tableContainerRef, isMobileView, [hideColumnLabels]);

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
      if (
        g.enabled &&
        g.displayCondition &&
        !shouldDisplayDynamicGroup(g, allResponses, allQuestions)
      ) {
        hidden.add(g.groupId);
      }
    }
    return hidden.size > 0 ? hidden : undefined;
  }, [dynamicRowConfigs, allResponses, allQuestions]);

  // 동적 행 파이프라인 — 상태 → 가시 행 필터링 → 레이아웃 → 행 완료 맵을 한 seam 뒤로
  const {
    displayRows,
    rowGridMap,
    selectorGridMap,
    groupSelectedCountMap,
    expandedGroupRows,
    rowCompletionMap,
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
  } = useDynamicRows({
    questionId,
    rows,
    columnFilteredRows,
    conditionVisibleRowIds,
    hiddenGroupIds,
    dynamicRowConfigs,
    isTestMode,
    value,
    onChange: mergedOnChange,
    headerRowCount,
  });

  // 가로 스크롤 인디케이터 (좌/우 섀도우·버튼 표시 여부)
  const { canScrollLeft, canScrollRight } = useHorizontalScrollIndicators(tableContainerRef, {
    disabled: isMobileView,
    deps: [visibleColumns.length, displayRows.length],
  });

  // 스크롤 뷰포트(가로 스크롤 컨테이너) 실측 폭 — sticky 열이 화면을 다 가리지 않도록
  // 누적 sticky 너비 상한 계산에 사용. 모바일/비활성 시 측정 생략(0).
  const scrollViewportWidth = useElementWidth(tableContainerRef, !enableSticky || isMobileView);

  // 좌측 sticky 열 판정 (모바일이거나 비활성화면 비적용)
  const stickyInfo = useMemo<StickyLeftInfo | undefined>(() => {
    if (!enableSticky || isMobileView) return undefined;
    // 좁은 뷰포트에서 넓은 텍스트 열이 sticky로 화면을 다 덮는 것을 방지.
    // 측정 전(0)에는 제한 없음(undefined) — 측정 직후 ResizeObserver가 재계산한다.
    const maxStickyWidth =
      scrollViewportWidth > 0 ? scrollViewportWidth * STICKY_MAX_VIEWPORT_RATIO : undefined;
    return computeStickyLeftColumns(visibleColumns, displayRows, maxStickyWidth);
  }, [enableSticky, isMobileView, visibleColumns, displayRows, scrollViewportWidth]);

  // 헤더/바디 grid 컨테이너 공용 스타일 (가로 폭·템플릿 동일하게 정렬)
  const gridContainerStyle = useMemo<React.CSSProperties>(
    () => ({
      display: 'grid',
      gridTemplateColumns: gridTemplateCols,
      minWidth: totalWidth ? `${totalWidth}px` : '100%',
      width: totalWidth ? `${totalWidth}px` : '100%',
    }),
    [gridTemplateCols, totalWidth],
  );

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
                  questionId,
                  isTestMode,
                  value,
                  onChange: mergedOnChange,
                  stickyInfo,
                })}
              </React.Fragment>,
            );
          }
        }

        return elements;
      }),
    [
      selectorGridMap,
      groupConfigMap,
      groupSelectedCountMap,
      handleSelectGroup,
      expandedGroupIds,
      toggleGroupExpanded,
      expandedGroupRows,
      rowGridMap,
      rowCompletionMap,
      questionId,
      isTestMode,
      value,
      onChange,
      hiddenGroupIds,
      stickyInfo,
    ],
  );

  // 모바일: 계층/매트릭스 감지 시 드릴다운, 평면 단순 표는 기존 스테퍼
  // hooks-rules: 아래 빈 테이블 early return 이전에 호출해야 hook 순서가 보장된다
  const { useDrilldown } = useMemo(
    () =>
      decideDrilldown({
        tableColumns: visibleColumns,
        tableRowsData: displayRows,
        tableHeaderGrid: visibleHeaderGrid,
      }),
    [visibleColumns, displayRows, visibleHeaderGrid],
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
        {/* 가로 스크롤 컨트롤 + (선택적) 헤더 라벨. 페이지 스크롤 기준 sticky 래퍼.
            컨트롤은 hideColumnLabels 여부와 무관하게 렌더한다 — 헤더 라벨을 숨긴
            테이블도 넓으면 가로 스크롤 수단이 필요한데, 과거엔 이 컨트롤이 헤더
            블록 안에 갇혀 hideColumnLabels=true 시 함께 사라지는 버그가 있었다. */}
        <div className="sticky top-0 z-30 -mx-4 bg-white md:mx-0 print:static print:z-auto">
          {/* 가로 스크롤 컨트롤 (버튼 + 진행도) — sticky 영역이라 항상 조작 가능 */}
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
        <div className="relative -mx-4 md:mx-0">
          {/* iOS WebKit(아이패드/아이폰 크롬·사파리 공통 엔진)에서는
              -webkit-overflow-scrolling: touch + display:grid + position:sticky 좌측 고정 열
              조합이 별도 GPU 합성 레이어를 강제해, 초기 뷰포트 밖(오른쪽) 셀이 래스터되지
              않는 blank-tile 버그를 일으킨다(스크롤해도 빈 칸). iOS 13+부터 모멘텀 스크롤은
              기본 동작이라 이 속성은 사실상 no-op이므로 제거한다. 재추가 금지. */}
          <div
            ref={tableContainerRef}
            className="overflow-x-auto px-4 pb-4 md:px-0 print:overflow-visible"
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
                  'mx-auto rounded-b-md border-r border-l border-gray-300 bg-white text-sm',
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
                      questionId,
                      isTestMode,
                      value,
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
  );

  const mobileTableProps = {
    questionId,
    displayRows,
    visibleColumns,
    visibleHeaderGrid,
    currentResponse,
    hideColumnLabels,
    isTestMode,
    value,
    onChange: mergedOnChange,
    hasDynamicRows,
    selectedRowIds,
    groupConfigMap,
    onSelectGroup: handleSelectGroup,
  };

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
              useDrilldown ? (
                <MobileTableDrilldown {...mobileTableProps} />
              ) : (
                <MobileTableStepper {...mobileTableProps} />
              )
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
          onOpenChange={(open) => {
            if (!open) closeModal();
          }}
          dynamicRows={dynamicRows.filter((r) => r.dynamicGroupId === activeGroupId)}
          selectedRowIds={selectedRowIds.filter((id) =>
            dynamicRows.some((r) => r.id === id && r.dynamicGroupId === activeGroupId),
          )}
          label={groupConfigMap.get(activeGroupId)?.label}
          onConfirm={handleDynamicRowSelect}
        />
      )}
    </>
  );
});
