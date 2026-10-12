import { useMemo } from 'react';

import type { DynamicRowGroupConfig, TableCell, TableRow } from '@/types/survey';
import { recalculateRowspansForVisibleRows } from '@/utils/table-merge-helpers';

interface UseDynamicRowLayoutParams {
  rows: TableRow[];
  columnFilteredRows: TableRow[]; // 열 필터링 후 행 (expandedGroupRows 셀 기준)
  visibleRows: TableRow[];
  groupConfigMap: Map<string, DynamicRowGroupConfig>;
  selectedRowIds: string[];
  hasDynamicRows: boolean;
  headerRowCount: number;
  expandedGroupIds: Set<string>;
  hiddenGroupIds?: Set<string> | undefined;
  /** 행 차례로 열기 묶음의 행 id — 있으면 마지막으로 보이는 묶음 행 아래에 버튼 줄 자리를 낸다 */
  stagedRowIds?: ReadonlySet<string> | undefined;
}

/** 표 안에 끼운 「행 차례로 열기」 버튼 줄의 자리 */
export interface StagedControlPlacement {
  gridRow: number;
  /** 버튼 줄이 시작하는 열(1부터). 앞 열은 묶음을 가로지르는 세로 병합 칸이 덮는다 */
  columnStart: number;
}

interface UseDynamicRowLayoutReturn {
  displayRows: TableRow[];
  selectorAnchors: Map<string, string | null>;
  rowGridMap: Map<string, number>;
  selectorGridMap: Map<string, number>;
  groupSelectedCountMap: Map<string, number>;
  expandedGroupRows: Map<string, TableRow[]>;
  /** 버튼 줄 자리 — 묶음 행이 하나도 보이지 않으면 null */
  stagedControl: StagedControlPlacement | null;
}

/**
 * 버튼 줄을 가로지르는 세로 병합 칸 — 앵커 행(또는 그 위)에서 시작해 앵커 뒤까지 덮는 칸.
 * 이 칸들이 왼쪽 끝에서부터 빈틈없이 붙어 있으면 버튼 줄까지 그대로 덮게 하고(`leadingColumns`),
 * 그렇지 않으면 null — 호출부가 동적 행 셀렉터처럼 병합을 앵커에서 쪼갠다.
 */
function findCrossingCells(
  visibleRows: TableRow[],
  anchorIdx: number,
): { cells: { rowIdx: number; colIdx: number }[]; leadingColumns: number | null } {
  const cells: { rowIdx: number; colIdx: number; colspan: number }[] = [];
  for (let rowIdx = 0; rowIdx <= anchorIdx; rowIdx += 1) {
    const row = visibleRows[rowIdx];
    if (!row) continue;
    row.cells.forEach((cell, colIdx) => {
      if (cell.isHidden) return;
      const span = cell.rowspan ?? 1;
      if (span > 1 && rowIdx + span - 1 > anchorIdx) {
        cells.push({ rowIdx, colIdx, colspan: cell.colspan ?? 1 });
      }
    });
  }
  let next = 0;
  for (const cell of [...cells].sort((a, b) => a.colIdx - b.colIdx)) {
    if (cell.colIdx !== next) return { cells, leadingColumns: null };
    next += cell.colspan;
  }
  return { cells, leadingColumns: next };
}

export function useDynamicRowLayout({
  rows,
  columnFilteredRows,
  visibleRows,
  groupConfigMap,
  selectedRowIds,
  hasDynamicRows,
  headerRowCount,
  expandedGroupIds,
  hiddenGroupIds,
  stagedRowIds,
}: UseDynamicRowLayoutParams): UseDynamicRowLayoutReturn {
  // 그룹별 셀렉터 앵커 위치 (null = 헤더 바로 아래)
  const selectorAnchors = useMemo(() => {
    if (!hasDynamicRows) return new Map<string, string | null>();
    const anchors = new Map<string, string | null>();

    for (const [groupId, config] of groupConfigMap) {
      if (config.insertAfterRowId) {
        // 명시적 삽입 위치: visibleRows에서 해당 행 찾기
        const anchorRow = visibleRows.find((r) => r.id === config.insertAfterRowId);
        if (anchorRow) {
          anchors.set(groupId, anchorRow.id);
        } else {
          // 지정된 행이 보이지 않는 경우: 원본에서 역추적하여 가장 가까운 보이는 행 찾기
          const origIdx = rows.findIndex((r) => r.id === config.insertAfterRowId);
          let placed = false;
          if (origIdx !== -1) {
            for (let i = origIdx; i >= 0; i--) {
              const rowAtI = rows[i];
              if (!rowAtI) continue;
              const found = visibleRows.find((vr) => vr.id === rowAtI.id);
              if (found) {
                anchors.set(groupId, found.id);
                placed = true;
                break;
              }
            }
          }
          if (!placed) anchors.set(groupId, null);
        }
      } else {
        // insertAfterRowId 미지정 → 헤더 바로 아래
        anchors.set(groupId, null);
      }
    }
    return anchors;
  }, [hasDynamicRows, groupConfigMap, visibleRows, rows]);

  // 여러 셀렉터 행 삽입 시 앵커 인덱스별 셀렉터 수
  // null 앵커(헤더 바로 아래)는 제외 — 데이터 행 병합과 무관
  const dynamicSelectorCountByAnchorIdx = useMemo(() => {
    const countMap = new Map<number, number>();
    for (const [, anchorId] of selectorAnchors) {
      if (anchorId === null) continue;
      const idx = visibleRows.findIndex((r) => r.id === anchorId);
      if (idx !== -1) countMap.set(idx, (countMap.get(idx) || 0) + 1);
    }
    return countMap;
  }, [selectorAnchors, visibleRows]);

  // 행 차례로 열기 버튼 줄 — 앵커는 지금 보이는 마지막 묶음 행이다.
  // 묶음을 가로지르는 세로 병합 칸이 왼쪽에 빈틈없이 붙어 있으면 버튼 줄까지 덮게 하고
  // (`extend`), 그렇지 않거나 같은 표에 동적 행 셀렉터가 있으면 셀렉터와 같은 방식으로
  // 병합을 앵커에서 쪼갠다(`split`) — 두 방식을 한 칸에 섞으면 격자가 겹친다.
  const stagedAnchor = useMemo(() => {
    if (!stagedRowIds || stagedRowIds.size === 0) return null;
    let anchorIdx = -1;
    visibleRows.forEach((row, idx) => {
      if (stagedRowIds.has(row.id)) anchorIdx = idx;
    });
    if (anchorIdx === -1) return null;
    const anchorRow = visibleRows[anchorIdx];
    if (!anchorRow) return null;
    const crossing = findCrossingCells(visibleRows, anchorIdx);
    const extend = dynamicSelectorCountByAnchorIdx.size === 0 && crossing.leadingColumns !== null;
    return {
      rowId: anchorRow.id,
      anchorIdx,
      mode: extend ? ('extend' as const) : ('split' as const),
      columnStart: extend ? (crossing.leadingColumns ?? 0) + 1 : 1,
      crossingCells: extend ? crossing.cells : [],
    };
  }, [stagedRowIds, visibleRows, dynamicSelectorCountByAnchorIdx]);

  const selectorCountByAnchorIdx = useMemo(() => {
    if (stagedAnchor?.mode !== 'split') return dynamicSelectorCountByAnchorIdx;
    const countMap = new Map(dynamicSelectorCountByAnchorIdx);
    countMap.set(stagedAnchor.anchorIdx, (countMap.get(stagedAnchor.anchorIdx) || 0) + 1);
    return countMap;
  }, [dynamicSelectorCountByAnchorIdx, stagedAnchor]);

  // 셀렉터 경계에서 병합 셀을 분리하여 겹침 방지
  const displayRows = useMemo(() => {
    if (stagedAnchor?.mode === 'extend' && stagedAnchor.crossingCells.length > 0) {
      // 버튼 줄을 가로지르는 병합 칸은 쪼개지 않고 격자에서 한 줄 더 덮게만 한다.
      const extended = new Map<number, Set<number>>();
      for (const { rowIdx, colIdx } of stagedAnchor.crossingCells) {
        extended.set(rowIdx, (extended.get(rowIdx) ?? new Set()).add(colIdx));
      }
      return visibleRows.map((row, rowIdx) => {
        const cols = extended.get(rowIdx);
        if (!cols) return row;
        return {
          ...row,
          cells: row.cells.map((cell, colIdx) =>
            cols.has(colIdx) ? { ...cell, _gridRowSpanExtra: 1 } : cell,
          ),
        };
      });
    }
    if (selectorCountByAnchorIdx.size === 0) return visibleRows;

    const anchorIndices = [...selectorCountByAnchorIdx.keys()].sort((a, b) => a - b);

    // 셀 단위 오버라이드 맵: Map<rowIdx, Map<colIdx, Partial<TableCell>>>
    const overrides = new Map<number, Map<number, Partial<TableCell>>>();

    const setOvr = (rIdx: number, cIdx: number, ovr: Partial<TableCell>) => {
      let rowOvr = overrides.get(rIdx);
      if (!rowOvr) {
        rowOvr = new Map();
        overrides.set(rIdx, rowOvr);
      }
      rowOvr.set(cIdx, { ...rowOvr.get(cIdx), ...ovr });
    };

    for (let rowIdx = 0; rowIdx < visibleRows.length; rowIdx += 1) {
      const row = visibleRows[rowIdx];
      if (!row) continue;
      for (let colIdx = 0; colIdx < row.cells.length; colIdx++) {
        const cell = row.cells[colIdx];
        if (!cell || cell.isHidden || (cell.rowspan ?? 1) <= 1) continue;

        const span = cell.rowspan ?? 1;
        const spanEnd = rowIdx + span;

        // 이 병합 범위와 겹치는 앵커 찾기
        const intersecting = anchorIndices.filter((ai) => ai >= rowIdx && ai < spanEnd - 1);
        if (intersecting.length === 0) continue;

        // 첫 번째 세그먼트: 원래 시작 ~ 첫 앵커까지
        const firstAnchor = intersecting[0];
        if (firstAnchor === undefined) continue;
        const seg1Span = firstAnchor - rowIdx + 1;
        // seg1Span === 1 인 경우에도 rowspan 을 명시적으로 1 로 정정해야 원래 병합이 풀린다.
        // 빈 오버라이드를 쓰면 원래 rowspan 이 유지되어 후속 세그먼트와 겹친다.
        setOvr(rowIdx, colIdx, { rowspan: seg1Span });

        // 후속 세그먼트들: 각 앵커 바로 다음 행에서 시작
        for (let i = 0; i < intersecting.length; i++) {
          const anchorI = intersecting[i];
          if (anchorI === undefined) break;
          const nextStart = anchorI + 1;
          if (nextStart >= spanEnd) break;

          const nextAnchor = intersecting[i + 1];
          const nextEnd = nextAnchor !== undefined ? nextAnchor + 1 : spanEnd;
          const segSpan = nextEnd - nextStart;
          const isInteractive = ['checkbox', 'radio', 'select', 'input'].includes(cell.type);

          setOvr(nextStart, colIdx, {
            isHidden: false,
            type: isInteractive ? 'text' : cell.type,
            content: isInteractive ? '' : cell.content,
            ...(!isInteractive && cell.contentHtml ? { contentHtml: cell.contentHtml } : {}),
            ...(cell.colspan !== undefined ? { colspan: cell.colspan } : {}),
            ...(cell.horizontalAlign !== undefined
              ? { horizontalAlign: cell.horizontalAlign }
              : {}),
            ...(cell.verticalAlign !== undefined ? { verticalAlign: cell.verticalAlign } : {}),
            ...(segSpan > 1 ? { rowspan: segSpan } : {}),
            _isContinuation: true,
          });
        }
      }
    }

    // 오버라이드 적용
    if (overrides.size === 0) return visibleRows;
    return visibleRows.map((row, rowIdx) => {
      const rowOvr = overrides.get(rowIdx);
      if (!rowOvr) return row;
      return {
        ...row,
        cells: row.cells.map((cell, colIdx) => {
          const cellOvr = rowOvr.get(colIdx);
          if (!cellOvr) return cell;
          return { ...cell, ...cellOvr };
        }),
      };
    });
  }, [visibleRows, selectorCountByAnchorIdx, stagedAnchor]);

  // 그룹별 선택 카운트 맵
  const groupSelectedCountMap = useMemo(() => {
    const map = new Map<string, number>();
    for (const [groupId] of groupConfigMap) {
      const count = selectedRowIds.filter(
        (id) => rows.find((r) => r.id === id)?.dynamicGroupId === groupId,
      ).length;
      map.set(groupId, count);
    }
    return map;
  }, [groupConfigMap, selectedRowIds, rows]);

  // 펼친 그룹의 표시 행 (선택된 행 + 소계 행, 열 필터링 적용)
  const expandedGroupRows = useMemo(() => {
    const map = new Map<string, TableRow[]>();
    if (expandedGroupIds.size === 0) return map;

    const selectedSet = new Set(selectedRowIds);
    const groupsWithSelections = new Set<string>();
    for (const id of selectedRowIds) {
      const row = columnFilteredRows.find((r) => r.id === id);
      if (row?.dynamicGroupId) groupsWithSelections.add(row.dynamicGroupId);
    }

    for (const groupId of expandedGroupIds) {
      if (!groupConfigMap.has(groupId)) continue;
      const groupRows: TableRow[] = [];

      for (const row of columnFilteredRows) {
        if (row.dynamicGroupId === groupId && selectedSet.has(row.id)) {
          groupRows.push(row);
        }
        if (row.showWhenDynamicGroupId === groupId && groupsWithSelections.has(groupId)) {
          groupRows.push(row);
        }
      }

      // rowspan을 그룹 내 선택된 행 수에 맞게 재계산 (열 필터링된 행 기준)
      const visibleIds = new Set(groupRows.map((r) => r.id));
      map.set(groupId, recalculateRowspansForVisibleRows(columnFilteredRows, visibleIds));
    }
    return map;
  }, [expandedGroupIds, selectedRowIds, columnFilteredRows, groupConfigMap]);

  // 명시적 grid-row 위치 계산 (셀렉터 행 + 펼친 행 포함)
  const { rowGridMap, selectorGridMap, stagedControl } = useMemo(() => {
    const rowMap = new Map<string, number>();
    const selMap = new Map<string, number>();
    let staged: StagedControlPlacement | null = null;

    let gridRow = headerRowCount + 1;

    const isGroupVisible = (groupId: string) => !hiddenGroupIds || !hiddenGroupIds.has(groupId);

    // Phase 1: null 앵커 (헤더 바로 아래) 셀렉터들 먼저 배치
    for (const [groupId, anchorId] of selectorAnchors) {
      if (anchorId !== null) continue;
      if (!isGroupVisible(groupId)) continue;
      selMap.set(groupId, gridRow);
      gridRow += 1;
      if (expandedGroupIds.has(groupId)) {
        const groupRows = expandedGroupRows.get(groupId) ?? [];
        for (const gr of groupRows) {
          rowMap.set(gr.id, gridRow);
          gridRow += 1;
        }
      }
    }

    // Phase 2: 데이터행 + 일반 앵커 셀렉터
    for (const row of displayRows) {
      rowMap.set(row.id, gridRow);
      gridRow += 1;

      for (const [groupId, anchorId] of selectorAnchors) {
        if (anchorId !== row.id) continue;
        if (!isGroupVisible(groupId)) continue;
        selMap.set(groupId, gridRow);
        gridRow += 1;
        if (expandedGroupIds.has(groupId)) {
          const groupRows = expandedGroupRows.get(groupId) ?? [];
          for (const gr of groupRows) {
            rowMap.set(gr.id, gridRow);
            gridRow += 1;
          }
        }
      }

      // 행 차례로 열기 버튼 줄 — 마지막으로 보이는 묶음 행 바로 아래 한 줄.
      if (stagedAnchor && stagedAnchor.rowId === row.id) {
        staged = { gridRow, columnStart: stagedAnchor.columnStart };
        gridRow += 1;
      }
    }
    return { rowGridMap: rowMap, selectorGridMap: selMap, stagedControl: staged };
  }, [
    displayRows,
    selectorAnchors,
    headerRowCount,
    expandedGroupIds,
    expandedGroupRows,
    hiddenGroupIds,
    stagedAnchor,
  ]);

  return {
    stagedControl,
    displayRows,
    selectorAnchors,
    rowGridMap,
    selectorGridMap,
    groupSelectedCountMap,
    expandedGroupRows,
  };
}
