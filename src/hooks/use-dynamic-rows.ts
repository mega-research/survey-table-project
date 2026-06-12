import { useMemo } from 'react';

import { useDynamicRowLayout } from '@/hooks/use-dynamic-row-layout';
import { useDynamicRowState } from '@/hooks/use-dynamic-row-state';
import type { DynamicRowGroupConfig, TableRow } from '@/types/survey';
import { recalculateRowspansForVisibleRows } from '@/utils/table-merge-helpers';
import { isTableRowCompleted } from '@/utils/table-row-completion';

/**
 * 동적 행 파이프라인 facade — 동적 행 기능의 단일 진입점.
 *
 * 상태(useDynamicRowState) → 가시 행 필터링(동적 그룹 제외 + rowspan 재계산) →
 * 레이아웃(useDynamicRowLayout) → 행 완료 맵까지의 호출 순서와 데이터 배선
 * (상태 출력 6개 → 필터 → 레이아웃 입력)을 이 모듈이 소유한다. 호출자는 파이프라인의
 * 존재를 모르고 렌더 계약(displayRows·gridMap·핸들러)만 소비한다.
 *
 * 두 내부 훅(use-dynamic-row-state, use-dynamic-row-layout)은 이 facade 의
 * implementation 이다 — 컴포넌트는 이 훅만 import 한다.
 *
 * displayCondition 평가(branch-logic, allResponses 의존)는 호출자 소유다:
 * - conditionVisibleRowIds: 행 displayCondition 평가 결과 (null = 필터 없음)
 * - hiddenGroupIds: 동적 그룹 displayCondition 평가 결과
 * 열 필터링(visibleColumns/columnFilteredRows)도 호출자 소유 — 결과만 주입받는다.
 */

interface UseDynamicRowsParams {
  questionId: string;
  /** 원본 전체 행 (셀렉터 앵커 역추적·그룹 소속 판정용) */
  rows: TableRow[];
  /** 열 displayCondition 필터 + colspan 재계산 후 행 (호출자 소유) */
  columnFilteredRows: TableRow[];
  /** 행 displayCondition 평가 결과 — null 이면 조건 필터 없음 (호출자 소유) */
  conditionVisibleRowIds?: Set<string> | null | undefined;
  /** 그룹 displayCondition 으로 숨길 그룹 ID (호출자 소유) */
  hiddenGroupIds?: Set<string> | undefined;
  dynamicRowConfigs?: DynamicRowGroupConfig[] | undefined;
  isTestMode: boolean;
  value?: Record<string, any> | undefined;
  onChange?: ((v: Record<string, any>) => void) | undefined;
  headerRowCount: number;
}

interface UseDynamicRowsReturn {
  // 렌더 계약
  displayRows: TableRow[];
  rowGridMap: Map<string, number>;
  selectorGridMap: Map<string, number>;
  groupSelectedCountMap: Map<string, number>;
  expandedGroupRows: Map<string, TableRow[]>;
  rowCompletionMap: Map<string, boolean>;
  // 응답·선택 상태
  currentResponse: Record<string, any>;
  groupConfigMap: Map<string, DynamicRowGroupConfig>;
  dynamicRows: TableRow[];
  hasDynamicRows: boolean;
  selectedRowIds: string[];
  // 모달·펼침 상태와 핸들러
  activeGroupId: string | null;
  handleSelectGroup: (id: string) => void;
  handleDynamicRowSelect: (rowIds: string[]) => void;
  closeModal: () => void;
  expandedGroupIds: Set<string>;
  toggleGroupExpanded: (groupId: string) => void;
}

export function useDynamicRows({
  questionId,
  rows,
  columnFilteredRows,
  conditionVisibleRowIds,
  hiddenGroupIds,
  dynamicRowConfigs,
  isTestMode,
  value,
  onChange,
  headerRowCount,
}: UseDynamicRowsParams): UseDynamicRowsReturn {
  // 1) 동적 행 상태 — store 구독, 선택/펼침 상태, 핸들러
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
    onChange,
  });

  // 2) 가시 행 필터링 — 행 displayCondition 결과 적용 + 동적 그룹 행 제외 + rowspan 재계산
  const visibleRows = useMemo(() => {
    if (columnFilteredRows.length === 0) return columnFilteredRows;
    let filtered = columnFilteredRows;

    if (conditionVisibleRowIds) {
      filtered = filtered.filter((row) => conditionVisibleRowIds.has(row.id));
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
  }, [columnFilteredRows, conditionVisibleRowIds, hasDynamicRows, groupConfigMap]);

  // 3) 동적 행 레이아웃 — displayRows, 셀렉터 배치, grid 좌표
  const { displayRows, rowGridMap, selectorGridMap, groupSelectedCountMap, expandedGroupRows } =
    useDynamicRowLayout({
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

  // 4) 행별 완료 상태 맵 (displayRows + 펼친 그룹 행 포함)
  const rowCompletionMap = useMemo(() => {
    const map = new Map<string, boolean>();
    const checkRow = (row: TableRow) => {
      map.set(row.id, isTableRowCompleted(row, currentResponse));
    };
    for (const row of displayRows) checkRow(row);
    for (const groupRows of expandedGroupRows.values()) {
      for (const row of groupRows) checkRow(row);
    }
    return map;
  }, [displayRows, expandedGroupRows, currentResponse]);

  return {
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
  };
}
