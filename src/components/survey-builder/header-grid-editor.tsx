'use client';

import React, { useCallback, useMemo, useState } from 'react';

import { Combine, Minus, Plus, Unlink } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { generateId } from '@/lib/utils';
import { HeaderCell } from '@/types/survey';

interface HeaderGridEditorProps {
  headerGrid: HeaderCell[][];
  columnCount: number; // tableColumns.length
  onChange: (grid: HeaderCell[][]) => void;
}

/**
 * 점유 맵: occupied[row][col] = 해당 그리드 위치를 점유하는 셀의 참조
 */
interface OccupiedRef {
  rowIdx: number;
  cellIdx: number;
  gridCol: number; // 이 셀의 시작 그리드 열
}

function buildOccupiedMap(
  grid: HeaderCell[][],
  totalRows: number,
  columnCount: number,
): (OccupiedRef | null)[][] {
  const map: (OccupiedRef | null)[][] = Array.from({ length: totalRows }, () =>
    Array(columnCount).fill(null),
  );

  for (let rowIdx = 0; rowIdx < grid.length; rowIdx++) {
    const row = grid[rowIdx];
    let colPos = 0;
    for (let cellIdx = 0; cellIdx < row.length; cellIdx++) {
      // 이미 점유된 슬롯 건너뛰기 (위쪽 행의 rowspan)
      while (colPos < columnCount && map[rowIdx][colPos] !== null) {
        colPos++;
      }
      const cell = row[cellIdx];
      const ref: OccupiedRef = { rowIdx, cellIdx, gridCol: colPos };
      for (let r = 0; r < cell.rowspan; r++) {
        for (let c = 0; c < cell.colspan; c++) {
          if (rowIdx + r < totalRows && colPos + c < columnCount) {
            map[rowIdx + r][colPos + c] = ref;
          }
        }
      }
      colPos += cell.colspan;
    }
  }

  return map;
}

/**
 * 점유 맵에서 셀의 시작 그리드 열 위치를 가져옴
 */
function getCellGridCol(
  occupiedMap: (OccupiedRef | null)[][],
  rowIdx: number,
  cellIdx: number,
  columnCount: number,
): number {
  for (let c = 0; c < columnCount; c++) {
    const ref = occupiedMap[rowIdx]?.[c];
    if (ref && ref.rowIdx === rowIdx && ref.cellIdx === cellIdx) {
      return c;
    }
  }
  return 0;
}

export function HeaderGridEditor({ headerGrid, columnCount, onChange }: HeaderGridEditorProps) {
  const [selectedCells, setSelectedCells] = useState<Set<string>>(new Set());
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState<{ row: number; col: number } | null>(null);
  const [editingCell, setEditingCell] = useState<{ rowIdx: number; cellIdx: number } | null>(null);

  const totalRows = headerGrid.length;

  const occupiedMap = useMemo(
    () => buildOccupiedMap(headerGrid, totalRows, columnCount),
    [headerGrid, totalRows, columnCount],
  );

  // 선택 영역의 경계 계산
  const selectionBounds = useMemo(() => {
    if (selectedCells.size === 0) return null;
    const coords = Array.from(selectedCells).map((key) => {
      const [r, c] = key.split('-').map(Number);
      return { row: r, col: c };
    });
    return {
      minRow: Math.min(...coords.map((c) => c.row)),
      maxRow: Math.max(...coords.map((c) => c.row)),
      minCol: Math.min(...coords.map((c) => c.col)),
      maxCol: Math.max(...coords.map((c) => c.col)),
    };
  }, [selectedCells]);

  // 병합 가능 여부 확인
  const canMerge = useMemo(() => {
    if (!selectionBounds || selectedCells.size < 2) return false;
    const { minRow, maxRow, minCol, maxCol } = selectionBounds;
    const expectedCount = (maxRow - minRow + 1) * (maxCol - minCol + 1);
    if (selectedCells.size !== expectedCount) return false;

    // 선택 영역 내 모든 슬롯이 점유되어 있는지
    for (let r = minRow; r <= maxRow; r++) {
      for (let c = minCol; c <= maxCol; c++) {
        if (!occupiedMap[r]?.[c]) return false;
      }
    }

    // 기존 병합 셀이 선택 영역에 걸쳐있는지 확인 (일부만 포함되면 안됨)
    const involvedRefs = new Set<string>();
    for (let r = minRow; r <= maxRow; r++) {
      for (let c = minCol; c <= maxCol; c++) {
        const ref = occupiedMap[r]?.[c];
        if (ref) involvedRefs.add(`${ref.rowIdx}-${ref.cellIdx}`);
      }
    }

    for (const refKey of involvedRefs) {
      const [rIdx, cIdx] = refKey.split('-').map(Number);
      const cell = headerGrid[rIdx]?.[cIdx];
      if (!cell) return false;
      const startCol = getCellGridCol(occupiedMap, rIdx, cIdx, columnCount);
      // 이 셀의 전체 영역이 선택 영역 안에 있는지
      for (let r = 0; r < cell.rowspan; r++) {
        for (let c = 0; c < cell.colspan; c++) {
          if (!selectedCells.has(`${rIdx + r}-${startCol + c}`)) return false;
        }
      }
    }

    return true;
  }, [selectionBounds, selectedCells, occupiedMap, headerGrid, columnCount]);

  // 분할 가능 여부
  const canUnmerge = useMemo(() => {
    if (selectedCells.size === 0) return false;
    for (const key of selectedCells) {
      const [r, c] = key.split('-').map(Number);
      const ref = occupiedMap[r]?.[c];
      if (ref) {
        const cell = headerGrid[ref.rowIdx]?.[ref.cellIdx];
        if (cell && (cell.colspan > 1 || cell.rowspan > 1)) return true;
      }
    }
    return false;
  }, [selectedCells, occupiedMap, headerGrid]);

  // 마우스 핸들러
  const handleMouseDown = useCallback(
    (row: number, col: number, e: React.MouseEvent) => {
      e.preventDefault();
      if (e.detail === 2) {
        const ref = occupiedMap[row]?.[col];
        if (ref) {
          setEditingCell({ rowIdx: ref.rowIdx, cellIdx: ref.cellIdx });
          setSelectedCells(new Set());
        }
        return;
      }
      setIsDragging(true);
      setDragStart({ row, col });
      setSelectedCells(new Set([`${row}-${col}`]));
      setEditingCell(null);
    },
    [occupiedMap],
  );

  const handleMouseEnter = useCallback(
    (row: number, col: number) => {
      if (!isDragging || !dragStart) return;
      const minR = Math.min(dragStart.row, row);
      const maxR = Math.max(dragStart.row, row);
      const minC = Math.min(dragStart.col, col);
      const maxC = Math.max(dragStart.col, col);

      const newSelected = new Set<string>();
      for (let r = minR; r <= maxR; r++) {
        for (let c = minC; c <= maxC; c++) {
          newSelected.add(`${r}-${c}`);
        }
      }
      setSelectedCells(newSelected);
    },
    [isDragging, dragStart],
  );

  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
  }, []);

  // 헤더 행 추가
  const addHeaderRow = useCallback(() => {
    const newRow: HeaderCell[] = Array.from({ length: columnCount }, () => ({
      id: generateId(),
      label: '',
      colspan: 1,
      rowspan: 1,
    }));
    onChange([...headerGrid, newRow]);
    setSelectedCells(new Set());
  }, [headerGrid, columnCount, onChange]);

  // 헤더 행 삭제 (마지막 행, rowspan 걸린 셀이 없을 때만)
  const removeHeaderRow = useCallback(() => {
    if (headerGrid.length <= 1) return;

    // 마지막 행을 점유하는 셀 중 위쪽에서 시작하는 rowspan이 있는지 확인
    const lastRowIdx = headerGrid.length - 1;
    for (let c = 0; c < columnCount; c++) {
      const ref = occupiedMap[lastRowIdx]?.[c];
      if (ref && ref.rowIdx < lastRowIdx) {
        // 위쪽 행에서 시작하는 rowspan이 마지막 행까지 걸쳐있음 → 삭제 불가
        return;
      }
    }

    onChange(headerGrid.slice(0, -1));
    setSelectedCells(new Set());
  }, [headerGrid, columnCount, occupiedMap, onChange]);

  // 셀 병합
  const mergeCells = useCallback(() => {
    if (!canMerge || !selectionBounds) return;
    const { minRow, maxRow, minCol, maxCol } = selectionBounds;
    const mergeColspan = maxCol - minCol + 1;
    const mergeRowspan = maxRow - minRow + 1;

    // 병합 영역에 포함되는 원본 셀 참조 수집
    const mergedRefs = new Set<string>();
    for (let r = minRow; r <= maxRow; r++) {
      for (let c = minCol; c <= maxCol; c++) {
        const ref = occupiedMap[r]?.[c];
        if (ref) mergedRefs.add(`${ref.rowIdx}-${ref.cellIdx}`);
      }
    }

    // 첫 번째 셀의 라벨 사용
    const firstRef = occupiedMap[minRow]?.[minCol];
    const mergedLabel = firstRef ? headerGrid[firstRef.rowIdx][firstRef.cellIdx].label : '';

    // 새 그리드 구성
    const newGrid: HeaderCell[][] = [];
    let mergedCellInserted = false;

    for (let rowIdx = 0; rowIdx < totalRows; rowIdx++) {
      const newRow: HeaderCell[] = [];
      const row = headerGrid[rowIdx];

      for (let cellIdx = 0; cellIdx < row.length; cellIdx++) {
        const refKey = `${rowIdx}-${cellIdx}`;
        const gridCol = getCellGridCol(occupiedMap, rowIdx, cellIdx, columnCount);

        if (mergedRefs.has(refKey)) {
          // 이 셀은 병합 영역에 속함
          if (!mergedCellInserted && rowIdx === minRow && gridCol === minCol) {
            newRow.push({
              id: generateId(),
              label: mergedLabel,
              colspan: mergeColspan,
              rowspan: mergeRowspan,
            });
            mergedCellInserted = true;
          }
          // 나머지는 건너뜀
        } else {
          newRow.push({ ...row[cellIdx] });
        }
      }

      newGrid.push(newRow);
    }

    onChange(newGrid);
    setSelectedCells(new Set());
  }, [canMerge, selectionBounds, occupiedMap, headerGrid, totalRows, columnCount, onChange]);

  // 셀 병합 해제
  const unmergeCells = useCallback(() => {
    if (!canUnmerge) return;

    // 분할할 셀 목록 수집
    const cellsToSplit: { rowIdx: number; cellIdx: number }[] = [];
    const processedRefs = new Set<string>();

    for (const key of selectedCells) {
      const [r, c] = key.split('-').map(Number);
      const ref = occupiedMap[r]?.[c];
      if (!ref) continue;
      const refKey = `${ref.rowIdx}-${ref.cellIdx}`;
      if (processedRefs.has(refKey)) continue;
      processedRefs.add(refKey);
      const cell = headerGrid[ref.rowIdx]?.[ref.cellIdx];
      if (cell && (cell.colspan > 1 || cell.rowspan > 1)) {
        cellsToSplit.push({ rowIdx: ref.rowIdx, cellIdx: ref.cellIdx });
      }
    }

    if (cellsToSplit.length === 0) return;

    // 각 병합 셀을 분할하여 새 그리드 재구성
    // 간단한 접근: occupiedMap 기반으로 전체 그리드를 재구성
    const currentGrid = headerGrid.map((row) => row.map((cell) => ({ ...cell })));

    for (const { rowIdx, cellIdx } of cellsToSplit) {
      // 현재 그리드에서 해당 셀 찾기
      const currentMap = buildOccupiedMap(currentGrid, currentGrid.length, columnCount);
      const cell = currentGrid[rowIdx]?.[cellIdx];
      if (!cell || (cell.colspan <= 1 && cell.rowspan <= 1)) continue;

      const startCol = getCellGridCol(currentMap, rowIdx, cellIdx, columnCount);
      const origColspan = cell.colspan;
      const origRowspan = cell.rowspan;

      // 1. 원본 셀을 1x1로 변경
      cell.colspan = 1;
      cell.rowspan = 1;

      // 2. 같은 행에 빈 셀 추가
      const sameRowCells: HeaderCell[] = [];
      for (let c = 1; c < origColspan; c++) {
        sameRowCells.push({ id: generateId(), label: '', colspan: 1, rowspan: 1 });
      }
      currentGrid[rowIdx].splice(cellIdx + 1, 0, ...sameRowCells);

      // 3. 아래 행들에 빈 셀 추가
      for (let r = 1; r < origRowspan; r++) {
        const targetRowIdx = rowIdx + r;
        if (targetRowIdx >= currentGrid.length) break;

        // 이 행에서 startCol 위치에 해당하는 삽입 위치 찾기
        const tempMap = buildOccupiedMap(currentGrid, currentGrid.length, columnCount);
        let insertPos = 0;

        for (let ci = 0; ci < currentGrid[targetRowIdx].length; ci++) {
          const ciCol = getCellGridCol(tempMap, targetRowIdx, ci, columnCount);
          if (ciCol >= startCol) {
            insertPos = ci;
            break;
          }
          insertPos = ci + 1;
        }

        const fillCells: HeaderCell[] = [];
        for (let c = 0; c < origColspan; c++) {
          fillCells.push({ id: generateId(), label: '', colspan: 1, rowspan: 1 });
        }
        currentGrid[targetRowIdx].splice(insertPos, 0, ...fillCells);
      }
    }

    onChange(currentGrid);
    setSelectedCells(new Set());
  }, [canUnmerge, selectedCells, occupiedMap, headerGrid, columnCount, onChange]);

  // 라벨 변경
  const updateLabel = useCallback(
    (rowIdx: number, cellIdx: number, label: string) => {
      const newGrid = headerGrid.map((row) => row.map((cell) => ({ ...cell })));
      if (newGrid[rowIdx]?.[cellIdx]) {
        newGrid[rowIdx][cellIdx].label = label;
      }
      onChange(newGrid);
    },
    [headerGrid, onChange],
  );

  // 그리드 셀 위치 계산 (렌더링용)
  const cellPositions = useMemo(() => {
    const positions: {
      rowIdx: number;
      cellIdx: number;
      cell: HeaderCell;
      gridCol: number;
    }[] = [];

    for (let rowIdx = 0; rowIdx < headerGrid.length; rowIdx++) {
      const row = headerGrid[rowIdx];
      for (let cellIdx = 0; cellIdx < row.length; cellIdx++) {
        const gridCol = getCellGridCol(occupiedMap, rowIdx, cellIdx, columnCount);
        positions.push({
          rowIdx,
          cellIdx,
          cell: row[cellIdx],
          gridCol,
        });
      }
    }

    return positions;
  }, [headerGrid, columnCount, occupiedMap]);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-gray-700">다단계 헤더 편집</span>
        <div className="flex gap-1">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={addHeaderRow}
            className="h-7 px-2 text-xs"
          >
            <Plus className="mr-1 h-3 w-3" />
            행 추가
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={removeHeaderRow}
            disabled={headerGrid.length <= 1}
            className="h-7 px-2 text-xs"
          >
            <Minus className="mr-1 h-3 w-3" />
            행 삭제
          </Button>
          {canMerge && (
            <Button
              type="button"
              variant="default"
              size="sm"
              onClick={mergeCells}
              className="h-7 px-2 text-xs"
            >
              <Combine className="mr-1 h-3 w-3" />
              병합
            </Button>
          )}
          {canUnmerge && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={unmergeCells}
              className="h-7 px-2 text-xs text-orange-600"
            >
              <Unlink className="mr-1 h-3 w-3" />
              분할
            </Button>
          )}
        </div>
      </div>

      {/* 헤더 그리드 — CSS Grid */}
      <div
        className="select-none overflow-auto rounded-md border-t border-l border-r border-gray-300 bg-white"
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
      >
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: `repeat(${columnCount}, minmax(80px, 1fr))`,
          }}
        >
          {cellPositions.map(({ rowIdx, cellIdx, cell, gridCol }) => {
            let isSelected = false;
            for (let r = 0; r < cell.rowspan; r++) {
              for (let c = 0; c < cell.colspan; c++) {
                if (selectedCells.has(`${rowIdx + r}-${gridCol + c}`)) {
                  isSelected = true;
                }
              }
            }

            const isEditing =
              editingCell?.rowIdx === rowIdx && editingCell?.cellIdx === cellIdx;
            const isMerged = cell.colspan > 1 || cell.rowspan > 1;

            return (
              <div
                key={cell.id}
                className={`border-r border-b border-gray-300 p-1 text-center text-sm transition-colors ${
                  isSelected
                    ? 'bg-blue-100 ring-2 ring-inset ring-blue-400'
                    : isMerged
                      ? 'bg-amber-50 hover:bg-amber-100'
                      : 'bg-white hover:bg-gray-50'
                }`}
                style={{
                  gridColumn: cell.colspan > 1 ? `span ${cell.colspan}` : undefined,
                  gridRow: cell.rowspan > 1 ? `span ${cell.rowspan}` : undefined,
                  cursor: isEditing ? 'text' : 'cell',
                }}
                onMouseDown={(e) => handleMouseDown(rowIdx, gridCol, e)}
                onMouseEnter={() => handleMouseEnter(rowIdx, gridCol)}
              >
                {isEditing ? (
                  <Input
                    autoFocus
                    value={cell.label}
                    onChange={(e) => updateLabel(rowIdx, cellIdx, e.target.value)}
                    onBlur={() => setEditingCell(null)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === 'Escape') {
                        setEditingCell(null);
                      }
                    }}
                    className="h-7 text-center text-sm"
                  />
                ) : (
                  <span
                    className={cell.label ? 'text-gray-800' : 'text-gray-400 italic'}
                    title={isMerged ? `${cell.colspan}×${cell.rowspan} 병합` : undefined}
                  >
                    {cell.label || '(빈 셀)'}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <p className="text-xs text-gray-500">
        셀을 드래그하여 선택 후 &quot;병합&quot; 버튼을 클릭하세요. 더블클릭으로 라벨을 편집할 수
        있습니다.
      </p>
    </div>
  );
}
