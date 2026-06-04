import { useCallback, useRef, useState } from 'react';

import { enablePatches, produceWithPatches, applyPatches, type Patch } from 'immer';

import { generateId } from '@/lib/utils';
import type { TableColumn, TableRow } from '@/types/survey';
import {
  generateCellCode,
  generateExportLabel,
  INTERACTIVE_CELL_TYPES,
  inferSpssMeasure,
  inferSpssVarType,
} from '@/utils/table-cell-code-generator';

import {
  calculateDragRange,
  checkPasteConflict,
  clearStaleTypeProperties,
  expandSelectionForMerges,
  extractRegionFromRows,
  type CopiedRegion,
  type PasteConflictResult,
} from '../utils/drag-copy-utils';

enablePatches();

// ── 타입 ──

export type { CopiedRegion };

export interface DragCopyState {
  sourceRowIndex: number;
  sourceCellIndex: number;
  /** 선택된 영역의 visible 셀 목록 (소스 포함) */
  selectedCells: Array<{ rowIndex: number; cellIndex: number }>;
  isDragging: boolean;
}

export interface PasteUndoInfo {
  inversePatches: Patch[];
  cellCount: number;
}

export type PasteResult =
  | { success: true; count: number }
  | { blocked: true; message: string };

interface UseDragCopyParams {
  currentRowsRef: React.RefObject<TableRow[]>;
  currentColumnsRef: React.RefObject<TableColumn[]>;
  questionCodeRef: React.RefObject<string | undefined>;
  questionTitleRef: React.RefObject<string | undefined>;
  setCurrentRows: (rows: TableRow[]) => void;
  notifyChange: (title: string, cols: TableColumn[], rows: TableRow[]) => void;
  currentTitleRef: React.RefObject<string>;
  recalculateHiddenCells: (rows: TableRow[]) => TableRow[];
  clearCopiedCell: () => void;
}

// ── 훅 ──

export function useDragCopy({
  currentRowsRef,
  currentColumnsRef,
  questionCodeRef,
  questionTitleRef,
  setCurrentRows,
  notifyChange,
  currentTitleRef,
  recalculateHiddenCells,
  clearCopiedCell,
}: UseDragCopyParams) {
  const [dragCopyState, setDragCopyState] = useState<DragCopyState | null>(null);
  const [copiedRegion, setCopiedRegion] = useState<CopiedRegion | null>(null);
  const [undoInfo, setUndoInfo] = useState<PasteUndoInfo | null>(null);

  const dragCopyStateRef = useRef(dragCopyState);
  dragCopyStateRef.current = dragCopyState;

  const copiedRegionRef = useRef(copiedRegion);
  copiedRegionRef.current = copiedRegion;

  // 마지막으로 처리한 마우스 위치 (중복 업데이트 방지)
  const lastDragPosRef = useRef<{ row: number; cell: number } | null>(null);

  // ── 드래그 선택 ──

  const startDragCopy = useCallback((rowIndex: number, cellIndex: number) => {
    lastDragPosRef.current = null;
    setDragCopyState({
      sourceRowIndex: rowIndex,
      sourceCellIndex: cellIndex,
      selectedCells: [{ rowIndex, cellIndex }],
      isDragging: true,
    });
  }, []);

  const updateDragCopyRange = useCallback(
    (rowIndex: number, cellIndex: number) => {
      const state = dragCopyStateRef.current;
      if (!state?.isDragging) return;

      const last = lastDragPosRef.current;
      if (last && last.row === rowIndex && last.cell === cellIndex) return;
      lastDragPosRef.current = { row: rowIndex, cell: cellIndex };

      const cells = calculateDragRange(
        state.sourceRowIndex,
        state.sourceCellIndex,
        rowIndex,
        cellIndex,
        currentRowsRef.current,
      );

      setDragCopyState((prev) =>
        prev ? { ...prev, selectedCells: cells } : null,
      );
    },
    [currentRowsRef],
  );

  // ── 영역 복사 (mouseup 시) ──

  const storeSelectedRegion = useCallback((): { width: number; height: number } | null => {
    const state = dragCopyStateRef.current;
    if (!state || state.selectedCells.length === 0) {
      setDragCopyState(null);
      return null;
    }

    const rows = currentRowsRef.current;

    // 선택 영역의 bounds 계산
    let minRow = state.sourceRowIndex;
    let maxRow = state.sourceRowIndex;
    let minCol = state.sourceCellIndex;
    let maxCol = state.sourceCellIndex;

    // 드래그 끝점이 있으면 (lastDragPos) 사용, 아니면 selectedCells에서 계산
    const last = lastDragPosRef.current;
    if (last) {
      minRow = Math.min(state.sourceRowIndex, last.row);
      maxRow = Math.max(state.sourceRowIndex, last.row);
      minCol = Math.min(state.sourceCellIndex, last.cell);
      maxCol = Math.max(state.sourceCellIndex, last.cell);
    }

    // 병합 셀 경계 확장
    const expanded = expandSelectionForMerges(minRow, maxRow, minCol, maxCol, rows);

    // 영역 추출 및 저장
    const region = extractRegionFromRows(
      expanded.minRow, expanded.maxRow, expanded.minCol, expanded.maxCol, rows,
    );

    setCopiedRegion(region);
    setUndoInfo(null); // 이전 붙여넣기 undo 정보 초기화
    clearCopiedCell(); // 상호 배타
    lastDragPosRef.current = null;
    setDragCopyState(null);

    return { width: region.width, height: region.height };
  }, [currentRowsRef, clearCopiedCell]);

  // ── 영역 붙여넣기 ──

  const pasteRegion = useCallback((targetRow: number, targetCol: number): PasteResult => {
    const region = copiedRegionRef.current;
    if (!region) {
      return { blocked: true, message: '복사된 영역이 없습니다.' };
    }

    const rows = currentRowsRef.current;
    const columns = currentColumnsRef.current;

    // 충돌 검사
    const conflict: PasteConflictResult = checkPasteConflict(region, targetRow, targetCol, rows);
    if (conflict.blocked) {
      return { blocked: true, message: conflict.message! };
    }

    // immer로 붙여넣기 적용
    const [nextRows, , inversePatches] = produceWithPatches(
      rows,
      (draft) => {
        for (let rr = 0; rr < region.height; rr++) {
          for (let cc = 0; cc < region.width; cc++) {
            const absRow = targetRow + rr;
            const absCol = targetCol + cc;
            const targetCell = draft[absRow]?.cells[absCol];
            if (!targetCell) continue;

            const sourceCell = region.cells[rr][cc];

            if (sourceCell === null) {
              // hidden 위치 → 내용 초기화 (recalculateHiddenCells가 isHidden 설정)
              targetCell.type = 'text';
              targetCell.content = '';
              targetCell.rowspan = undefined;
              targetCell.colspan = undefined;
              // 타입별 잔여 속성 정리
              clearStaleTypeProperties(
                targetCell as unknown as Record<string, unknown>,
                'text',
              );
              continue;
            }

            // 대상 셀의 기존 타입과 다르면 잔여 속성 정리
            clearStaleTypeProperties(
              targetCell as unknown as Record<string, unknown>,
              sourceCell.type ?? targetCell.type,
            );

            // 소스 셀의 속성 적용 (id는 보존)
            const preservedId = targetCell.id;
            Object.assign(targetCell, structuredClone(sourceCell));
            targetCell.id = preservedId;

            // radio 셀이면 새 groupName 생성
            if (targetCell.type === 'radio') {
              targetCell.radioGroupName = generateId();
            }

            // cellCode/exportLabel 재생성
            const targetRowData = draft[absRow];
            const targetColumn = columns[absCol];
            targetCell.cellCode = generateCellCode(
              questionCodeRef.current,
              targetRowData.rowCode,
              targetColumn?.columnCode,
            );
            targetCell.isCustomCellCode = false;
            targetCell.exportLabel = generateExportLabel(
              questionCodeRef.current,
              targetColumn?.label,
              targetRowData.label,
            );
            targetCell.isCustomExportLabel = false;

            // SPSS 변수 타입 갱신 (소스 셀의 커스텀 값 보존, 없을 때만 추론)
            if (INTERACTIVE_CELL_TYPES.has(targetCell.type)) {
              if (!targetCell.spssVarType) {
                targetCell.spssVarType = inferSpssVarType(targetCell.type);
              }
              if (!targetCell.spssMeasure) {
                targetCell.spssMeasure = inferSpssMeasure(targetCell.type);
              }
            } else {
              targetCell.spssVarType = undefined;
              targetCell.spssMeasure = undefined;
            }
          }
        }

        // ranking_opt 기타 셀 중복 해제 — 질문당 최대 1개만 유지.
        // 영역 복사로 여러 기타 셀이 생기면 가장 앞쪽 하나만 남기고 나머지 플래그 제거.
        let foundFirst = false;
        for (const row of draft) {
          for (const cell of row.cells) {
            if (cell.type !== 'ranking_opt' || cell.isHidden) continue;
            if (cell.isOtherRankingCell !== true) continue;
            if (!foundFirst) {
              foundFirst = true;
            } else {
              cell.isOtherRankingCell = undefined;
            }
          }
        }
      },
    );

    // isHidden 재계산
    const finalRows = recalculateHiddenCells(nextRows);
    const cellCount = region.width * region.height;

    setCurrentRows(finalRows);
    notifyChange(currentTitleRef.current, columns, finalRows);
    setUndoInfo({ inversePatches, cellCount });

    return { success: true, count: cellCount };
  }, [
    currentRowsRef,
    currentColumnsRef,
    questionCodeRef,
    questionTitleRef,
    setCurrentRows,
    notifyChange,
    currentTitleRef,
    recalculateHiddenCells,
  ]);

  // ── 기타 액션 ──

  const cancelDragCopy = useCallback(() => {
    lastDragPosRef.current = null;
    setDragCopyState(null);
  }, []);

  const undoPaste = useCallback(() => {
    if (!undoInfo) return;

    const rows = currentRowsRef.current;
    const columns = currentColumnsRef.current;
    const restoredRows = applyPatches(rows, undoInfo.inversePatches);

    setCurrentRows(restoredRows);
    notifyChange(currentTitleRef.current, columns, restoredRows);
    setUndoInfo(null);
  }, [undoInfo, currentRowsRef, currentColumnsRef, setCurrentRows, notifyChange, currentTitleRef]);

  const clearCopiedRegion = useCallback(() => {
    setCopiedRegion(null);
  }, []);

  return {
    dragCopyState,
    copiedRegion,
    undoInfo,
    startDragCopy,
    updateDragCopyRange,
    storeSelectedRegion,
    pasteRegion,
    cancelDragCopy,
    undoPaste,
    clearCopiedRegion,
  };
}
