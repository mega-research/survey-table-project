import { useCallback, useRef, useState } from 'react';

import { type Patch, applyPatches, enablePatches, produceWithPatches } from 'immer';

import { useSyncLatestRef } from '@/hooks/use-latest-ref';
import { generateId } from '@/lib/utils';
import type { TableColumn, TableRow } from '@/types/survey';
import {
  INTERACTIVE_CELL_TYPES,
  generateCellCode,
  generateExportLabel,
  inferSpssMeasure,
  inferSpssVarType,
} from '@/utils/table-cell-code-generator';

import {
  type CopiedRegion,
  type PasteConflictResult,
  calculateDragRange,
  checkPasteConflict,
  clearStaleTypeProperties,
  createRadioGroupRemapper,
  findRegionSourceCellPos,
  pruneDeadGatingAfterPaste,
  resolvePastedGating,
  expandSelectionForMerges,
  extractRegionFromRows,
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

export type PasteResult = { success: true; count: number } | { blocked: true; message: string };

interface UseDragCopyParams {
  currentRowsRef: React.RefObject<TableRow[]>;
  currentColumnsRef: React.RefObject<TableColumn[]>;
  questionCodeRef: React.RefObject<string | undefined>;
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
  useSyncLatestRef(dragCopyStateRef, dragCopyState);

  const copiedRegionRef = useRef(copiedRegion);
  useSyncLatestRef(copiedRegionRef, copiedRegion);

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

      setDragCopyState((prev) => (prev ? { ...prev, selectedCells: cells } : null));
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
      expanded.minRow,
      expanded.maxRow,
      expanded.minCol,
      expanded.maxCol,
      rows,
    );

    setCopiedRegion(region);
    setUndoInfo(null); // 이전 붙여넣기 undo 정보 초기화
    clearCopiedCell(); // 상호 배타
    lastDragPosRef.current = null;
    setDragCopyState(null);

    return { width: region.width, height: region.height };
  }, [currentRowsRef, clearCopiedCell]);

  // ── 영역 붙여넣기 ──

  const pasteRegion = useCallback(
    (targetRow: number, targetCol: number): PasteResult => {
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

      // 원본 radioGroupName → 새 그룹명 매핑. 같은 그룹명을 공유하던 라디오 셀들은
      // 붙여넣기 후에도 하나의 새 그룹명을 공유해 단일 선택/형제 클리어/ SPSS 그룹을 유지한다.
      const remapRadioGroupName = createRadioGroupRemapper(generateId);

      // immer로 붙여넣기 적용
      const [nextRows, , inversePatches] = produceWithPatches(rows, (draft) => {
        for (let rr = 0; rr < region.height; rr++) {
          for (let cc = 0; cc < region.width; cc++) {
            const absRow = targetRow + rr;
            const absCol = targetCol + cc;
            const targetCell = draft[absRow]?.cells[absCol];
            if (!targetCell) continue;

            const sourceCellRow = region.cells[rr];
            const sourceCell = sourceCellRow ? sourceCellRow[cc] : undefined;

            if (sourceCell === null || sourceCell === undefined) {
              if (sourceCell === null) {
                // hidden 위치 → 내용 초기화 (recalculateHiddenCells가 isHidden 설정)
                targetCell.type = 'text';
                targetCell.content = '';
                delete targetCell.rowspan;
                delete targetCell.colspan;
                // 타입별 잔여 속성 정리
                clearStaleTypeProperties(
                  targetCell as unknown as Record<string, unknown>,
                  'text',
                );
              }
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

            // radio 셀이면 새 groupName 발급 (원본 그룹 단위로 공유 유지),
            // radio 가 아니면 소스에서 딸려온 잔여 radioGroupName 제거.
            if (targetCell.type === 'radio') {
              targetCell.radioGroupName = remapRadioGroupName(sourceCell.radioGroupName);
            } else {
              delete (targetCell as { radioGroupName?: string }).radioGroupName;
            }

            // 셀 게이팅 컨트롤러 재해석: 영역 안이면 같은 상대 위치의 대상 셀로 리매핑,
            // 대상 행에 있으면 유지, 그 외에는 제거 (resolvePastedGating 규약).
            if (targetCell.enabledWhen) {
              // 스냅샷 셀에는 id 가 없으므로(REGION_EXCLUDED_KEYS) sourceCellIds 격자로 되짚는다.
              // 대상 셀 id 는 붙여넣기에서 보존되므로 원본 rows 기준으로 읽어도 같다.
              // 리매핑 위치는 이번 붙여넣기가 소스의 보이는 컨트롤러 셀을 그대로 써넣는
              // 자리라서(붙여넣기 후 recalculateHiddenCells 가 소스 병합 기하를 복원)
              // 대상의 이전 hidden 여부와 무관하게 유효하다.
              const pos = findRegionSourceCellPos(region, targetCell.enabledWhen.controllerCellId);
              const remappedControllerId = pos
                ? rows[targetRow + pos.row]?.cells[targetCol + pos.col]?.id
                : undefined;
              const resolved = resolvePastedGating(
                targetCell.enabledWhen,
                remappedControllerId,
                rows[absRow]?.cells ?? [],
              );
              if (resolved) {
                targetCell.enabledWhen = resolved;
              } else {
                delete (targetCell as { enabledWhen?: unknown }).enabledWhen;
                delete (targetCell as { requiredWhenEnabled?: boolean }).requiredWhenEnabled;
              }
            }

            // cellCode/exportLabel 재생성
            const targetRowData = draft[absRow];
            if (!targetRowData) continue;
            const targetColumn = columns[absCol];
            const newCellCode = generateCellCode(
              questionCodeRef.current,
              targetRowData.rowCode,
              targetColumn?.columnCode,
            );
            if (newCellCode !== undefined) {
              targetCell.cellCode = newCellCode;
            } else {
              delete targetCell.cellCode;
            }
            targetCell.isCustomCellCode = false;
            const newExportLabel = generateExportLabel(
              questionCodeRef.current,
              targetColumn?.label || targetColumn?.columnCode,
              targetRowData.label || targetRowData.rowCode,
            );
            if (newExportLabel !== undefined) {
              targetCell.exportLabel = newExportLabel;
            } else {
              delete targetCell.exportLabel;
            }
            targetCell.isCustomExportLabel = false;

            // SPSS 변수 타입 갱신 (소스 셀의 커스텀 값 보존, 없을 때만 추론)
            if (INTERACTIVE_CELL_TYPES.has(targetCell.type)) {
              if (!targetCell.spssVarType) {
                const inferred = inferSpssVarType(targetCell.type);
                if (inferred !== undefined) {
                  targetCell.spssVarType = inferred;
                }
              }
              if (!targetCell.spssMeasure) {
                const inferred = inferSpssMeasure(targetCell.type);
                if (inferred !== undefined) {
                  targetCell.spssMeasure = inferred;
                }
              }
            } else {
              delete targetCell.spssVarType;
              delete targetCell.spssMeasure;
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
              delete cell.isOtherRankingCell;
            }
          }
        }

        // 붙여넣은 병합 앵커가 새로 숨기는 컨트롤러의 게이팅 정리 (undo 패치에 포함되도록
        // draft 안에서 수행 — isHidden 재계산 전이라 스팬 커버리지로 선판정한다)
        pruneDeadGatingAfterPaste(draft, rows, {
          fromRow: targetRow,
          toRow: targetRow + region.height - 1,
          fromCol: targetCol,
          toCol: targetCol + region.width - 1,
        });
      });

      // isHidden 재계산
      const finalRows = recalculateHiddenCells(nextRows);
      const cellCount = region.width * region.height;

      setCurrentRows(finalRows);
      notifyChange(currentTitleRef.current, columns, finalRows);
      setUndoInfo({ inversePatches, cellCount });

      return { success: true, count: cellCount };
    },
    [
      currentRowsRef,
      currentColumnsRef,
      questionCodeRef,
      setCurrentRows,
      notifyChange,
      currentTitleRef,
      recalculateHiddenCells,
    ],
  );

  // ── 기타 액션 ──

  const cancelDragCopy = useCallback(() => {
    lastDragPosRef.current = null;
    setDragCopyState(null);
  }, []);

  const undoPaste = useCallback(() => {
    if (!undoInfo) return;

    const rows = currentRowsRef.current;
    const columns = currentColumnsRef.current;
    // isHidden 은 붙여넣기 커밋 시 patch 밖(recalculateHiddenCells)에서 재계산되므로
    // patch 복원만으로는 되돌아오지 않는다 — 예: 붙여넣은 병합 앵커가 덮었던 컨트롤러가
    // undo 후에도 숨김으로 남는다. 복원된 스팬 기하 기준으로 다시 재계산해야 한다.
    const restoredRows = recalculateHiddenCells(applyPatches(rows, undoInfo.inversePatches));

    setCurrentRows(restoredRows);
    notifyChange(currentTitleRef.current, columns, restoredRows);
    setUndoInfo(null);
  }, [undoInfo, currentRowsRef, currentColumnsRef, setCurrentRows, notifyChange, currentTitleRef, recalculateHiddenCells]);

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
