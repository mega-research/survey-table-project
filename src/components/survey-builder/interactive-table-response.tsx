'use client';

import React, { useCallback, useEffect, useMemo, useRef } from 'react';

import { ChevronDown, ChevronRight, FileText, ListChecks } from 'lucide-react';

import { scrollToCell } from '@/components/survey-response/scroll-to-issue';
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
  MobileTableDisplayMode,
  Question,
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
  clampMobileDrilldownOmitLeadingColumns,
  resolveMobileTableDisplayMode,
} from '@/utils/mobile-table-display-mode';
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
import { buildRadioGroupBuckets, resolveRadioGroupProps } from '@/utils/table-radio-groups';

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
  errorCellIds?: Set<string> | undefined;
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
  errorCellIds,
}: RenderRowCellsProps) {
  const stickyCount = stickyInfo?.stickyColCount ?? 0;

  // Phase 5-D: 같은 행 + 같은 radioGroupName 셀들 묶음 분석.
  // 같은 그룹 셀 ≥ 2개일 때만 활성 (단일 셀 그룹은 묶을 의미 없음).
  // 같은 열에 걸친 그룹(다른 행끼리 묶음)은 이번 단계 범위 외 — 백엔드 P1 정책이 다중체크를 처리.
  const radioGroupBuckets = buildRadioGroupBuckets(row);

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
          errorCellIds?.has(cell.id) && 'ring-2 ring-red-300 ring-inset',
        )}
        style={style}
        data-row-id={row.id}
        data-cell-id={cell.id}
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
  /** 모바일에서도 카드/스테퍼 전환 없이 원본 표(가로 스크롤)로 렌더 */
  mobileOriginalTable?: boolean | undefined;
  mobileTableDisplayMode?: MobileTableDisplayMode | undefined;
  mobileDrilldownOmitLeadingColumns?: number | undefined;
  mobileDrilldownRepeatHeaderStartRow?: number | null | undefined;
  mobileDrilldownRepeatHeaderEndRow?: number | null | undefined;
  /** 헤더·좌측 열 sticky 동작 활성화. 기본 true. 빌더 프리뷰 등에서 끌 수 있음 */
  enableSticky?: boolean | undefined;
  /** 차단형 검증 위반 셀 (빨간 ring 하이라이트) */
  errorCellIds?: Set<string> | undefined;
  /** 차단형 검증 에러 메시지 (테이블 아래 에러 박스) */
  /** 차단형 검증 오류 배너 항목 — cellIds 가 있으면 "위치로 이동" 버튼을 단다 */
  errorItems?: { message: string; cellIds?: string[] | undefined }[] | undefined;
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
  mobileOriginalTable = false,
  mobileTableDisplayMode,
  mobileDrilldownOmitLeadingColumns,
  mobileDrilldownRepeatHeaderStartRow,
  mobileDrilldownRepeatHeaderEndRow,
  enableSticky = true,
  errorCellIds,
  errorItems,
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
  // 드릴다운 모드에서 "위치로 이동" — 위반 셀이 속한 섹션/리프 상세로 내비 전환.
  // 드릴다운이 마운트된 동안에만 함수가 심긴다 (셸/스테퍼 모드에서는 null).
  const drilldownNavigateRef = useRef<((cellIds: readonly string[]) => void) | null>(null);
  const headerScrollRef = useRef<HTMLDivElement>(null);
  useTablePerf(`InteractiveTable(${rows.length}×${columns.length})`);
  const isMobileView = useMobileView();
  const mobileMode = resolveMobileTableDisplayMode({
    mobileTableDisplayMode,
    mobileOriginalTable,
  });
  const useOriginalRowDetail = isMobileView && mobileMode === 'drilldown-original-row';
  const mobileUsesCards = isMobileView && mobileMode !== 'original';
  const rendersFullOriginalTable = mobileMode === 'original';

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
  // 모바일은 카드 전환이라 원래 불필요하지만, 원본 표 모드는 모바일에서도
  // 표를 렌더하므로 동기화·측정을 켜야 한다.
  useScrollLeftSync(headerScrollRef, tableContainerRef, mobileUsesCards, [hideColumnLabels]);

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
    disabled: mobileUsesCards,
    deps: [visibleColumns.length, displayRows.length],
  });

  // 스크롤 뷰포트(가로 스크롤 컨테이너) 실측 폭 — sticky 열이 화면을 다 가리지 않도록
  // 누적 sticky 너비 상한 계산에 사용. 카드 모드/비활성 시 측정 생략(0).
  const scrollViewportWidth = useElementWidth(tableContainerRef, !enableSticky || mobileUsesCards);

  // 좌측 sticky 열 판정 (카드 모드거나 비활성화면 비적용 — 모바일 원본 표 모드는 적용)
  const stickyInfo = useMemo<StickyLeftInfo | undefined>(() => {
    if (!enableSticky || mobileUsesCards) return undefined;
    // 좁은 뷰포트에서 넓은 텍스트 열이 sticky로 화면을 다 덮는 것을 방지.
    // 측정 전(0)에는 제한 없음(undefined) — 측정 직후 ResizeObserver가 재계산한다.
    const maxStickyWidth =
      scrollViewportWidth > 0 ? scrollViewportWidth * STICKY_MAX_VIEWPORT_RATIO : undefined;
    return computeStickyLeftColumns(visibleColumns, displayRows, maxStickyWidth);
  }, [enableSticky, mobileUsesCards, visibleColumns, displayRows, scrollViewportWidth]);

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
                  errorCellIds,
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
      mergedOnChange,
      hiddenGroupIds,
      stickyInfo,
      errorCellIds,
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
        <div
          className={cn(
            'sticky top-0 z-30 bg-white print:static print:z-auto',
            // 모바일 원본 표 모드는 풀블리드 해크 없이 카드 패딩 안에 좌우 대칭으로 가둔다
            rendersFullOriginalTable ? 'mx-0' : '-mx-4 md:mx-0',
          )}
        >
          {/* 가로 스크롤 컨트롤 (버튼 + 진행도) — sticky 영역이라 항상 조작 가능 */}
          <TableScrollControls
            scrollRef={tableContainerRef}
            canScrollLeft={canScrollLeft}
            canScrollRight={canScrollRight}
          />
          {!hideColumnLabels && (
            <div className="relative">
              <div
                ref={headerScrollRef}
                className={cn(HEADER_SCROLL_CLASS, rendersFullOriginalTable && 'px-0')}
              >
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
                  className="pointer-events-none absolute inset-y-0 right-0 z-20 w-12 transform-gpu bg-gradient-to-l from-gray-50 via-gray-50/60 to-transparent print:hidden"
                />
              )}
              {canScrollLeft && (
                <div
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-y-0 left-0 z-20 w-6 transform-gpu bg-gradient-to-r from-gray-50/80 to-transparent print:hidden"
                />
              )}
            </div>
          )}
        </div>

        {/* 바디: 가로 스크롤 + 우측/좌측 페이드. relative 래퍼로 페이드를 우측에
            고정한다(스크롤 컨테이너 안에 두면 콘텐츠와 함께 밀려 힌트 효과가 사라진다).
            잘린 셀 텍스트가 있는 바디는 bg-white 이므로 from-white 로 페이드아웃시킨다.
            페이드의 z-20 transform-gpu: iOS WebKit 은 overflow 스크롤 컨테이너를
            합성 레이어로 승격해 z-index 없는 형제 오버레이를 덮어버린다(아이폰에서
            그라데이션 미표시). 페이드도 자체 레이어 + sticky 셀(z-10) 위 z 로 강제한다. */}
        <div className={cn('relative', rendersFullOriginalTable ? 'mx-0' : '-mx-4 md:mx-0')}>
          {/* iOS WebKit(아이패드/아이폰 크롬·사파리 공통 엔진)에서는
              -webkit-overflow-scrolling: touch + display:grid + position:sticky 좌측 고정 열
              조합이 별도 GPU 합성 레이어를 강제해, 초기 뷰포트 밖(오른쪽) 셀이 래스터되지
              않는 blank-tile 버그를 일으킨다(스크롤해도 빈 칸). iOS 13+부터 모멘텀 스크롤은
              기본 동작이라 이 속성은 사실상 no-op이므로 제거한다. 재추가 금지. */}
          <div
            ref={tableContainerRef}
            className={cn(
              // 모바일은 상단 스크롤 컨트롤이 스크롤 수단 — 네이티브 가로 스크롤바 숨김
              'overflow-x-auto pb-4 max-md:[-ms-overflow-style:none] max-md:[scrollbar-width:none] print:overflow-visible max-md:[&::-webkit-scrollbar]:hidden',
              rendersFullOriginalTable ? 'px-0' : 'px-4 md:px-0',
            )}
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
                      errorCellIds,
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
              className="pointer-events-none absolute inset-y-0 right-0 z-20 w-12 transform-gpu bg-gradient-to-l from-black/10 to-transparent print:hidden"
            />
          )}
          {canScrollLeft && (
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-y-0 left-0 z-20 w-6 transform-gpu bg-gradient-to-r from-black/10 to-transparent print:hidden"
            />
          )}
        </div>
      </div>
    </div>
  );

  const mobileTableProps = {
    questionId,
    authoredRows: rows,
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
    errorCellIds,
    mobileDrilldownRepeatHeaderStartRow,
    mobileDrilldownRepeatHeaderEndRow,
  };

  return (
    <>
      <Card className={className}>
        {tableTitle && (
          <CardHeader>
            <CardTitle className="text-lg font-medium">{tableTitle}</CardTitle>
          </CardHeader>
        )}
        {/* 모바일은 질문 제목 바로 아래에 카드가 오므로 상단 패딩을 제거해 제목과 붙인다
            (좌우/하단 패딩은 유지). 단 tableTitle 이 있으면 CardHeader 에 하단 패딩이
            없으므로 그 간격 역할을 하는 상단 패딩을 유지한다. 데스크탑은 기존 여백 그대로. */}
        <CardContent
          className={cn(
            isMobileView
              ? tableTitle
                ? 'p-3 sm:p-4'
                : 'p-3 pt-0 sm:p-4 sm:pt-1'
              : 'p-0 sm:px-6',
          )}
        >
          <div className="w-full">
            {/* 모바일 원본 표 옵션이 켜진 질문은 카드/스테퍼 전환 없이 원본 표(가로 스크롤) 유지 */}
            {mobileUsesCards ? (
              useOriginalRowDetail || useDrilldown ? (
                <MobileTableDrilldown
                  {...mobileTableProps}
                  authoredColumns={columns}
                  navigateToCellRef={drilldownNavigateRef}
                  detailMode={useOriginalRowDetail ? 'original-row' : 'legacy'}
                  omitLeadingAuthoredColumns={clampMobileDrilldownOmitLeadingColumns(
                    mobileDrilldownOmitLeadingColumns,
                    columns.length,
                  )}
                />
              ) : (
                <MobileTableStepper {...mobileTableProps} />
              )
            ) : (
              renderTableView()
            )}
          </div>

          {errorItems && errorItems.length > 0 && (
            <div
              role="alert"
              className="mt-2 space-y-1 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
            >
              {errorItems.map((item, i) => (
                <div key={i} className="flex items-center justify-between gap-3">
                  <p className="min-w-0">{item.message}</p>
                  {item.cellIds && item.cellIds.length > 0 && (
                    <button
                      type="button"
                      // 드릴다운 모드는 위반 셀이 다른 섹션에 있어 DOM 에 없을 수 있다.
                      // 먼저 해당 섹션/리프로 내비를 전환하고, 상세가 렌더된 다음
                      // 프레임에 셀로 스크롤한다 (이미 해당 상세면 스크롤만 동작).
                      onClick={() => {
                        const cellIds = item.cellIds!;
                        if (drilldownNavigateRef.current) {
                          drilldownNavigateRef.current(cellIds);
                          window.requestAnimationFrame(() =>
                            window.requestAnimationFrame(() => scrollToCell(cellIds)),
                          );
                        } else {
                          scrollToCell(cellIds);
                        }
                      }}
                      className="shrink-0 rounded border border-red-300 bg-white px-2 py-0.5 text-xs font-medium text-red-600 transition-colors hover:bg-red-100"
                    >
                      위치로 이동
                    </button>
                  )}
                </div>
              ))}
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
