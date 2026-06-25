import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { toast } from 'sonner';

import { generateId } from '@/lib/utils';
import {
  HeaderCell,
  Question,
  QuestionConditionGroup,
  TableCell,
  TableColumn,
  TableRow,
} from '@/types/survey';
import { hasExistingOtherRankingCell } from '@/utils/ranking-source';
import {
  generateAllCellCodes,
  generateCellCodesForRow,
  regenerateCellCodeForPaste,
} from '@/utils/table-cell-code-generator';
import {
  buildDefaultHeaderGrid,
  reconcileHeaderGridForColumnChange,
} from '@/utils/table-merge-helpers';

import { checkCanMerge, executeMerge, executeUnmerge } from '../utils/table-cell-merge';
import { useDragCopy } from './use-drag-copy';

// ── 타입 ──

interface UseTableEditorParams {
  tableTitle?: string | undefined;
  columns?: TableColumn[] | undefined;
  rows?: TableRow[] | undefined;
  tableHeaderGrid?: HeaderCell[][] | undefined;
  currentQuestionId?: string | undefined;
  questionCode?: string | undefined;
  questionTitle?: string | undefined;
  onTableChange: (data: {
    tableTitle: string;
    tableColumns: TableColumn[];
    tableRowsData: TableRow[];
    tableHeaderGrid?: HeaderCell[][] | undefined;
  }) => void;
}

// ── 헬퍼 함수 ──

/** isHidden 속성을 재계산 (O(nm) - 병합 셀 Set 기반) */
function recalculateHiddenCells(tableRows: TableRow[]): TableRow[] {
  const hiddenCoords = new Set<string>();
  for (let r = 0; r < tableRows.length; r++) {
    const tableRow = tableRows[r];
    if (!tableRow) continue;
    const cells = tableRow.cells;
    for (let c = 0; c < cells.length; c++) {
      const currentCell = cells[c];
      if (!currentCell) continue;
      const rowspan = currentCell.rowspan || 1;
      const colspan = currentCell.colspan || 1;
      if (rowspan <= 1 && colspan <= 1) continue;
      for (let dr = 0; dr < rowspan; dr++) {
        for (let dc = 0; dc < colspan; dc++) {
          if (dr === 0 && dc === 0) continue;
          hiddenCoords.add(`${r + dr},${c + dc}`);
        }
      }
    }
  }

  return tableRows.map((row, rIndex) => ({
    ...row,
    cells: row.cells.map((cell, cIndex) => ({
      ...cell,
      isHidden: hiddenCoords.has(`${rIndex},${cIndex}`),
    })),
  }));
}

/** 컬럼 헤더의 isHeaderHidden 재계산 */
function recalculateHiddenHeaders(cols: TableColumn[]): TableColumn[] {
  return cols.map((col, i) => {
    let shouldBeHidden = false;
    for (let j = 0; j < i; j++) {
      const checkCol = cols[j];
      if (!checkCol) continue;
      const colspan = checkCol.colspan || 1;
      if (colspan > 1 && i >= j && i < j + colspan) {
        shouldBeHidden = true;
        break;
      }
    }
    if (shouldBeHidden) {
      return { ...col, isHeaderHidden: true };
    }
    const { isHeaderHidden: _, ...colWithoutHidden } = col;
    return colWithoutHidden;
  });
}

// ── 메인 훅 ──

export function useTableEditor({
  tableTitle = '',
  columns = [],
  rows = [],
  tableHeaderGrid: initialHeaderGrid,
  currentQuestionId = '',
  questionCode,
  questionTitle,
  onTableChange,
}: UseTableEditorParams) {
  // ── 상태 ──

  const [currentTitle, setCurrentTitle] = useState(tableTitle);
  const [currentColumns, setCurrentColumns] = useState<TableColumn[]>(
    columns.length > 0
      ? columns
      : [
          { id: 'col-1', label: '열 1', width: 150 },
          { id: 'col-2', label: '열 2', width: 150 },
        ],
  );
  const [currentRows, setCurrentRows] = useState<TableRow[]>(() => {
    const initialRows: TableRow[] =
      rows.length > 0
        ? rows
        : [
            {
              id: 'row-1',
              label: '행 1',
              height: 60,
              minHeight: 40,
              cells: [
                { id: 'cell-1-1', content: '', type: 'text' as const },
                { id: 'cell-1-2', content: '', type: 'text' as const },
              ],
            },
          ];
    // 초기화 시 모든 셀에 코드 생성 (기존 데이터에 코드가 없는 셀 보완)
    const rowsWithCodes = generateAllCellCodes(
      questionCode,
      questionTitle,
      columns.length > 0 ? columns : [{ id: 'col-1', label: '열 1', width: 150 }, { id: 'col-2', label: '열 2', width: 150 }],
      initialRows,
    );
    return recalculateHiddenCells(rowsWithCodes);
  });

  const [selectedCell, setSelectedCell] = useState<{
    rowId: string;
    cellId: string;
  } | null>(null);

  const [copiedCell, setCopiedCell] = useState<TableCell | null>(null);
  const [copiedCellPosition, setCopiedCellPosition] = useState<{
    rowIndex: number;
    cellIndex: number;
  } | null>(null);

  const tableRef = useRef<HTMLDivElement>(null);

  const [editingColumnWidth, setEditingColumnWidth] = useState<{
    columnIndex: number;
    value: string;
  } | null>(null);

  const [useMultiRowHeader, setUseMultiRowHeader] = useState(!!initialHeaderGrid);
  const [currentHeaderGrid, setCurrentHeaderGrid] = useState<HeaderCell[][] | undefined>(
    initialHeaderGrid,
  );

  // 행 조건부 표시 모달
  const [rowConditionModalOpen, setRowConditionModalOpen] = useState(false);
  const [editingRowIndex, setEditingRowIndex] = useState<number | null>(null);

  // 열 조건부 표시 모달
  const [columnConditionModalOpen, setColumnConditionModalOpen] = useState(false);
  const [editingColumnIndex, setEditingColumnIndex] = useState<number | null>(null);

  // ── Refs (stale closure 방지 + useCallback 안정화) ──

  const currentTitleRef = useRef(currentTitle);
  currentTitleRef.current = currentTitle;

  // dirty flag: label/code debounce 중 render-time ref 덮어쓰기 방지
  const pendingColumnsSyncRef = useRef(false);
  const pendingRowsSyncRef = useRef(false);

  const currentColumnsRef = useRef(currentColumns);
  if (!pendingColumnsSyncRef.current) currentColumnsRef.current = currentColumns;

  const currentRowsRef = useRef(currentRows);
  if (!pendingRowsSyncRef.current) currentRowsRef.current = currentRows;

  // state + ref + dirty flag를 동시에 업데이트하는 래퍼
  const commitRows = useCallback((rows: TableRow[]) => {
    currentRowsRef.current = rows;
    pendingRowsSyncRef.current = false;
    setCurrentRows(rows);
  }, []);
  const commitColumns = useCallback((cols: TableColumn[]) => {
    currentColumnsRef.current = cols;
    pendingColumnsSyncRef.current = false;
    setCurrentColumns(cols);
  }, []);

  const headerGridRef = useRef(currentHeaderGrid);
  headerGridRef.current = currentHeaderGrid;

  // 다단계 헤더 그리드를 열 추가/삭제에 맞춰 재동기화.
  // 다단계 헤더가 꺼져 있으면(undefined) no-op. 켜져 있을 때만 ref+state 갱신.
  const syncHeaderGridForColumnChange = useCallback(
    (change: { type: 'add'; slot: number } | { type: 'delete'; slot: number }) => {
      const grid = headerGridRef.current;
      if (!grid || grid.length === 0) return;
      const nextGrid = reconcileHeaderGridForColumnChange(grid, change);
      headerGridRef.current = nextGrid;
      setCurrentHeaderGrid(nextGrid);
    },
    [],
  );

  const questionCodeRef = useRef(questionCode);
  questionCodeRef.current = questionCode;

  const questionTitleRef = useRef(questionTitle);
  questionTitleRef.current = questionTitle;

  const selectedCellRef = useRef(selectedCell);
  selectedCellRef.current = selectedCell;

  const copiedCellRef = useRef(copiedCell);
  copiedCellRef.current = copiedCell;

  const onTableChangeRef = useRef(onTableChange);
  onTableChangeRef.current = onTableChange;

  // ── 변경 알림 ──

  const notifyChange = useCallback(
    (title: string, cols: TableColumn[], rowsData: TableRow[]) => {
      onTableChangeRef.current({
        tableTitle: title,
        tableColumns: cols,
        tableRowsData: rowsData,
        ...(headerGridRef.current !== undefined ? { tableHeaderGrid: headerGridRef.current } : {}),
      });
    },
    [],
  );

  const pendingChangeRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingArgsRef = useRef<{ title: string; cols: TableColumn[]; rowsData: TableRow[] } | null>(null);

  // 셀 코드 재계산 전용 debounce (updateColumnCode / updateRowCode 용)
  const pendingCellCodeRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // questionCode/questionTitle 변경 시 전체 재계산 debounce
  const pendingQuestionInfoRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const notifyChangeDebounced = useCallback(
    (title: string, cols: TableColumn[], rowsData: TableRow[]) => {
      if (pendingChangeRef.current) clearTimeout(pendingChangeRef.current);
      pendingArgsRef.current = { title, cols, rowsData };
      pendingChangeRef.current = setTimeout(() => {
        // dirty ref → React state 일괄 동기화 (label/code 입력 지연 렌더)
        if (pendingRowsSyncRef.current) {
          pendingRowsSyncRef.current = false;
          setCurrentRows(currentRowsRef.current);
        }
        if (pendingColumnsSyncRef.current) {
          pendingColumnsSyncRef.current = false;
          setCurrentColumns(currentColumnsRef.current);
        }
        onTableChangeRef.current({
          tableTitle: title,
          tableColumns: cols,
          tableRowsData: rowsData,
          ...(headerGridRef.current !== undefined ? { tableHeaderGrid: headerGridRef.current } : {}),
        });
        pendingChangeRef.current = null;
        pendingArgsRef.current = null;
      }, 300);
    },
    [],
  );

  // 언마운트 시 pending change flush (데이터 손실 방지)
  useEffect(() => {
    return () => {
      // 셀 코드 재계산 flush
      if (pendingCellCodeRef.current) {
        clearTimeout(pendingCellCodeRef.current);
        pendingCellCodeRef.current = null;
      }
      // questionCode/questionTitle 재계산 flush
      if (pendingQuestionInfoRef.current) {
        clearTimeout(pendingQuestionInfoRef.current);
        pendingQuestionInfoRef.current = null;
      }
      // dirty flag 클리어
      pendingRowsSyncRef.current = false;
      pendingColumnsSyncRef.current = false;
      // 부모 알림 flush
      if (pendingChangeRef.current) {
        clearTimeout(pendingChangeRef.current);
        if (pendingArgsRef.current) {
          const { title, cols, rowsData } = pendingArgsRef.current;
          onTableChangeRef.current({
            tableTitle: title,
            tableColumns: cols,
            tableRowsData: rowsData,
            ...(headerGridRef.current !== undefined ? { tableHeaderGrid: headerGridRef.current } : {}),
          });
        }
      }
    };
  }, []);

  // ── questionCode/questionTitle 변경 감지 (debounced) ──

  const prevQuestionInfoRef = useRef({ questionCode, questionTitle });
  useEffect(() => {
    const prev = prevQuestionInfoRef.current;
    if (prev.questionCode === questionCode && prev.questionTitle === questionTitle) return;
    prevQuestionInfoRef.current = { questionCode, questionTitle };

    // 300ms debounce: 타이핑 중에는 재계산하지 않고, 멈추면 실행
    if (pendingQuestionInfoRef.current) clearTimeout(pendingQuestionInfoRef.current);
    pendingQuestionInfoRef.current = setTimeout(() => {
      const updatedRows = generateAllCellCodes(
        questionCodeRef.current,
        questionTitleRef.current,
        currentColumnsRef.current,
        currentRowsRef.current,
      );
      commitRows(updatedRows);
      notifyChangeDebounced(
        currentTitleRef.current,
        currentColumnsRef.current,
        updatedRows,
      );
      pendingQuestionInfoRef.current = null;
    }, 300);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [questionCode, questionTitle]);

  // ── 헤더 병합 ──

  const mergeColumnHeaders = useCallback(
    (columnIndex: number) => {
      const cols = [...currentColumnsRef.current];
      const currentCol = cols[columnIndex];
      if (!currentCol) return;
      const currentColspan = currentCol.colspan || 1;
      const nextVisibleIndex = columnIndex + currentColspan;

      if (nextVisibleIndex >= cols.length) return;

      const targetCol = cols[nextVisibleIndex];
      if (!targetCol) return;
      const targetColspan = targetCol.colspan || 1;

      cols[columnIndex] = { ...currentCol, colspan: currentColspan + targetColspan } as TableColumn;
      const { colspan: _, ...targetColWithoutColspan } = targetCol;
      cols[nextVisibleIndex] = targetColWithoutColspan as TableColumn;

      const updatedCols = recalculateHiddenHeaders(cols);
      commitColumns(updatedCols);
      notifyChange(currentTitleRef.current, updatedCols, currentRowsRef.current);
    },
    [notifyChange, commitColumns],
  );

  const unmergeColumnHeader = useCallback(
    (columnIndex: number) => {
      const cols = [...currentColumnsRef.current];
      const col = cols[columnIndex];
      if (!col) return;
      const { colspan: _, ...colWithoutColspan } = col;
      cols[columnIndex] = colWithoutColspan as TableColumn;

      const updatedCols = recalculateHiddenHeaders(cols);
      commitColumns(updatedCols);
      notifyChange(currentTitleRef.current, updatedCols, currentRowsRef.current);
    },
    [notifyChange, commitColumns],
  );

  // ── 제목 ──

  const updateTitle = useCallback(
    (title: string) => {
      setCurrentTitle(title);
      notifyChangeDebounced(title, currentColumnsRef.current, currentRowsRef.current);
    },
    [notifyChangeDebounced],
  );

  // ── 열 너비 ──

  const handleColumnWidthChange = useCallback(
    (columnIndex: number, width: number) => {
      const updatedColumns = currentColumnsRef.current.map((col, index) =>
        index === columnIndex ? { ...col, width: Math.max(0, width) } : col,
      );
      commitColumns(updatedColumns);
      notifyChange(currentTitleRef.current, updatedColumns, currentRowsRef.current);
    },
    [notifyChange, commitColumns],
  );

  // ── 열 코드 변경 ──

  /** 셀 코드 전체 재계산 debounce (열 코드/행 코드 변경 공통) */
  const scheduleCellCodeRecalc = useCallback(() => {
    if (pendingCellCodeRef.current) clearTimeout(pendingCellCodeRef.current);
    pendingCellCodeRef.current = setTimeout(() => {
      const updatedRows = generateAllCellCodes(
        questionCodeRef.current,
        questionTitleRef.current,
        currentColumnsRef.current,
        currentRowsRef.current,
      );
      currentRowsRef.current = updatedRows;
      pendingRowsSyncRef.current = false;
      setCurrentRows(updatedRows);
      notifyChangeDebounced(currentTitleRef.current, currentColumnsRef.current, updatedRows);
      pendingCellCodeRef.current = null;
    }, 300);
  }, [notifyChangeDebounced]);

  const updateColumnCode = useCallback(
    (columnIndex: number, newColumnCode: string) => {
      // 즉시: ref만 업데이트, state는 debounce 후 동기화
      const updatedColumns = currentColumnsRef.current.map((col, idx) =>
        idx === columnIndex ? { ...col, columnCode: newColumnCode } : col,
      );
      currentColumnsRef.current = updatedColumns;
      pendingColumnsSyncRef.current = true;
      notifyChangeDebounced(currentTitleRef.current, updatedColumns, currentRowsRef.current);
      // 지연: 셀 코드 전체 재계산
      scheduleCellCodeRecalc();
    },
    [notifyChangeDebounced, scheduleCellCodeRecalc],
  );

  // ── 열 CRUD ──

  const addColumn = useCallback(() => {
    const columns = currentColumnsRef.current;
    const rows = currentRowsRef.current;

    const newColumn: TableColumn = {
      id: generateId(),
      label: `열 ${columns.length + 1}`,
      columnCode: `c${columns.length + 1}`,
      width: 150,
    };

    const updatedColumns = [...columns, newColumn];
    const newColIndex = columns.length;

    const updatedRows = rows.map((row) => {
      let shouldBeHidden = false;
      for (let col = 0; col < row.cells.length; col++) {
        const cell = row.cells[col];
        if (!cell) continue;
        const colspan = cell.colspan || 1;
        if (col < newColIndex && col + colspan > newColIndex) {
          shouldBeHidden = true;
          break;
        }
      }
      return {
        ...row,
        cells: [
          ...row.cells,
          {
            id: `cell-${row.id}-${newColumn.id}`,
            content: '',
            type: 'text' as const,
            isHidden: shouldBeHidden,
          },
        ],
      };
    });

    commitColumns(updatedColumns);
    commitRows(updatedRows);
    // 다단계 헤더가 켜져 있으면 말단(slot = 기존 열 수)에 헤더 셀 추가하여 폭 정합 유지
    syncHeaderGridForColumnChange({ type: 'add', slot: newColIndex });
    notifyChange(currentTitleRef.current, updatedColumns, updatedRows);
  }, [notifyChange, commitColumns, commitRows, syncHeaderGridForColumnChange]);

  const deleteColumn = useCallback(
    (columnIndex: number) => {
      const columns = currentColumnsRef.current;
      const rows = currentRowsRef.current;

      if (columns.length <= 1) return;

      if (
        !window.confirm(
          '정말 이 열을 삭제하시겠습니까?\n포함된 데이터가 모두 삭제되며, 복구할 수 없습니다.',
        )
      ) {
        return;
      }

      const updatedColumns = columns.filter((_, index) => index !== columnIndex);

      const updatedRows = rows.map((row) => ({
        ...row,
        cells: row.cells
          .map((cell, cIndex) => {
            if (cIndex < columnIndex) {
              const colspan = cell.colspan || 1;
              if (cIndex + colspan > columnIndex) {
                const newColspan = Math.max(1, colspan - 1);
                if (newColspan > 1) {
                  return { ...cell, colspan: newColspan };
                }
                const { colspan: _, ...cellWithoutColspan } = cell;
                return cellWithoutColspan;
              }
            }
            return cell;
          })
          .filter((_, index) => index !== columnIndex),
      }));

      const finalRows = recalculateHiddenCells(updatedRows);
      commitColumns(updatedColumns);
      commitRows(finalRows);
      // 다단계 헤더가 켜져 있으면 삭제된 열(slot=columnIndex)의 헤더 폭을 보정
      syncHeaderGridForColumnChange({ type: 'delete', slot: columnIndex });
      notifyChange(currentTitleRef.current, updatedColumns, finalRows);
    },
    [notifyChange, commitColumns, commitRows, syncHeaderGridForColumnChange],
  );

  const moveColumn = useCallback(
    (columnIndex: number, direction: 'left' | 'right') => {
      const columns = currentColumnsRef.current;
      const rows = currentRowsRef.current;

      if (direction === 'left' && columnIndex === 0) return;
      if (direction === 'right' && columnIndex === columns.length - 1) return;

      const targetIndex = direction === 'left' ? columnIndex - 1 : columnIndex + 1;

      const updatedColumns = [...columns];
      const colA = updatedColumns[columnIndex];
      const colB = updatedColumns[targetIndex];
      if (!colA || !colB) return;
      updatedColumns[columnIndex] = colB;
      updatedColumns[targetIndex] = colA;

      const updatedRows = rows.map((row) => {
        const newCells = [...row.cells];
        const cellA = newCells[columnIndex];
        const cellB = newCells[targetIndex];
        if (!cellA || !cellB) return { ...row, cells: newCells };
        newCells[columnIndex] = cellB;
        newCells[targetIndex] = cellA;
        return { ...row, cells: newCells };
      });

      const finalRows = recalculateHiddenCells(updatedRows);
      commitColumns(updatedColumns);
      commitRows(finalRows);
      notifyChange(currentTitleRef.current, updatedColumns, finalRows);
    },
    [notifyChange, commitColumns, commitRows],
  );

  const moveRow = useCallback(
    (rowIndex: number, targetIndex: number) => {
      const rows = currentRowsRef.current;

      if (targetIndex < 0 || targetIndex >= rows.length || rowIndex === targetIndex) return;

      const updatedRows = [...rows];
      const [removed] = updatedRows.splice(rowIndex, 1);
      if (!removed) return;
      updatedRows.splice(targetIndex, 0, removed);

      const finalRows = recalculateHiddenCells(updatedRows);
      commitRows(finalRows);
      notifyChange(currentTitleRef.current, currentColumnsRef.current, finalRows);
    },
    [notifyChange, commitRows],
  );

  const updateColumnLabel = useCallback(
    (columnIndex: number, label: string) => {
      const updatedColumns = currentColumnsRef.current.map((col, index) =>
        index === columnIndex ? { ...col, label } : col,
      );
      currentColumnsRef.current = updatedColumns;
      pendingColumnsSyncRef.current = true;
      notifyChangeDebounced(currentTitleRef.current, updatedColumns, currentRowsRef.current);
    },
    [notifyChangeDebounced],
  );

  // ── 행 CRUD ──

  const addRow = useCallback(() => {
    const rows = currentRowsRef.current;
    const columns = currentColumnsRef.current;

    const existingNumbers = rows
      .map((row) => {
        const match = row.label.match(/행 (\d+)/);
        return match ? parseInt(match[1] ?? '0', 10) : 0;
      })
      .filter((n) => !isNaN(n));

    const maxNumber = Math.max(0, ...existingNumbers);
    const nextNumber = maxNumber + 1;

    const newRowId = generateId();

    const cells = columns.map((col, colIndex) => {
      let shouldBeHidden = false;

      for (let r = 0; r < rows.length; r++) {
        const rowItem = rows[r];
        if (!rowItem) continue;
        const cell = rowItem.cells[colIndex];
        if (!cell) continue;

        const rowspan = cell.rowspan || 1;
        const colspan = cell.colspan || 1;

        if (r + rowspan > rows.length) {
          const cellColIndex = rowItem.cells.findIndex((c) => c.id === cell.id);
          if (colIndex >= cellColIndex && colIndex < cellColIndex + colspan) {
            shouldBeHidden = true;
            break;
          }
        }
      }

      return {
        id: `cell-${newRowId}-${col.id}`,
        content: '',
        type: 'text' as const,
        isHidden: shouldBeHidden,
      };
    });

    const newRow: TableRow = {
      id: newRowId,
      label: `행 ${nextNumber}`,
      rowCode: `r${rows.length + 1}`,
      height: 60,
      minHeight: 40,
      cells,
    };

    const newRowWithCodes = generateCellCodesForRow(
      questionCodeRef.current,
      questionTitleRef.current,
      columns,
      newRow,
    );

    const updatedRows = [...rows, newRowWithCodes];
    commitRows(updatedRows);
    notifyChange(currentTitleRef.current, columns, updatedRows);
  }, [notifyChange, commitRows]);

  const addBulkRows = useCallback(
    (
      rowDefs: Array<{
        label: string;
        rowCode: string;
        displayCondition?: QuestionConditionGroup;
        dynamicGroupId?: string;
      }>,
    ) => {
      const columns = currentColumnsRef.current;
      const existingRows = currentRowsRef.current;

      const newRows: TableRow[] = rowDefs.map((def) => {
        const newRowId = generateId();
        const cells = columns.map((col) => ({
          id: `cell-${newRowId}-${col.id}`,
          content: '',
          type: 'text' as const,
        }));

        const row: TableRow = {
          id: newRowId,
          label: def.label,
          rowCode: def.rowCode,
          height: 60,
          minHeight: 40,
          cells,
          ...(def.displayCondition !== undefined ? { displayCondition: def.displayCondition } : {}),
          ...(def.dynamicGroupId !== undefined ? { dynamicGroupId: def.dynamicGroupId } : {}),
        };

        return generateCellCodesForRow(
          questionCodeRef.current,
          questionTitleRef.current,
          columns,
          row,
        );
      });

      const updatedRows = [...existingRows, ...newRows];
      const finalRows = recalculateHiddenCells(updatedRows);
      commitRows(finalRows);
      notifyChange(currentTitleRef.current, columns, finalRows);
    },
    [notifyChange, commitRows],
  );

  // ── 열 일괄 생성 ──

  const addBulkColumns = useCallback(
    (
      columnDefs: Array<{
        label: string;
        columnCode: string;
        width?: number;
        displayCondition?: QuestionConditionGroup;
        cellType?: TableCell['type'];
        cellTemplate?: Partial<TableCell>;
      }>,
      insertAfterIndex?: number,
    ) => {
      const columns = currentColumnsRef.current;
      const rows = currentRowsRef.current;

      // 1. 새 열 생성
      const newColumns: TableColumn[] = columnDefs.map((def) => ({
        id: generateId(),
        label: def.label,
        columnCode: def.columnCode,
        width: def.width ?? 150,
        ...(def.displayCondition !== undefined ? { displayCondition: def.displayCondition } : {}),
      }));

      // 2. 삽입 위치 결정
      const insertIdx =
        insertAfterIndex != null ? insertAfterIndex + 1 : columns.length;
      const updatedColumns = [
        ...columns.slice(0, insertIdx),
        ...newColumns,
        ...columns.slice(insertIdx),
      ];

      // 3. 모든 행에 셀 삽입 (같은 위치)
      const updatedRows = rows.map((row) => {
        const newCells: TableCell[] = newColumns.map((col, i) => {
          const def = columnDefs[i];
          const cellType = def?.cellType ?? 'text';
          const cellTemplate = def?.cellTemplate;
          return {
            id: `cell-${row.id}-${col.id}`,
            content: '',
            type: cellType as TableCell['type'],
            ...cellTemplate,
          } as TableCell;
        });
        return {
          ...row,
          cells: [
            ...row.cells.slice(0, insertIdx),
            ...newCells,
            ...row.cells.slice(insertIdx),
          ],
        };
      });

      // 4. cellCode 자동 재생성
      const rowsWithCodes = generateAllCellCodes(
        questionCodeRef.current,
        questionTitleRef.current,
        updatedColumns,
        updatedRows,
      );
      const finalRows = recalculateHiddenCells(rowsWithCodes);

      commitColumns(updatedColumns);
      commitRows(finalRows);
      // 다단계 헤더가 켜져 있으면 삽입 위치부터 새 열 수만큼 헤더 셀 추가.
      // 각 add는 슬롯을 한 칸씩 밀어내므로 insertIdx, insertIdx+1, ... 순서로 누적.
      for (let i = 0; i < newColumns.length; i++) {
        syncHeaderGridForColumnChange({ type: 'add', slot: insertIdx + i });
      }
      notifyChange(currentTitleRef.current, updatedColumns, finalRows);
    },
    [notifyChange, commitColumns, commitRows, syncHeaderGridForColumnChange],
  );

  const duplicateRow = useCallback(
    (rowIndex: number) => {
      const rows = currentRowsRef.current;
      const columns = currentColumnsRef.current;
      const sourceRow = rows[rowIndex];
      if (!sourceRow) return;

      const newRowId = generateId();
      const newRow: TableRow = {
        ...sourceRow,
        id: newRowId,
        label: `${sourceRow.label} (복사)`,
        ...(sourceRow.rowCode ? { rowCode: `${sourceRow.rowCode}_copy` } : {}),
        cells: sourceRow.cells.map((cell, colIndex) => {
          const cloned: TableCell = JSON.parse(JSON.stringify(cell));
          cloned.id = `cell-${newRowId}-${columns[colIndex]?.id ?? colIndex}`;
          delete cloned.rowspan;
          return cloned;
        }),
        ...(sourceRow.displayCondition
          ? { displayCondition: JSON.parse(JSON.stringify(sourceRow.displayCondition)) }
          : {}),
      };

      const newRowWithCodes = generateCellCodesForRow(
        questionCodeRef.current,
        questionTitleRef.current,
        columns,
        newRow,
      );

      const updatedRows = [
        ...rows.slice(0, rowIndex + 1),
        newRowWithCodes,
        ...rows.slice(rowIndex + 1),
      ];
      const finalRows = recalculateHiddenCells(updatedRows);
      commitRows(finalRows);
      notifyChange(currentTitleRef.current, columns, finalRows);
    },
    [notifyChange, commitRows],
  );

  const deleteRow = useCallback(
    (rowIndex: number) => {
      const rows = currentRowsRef.current;

      if (rows.length <= 1) return;

      if (
        !window.confirm(
          '정말 이 행을 삭제하시겠습니까?\n포함된 데이터가 모두 삭제되며, 복구할 수 없습니다.',
        )
      ) {
        return;
      }

      const updatedRows = rows
        .map((row, rIndex) => {
          if (rIndex < rowIndex) {
            return {
              ...row,
              cells: row.cells.map((cell) => {
                const rowspan = cell.rowspan || 1;
                if (rIndex + rowspan > rowIndex) {
                  const newRowspan = Math.max(1, rowspan - 1);
                  if (newRowspan > 1) {
                    return { ...cell, rowspan: newRowspan };
                  }
                  const { rowspan: _, ...cellWithoutRowspan } = cell;
                  return cellWithoutRowspan;
                }
                return cell;
              }),
            };
          }
          return row;
        })
        .filter((_, index) => index !== rowIndex);

      const finalRows = recalculateHiddenCells(updatedRows);
      commitRows(finalRows);
      notifyChange(currentTitleRef.current, currentColumnsRef.current, finalRows);
    },
    [notifyChange, commitRows],
  );

  const updateRowLabel = useCallback(
    (rowIndex: number, label: string) => {
      const updatedRows = currentRowsRef.current.map((row, index) =>
        index === rowIndex ? { ...row, label } : row,
      );
      currentRowsRef.current = updatedRows;
      pendingRowsSyncRef.current = true;
      notifyChangeDebounced(currentTitleRef.current, currentColumnsRef.current, updatedRows);
    },
    [notifyChangeDebounced],
  );

  const updateRowCode = useCallback(
    (rowIndex: number, rowCode: string) => {
      // 즉시: ref만 업데이트, state는 debounce 후 동기화
      const updatedRows = currentRowsRef.current.map((row, index) =>
        index === rowIndex ? { ...row, rowCode } : row,
      );
      currentRowsRef.current = updatedRows;
      pendingRowsSyncRef.current = true;
      notifyChangeDebounced(currentTitleRef.current, currentColumnsRef.current, updatedRows);
      // 지연: 셀 코드 전체 재계산
      scheduleCellCodeRecalc();
    },
    [notifyChangeDebounced, scheduleCellCodeRecalc],
  );

  // ── 행 조건부 표시 ──

  const openRowConditionModal = useCallback((rowIndex: number) => {
    setEditingRowIndex(rowIndex);
    setRowConditionModalOpen(true);
  }, []);

  const updateRowCondition = useCallback(
    (rowIndex: number, conditionGroup: QuestionConditionGroup | undefined) => {
      const updatedRows = currentRowsRef.current.map((row, index) => {
        if (index !== rowIndex) return row;
        if (conditionGroup !== undefined) {
          return { ...row, displayCondition: conditionGroup };
        }
        const { displayCondition: _, ...rowWithoutCondition } = row;
        return rowWithoutCondition;
      });
      commitRows(updatedRows);
      notifyChange(currentTitleRef.current, currentColumnsRef.current, updatedRows);
    },
    [notifyChange, commitRows],
  );

  // ── 동적 행 설정 ──

  const setDynamicGroupId = useCallback(
    (rowId: string, groupId: string | undefined) => {
      const updatedRows = currentRowsRef.current.map((row) => {
        if (row.id !== rowId) return row;
        const { showWhenDynamicGroupId: _, ...rowWithoutShow } = row;
        if (groupId !== undefined) {
          return { ...rowWithoutShow, dynamicGroupId: groupId };
        }
        const { dynamicGroupId: __, ...rowWithoutBoth } = rowWithoutShow;
        return rowWithoutBoth;
      });
      commitRows(updatedRows);
      notifyChange(currentTitleRef.current, currentColumnsRef.current, updatedRows);
    },
    [notifyChange, commitRows],
  );

  const setShowWhenDynamicGroupId = useCallback(
    (rowId: string, groupId: string | undefined) => {
      const updatedRows = currentRowsRef.current.map((row) => {
        if (row.id !== rowId) return row;
        const { dynamicGroupId: _, ...rowWithoutDynamic } = row;
        if (groupId !== undefined) {
          return { ...rowWithoutDynamic, showWhenDynamicGroupId: groupId };
        }
        const { showWhenDynamicGroupId: __, ...rowWithoutBoth } = rowWithoutDynamic;
        return rowWithoutBoth;
      });
      commitRows(updatedRows);
      notifyChange(currentTitleRef.current, currentColumnsRef.current, updatedRows);
    },
    [notifyChange, commitRows],
  );

  // ── 열 조건부 표시 ──

  const openColumnConditionModal = useCallback((columnIndex: number) => {
    setEditingColumnIndex(columnIndex);
    setColumnConditionModalOpen(true);
  }, []);

  const updateColumnCondition = useCallback(
    (columnIndex: number, conditionGroup: QuestionConditionGroup | undefined) => {
      const updatedColumns = currentColumnsRef.current.map((col, index) => {
        if (index !== columnIndex) return col;
        if (conditionGroup !== undefined) {
          return { ...col, displayCondition: conditionGroup };
        }
        const { displayCondition: _, ...colWithoutCondition } = col;
        return colWithoutCondition;
      });
      commitColumns(updatedColumns);
      notifyChange(currentTitleRef.current, updatedColumns, currentRowsRef.current);
    },
    [notifyChange, commitColumns],
  );

  const currentQuestionAsQuestion: Question = useMemo(
    () => ({
      id: currentQuestionId,
      type: 'table' as const,
      title: currentTitle,
      order: 0,
      required: false,
      tableColumns: currentColumns,
      tableRowsData: currentRows,
    }),
    [currentQuestionId, currentTitle, currentColumns, currentRows],
  );

  // ── 드래그 복사 ──

  const dragCopy = useDragCopy({
    currentRowsRef,
    currentColumnsRef,
    questionCodeRef,
    setCurrentRows: commitRows,
    notifyChange,
    currentTitleRef,
    recalculateHiddenCells,
    clearCopiedCell: () => {
      setCopiedCell(null);
      setCopiedCellPosition(null);
    },
  });
  const {
    clearCopiedRegion,
    copiedRegion,
    dragCopyState,
    pasteRegion,
  } = dragCopy;

  // ── 셀 복사/붙여넣기 ──

  const copyCell = useCallback(
    (rowIndex: number, cellIndex: number) => {
      const cell = currentRowsRef.current[rowIndex]?.cells[cellIndex];
      if (!cell) return;
      const cellToCopy: TableCell = { ...cell, id: '' };
      setCopiedCell(cellToCopy);
      setCopiedCellPosition({ rowIndex, cellIndex });
      clearCopiedRegion(); // 상호 배타
    },
    [clearCopiedRegion],
  );

  const pasteCell = useCallback(
    (rowIndex: number, cellIndex: number) => {
      // 영역 복사가 있으면 영역 붙여넣기 우선
      if (copiedRegion) {
        const result = pasteRegion(rowIndex, cellIndex);
        if ('blocked' in result) {
          toast.error(result.message);
        }
        return;
      }

      const copied = copiedCellRef.current;
      if (!copied) return;

      const rows = currentRowsRef.current;
      const columns = currentColumnsRef.current;
      const targetCell = rows[rowIndex]?.cells[cellIndex];
      if (!targetCell) return;

      const targetRow = rows[rowIndex];
      const targetColumn = columns[cellIndex];
      // 기타 ranking_opt 셀 중복 방지: 같은 테이블에 이미 기타 셀이 있으면 복사본의 플래그 해제.
      let sanitizedCopy = copied;
      if (
        copied.type === 'ranking_opt'
        && copied.isOtherRankingCell === true
        && hasExistingOtherRankingCell(rows, targetCell.id)
      ) {
        const { isOtherRankingCell: _, ...copiedWithoutOther } = copied;
        sanitizedCopy = copiedWithoutOther;
      }
      const pastedCell: TableCell = regenerateCellCodeForPaste(
        { ...sanitizedCopy, id: targetCell.id },
        questionCodeRef.current,
        questionTitleRef.current,
        targetRow?.rowCode,
        targetRow?.label,
        targetColumn?.columnCode,
        targetColumn?.label,
      );

      let updatedRows = rows.map((row, rIndex) =>
        rIndex === rowIndex
          ? { ...row, cells: row.cells.map((c, cIndex) => (cIndex === cellIndex ? pastedCell : c)) }
          : row,
      );

      const rowspan = pastedCell.rowspan || 1;
      const colspan = pastedCell.colspan || 1;

      if (rowspan > 1 || colspan > 1) {
        updatedRows = updatedRows.map((row, rIndex) => ({
          ...row,
          cells: row.cells.map((c, cIndex) => {
            const isInRowRange = rIndex >= rowIndex && rIndex < rowIndex + rowspan;
            const isInColRange = cIndex >= cellIndex && cIndex < cellIndex + colspan;
            if (isInRowRange && isInColRange && !(rIndex === rowIndex && cIndex === cellIndex)) {
              const { rowspan: _rs, colspan: _cs, ...pastedWithoutSpan } = pastedCell;
              return { ...pastedWithoutSpan, id: c.id };
            }
            return c;
          }),
        }));
      }

      const finalRows = recalculateHiddenCells(updatedRows);
      commitRows(finalRows);
      notifyChange(currentTitleRef.current, columns, finalRows);
    },
    [commitRows, copiedRegion, notifyChange, pasteRegion],
  );

  // ── 셀 삭제/업데이트 ──

  const updateCell = useCallback(
    (rowIndex: number, cellIndex: number, cell: TableCell) => {
      const rows = currentRowsRef.current;
      let updatedRows = rows.map((row, rIndex) =>
        rIndex === rowIndex
          ? { ...row, cells: row.cells.map((c, cIndex) => (cIndex === cellIndex ? cell : c)) }
          : row,
      );

      const rowspan = cell.rowspan || 1;
      const colspan = cell.colspan || 1;

      if (rowspan > 1 || colspan > 1) {
        updatedRows = updatedRows.map((row, rIndex) => ({
          ...row,
          cells: row.cells.map((c, cIndex) => {
            const isInRowRange = rIndex >= rowIndex && rIndex < rowIndex + rowspan;
            const isInColRange = cIndex >= cellIndex && cIndex < cellIndex + colspan;
            if (isInRowRange && isInColRange && !(rIndex === rowIndex && cIndex === cellIndex)) {
              const { rowspan: _rs, colspan: _cs, ...cellWithoutSpan } = cell;
              return { ...cellWithoutSpan, id: c.id };
            }
            return c;
          }),
        }));
      }

      const finalRows = recalculateHiddenCells(updatedRows);
      commitRows(finalRows);
      notifyChange(currentTitleRef.current, currentColumnsRef.current, finalRows);
      setSelectedCell(null);
    },
    [notifyChange, commitRows],
  );

  const deleteCell = useCallback(
    (rowIndex: number, cellIndex: number) => {
      const cell = currentRowsRef.current[rowIndex]?.cells[cellIndex];
      if (!cell) return;

      const emptyCell: TableCell = {
        id: cell.id,
        content: '',
        type: 'text',
        ...(cell.rowspan !== undefined ? { rowspan: cell.rowspan } : {}),
        ...(cell.colspan !== undefined ? { colspan: cell.colspan } : {}),
        ...(cell.horizontalAlign !== undefined ? { horizontalAlign: cell.horizontalAlign } : {}),
        ...(cell.verticalAlign !== undefined ? { verticalAlign: cell.verticalAlign } : {}),
      };

      updateCell(rowIndex, cellIndex, emptyCell);
    },
    [updateCell],
  );

  // ── 셀 병합/해제 ──

  const canMerge = useCallback(
    (direction: 'up' | 'down' | 'left' | 'right'): boolean => {
      const selected = selectedCellRef.current;
      if (!selected) return false;

      const rows = currentRowsRef.current;
      const rowIndex = rows.findIndex((row) => row.id === selected.rowId);
      const cellIndex = rows[rowIndex]?.cells.findIndex(
        (cell) => cell.id === selected.cellId,
      ) ?? -1;
      if (rowIndex === -1 || cellIndex === -1) return false;

      return checkCanMerge(direction, rowIndex, cellIndex, rows, currentColumnsRef.current);
    },
    [],
  );

  const handleMerge = useCallback(
    (direction: 'up' | 'down' | 'left' | 'right') => {
      const selected = selectedCellRef.current;
      if (!selected) return;

      const rows = currentRowsRef.current;
      const columns = currentColumnsRef.current;

      const rowIndex = rows.findIndex((row) => row.id === selected.rowId);
      const cellIndex = rows[rowIndex]?.cells.findIndex(
        (cell) => cell.id === selected.cellId,
      ) ?? -1;
      if (rowIndex === -1 || cellIndex === -1) return;

      if (!checkCanMerge(direction, rowIndex, cellIndex, rows, columns)) return;

      if (
        !window.confirm(
          '병합되는 셀의 내용은 삭제됩니다. 계속하시겠습니까?\n(기준 셀의 내용만 유지됩니다)',
        )
      ) {
        return;
      }

      const { updatedRows, newSelectedCell } = executeMerge(direction, rowIndex, cellIndex, rows);

      if (newSelectedCell) {
        setSelectedCell(newSelectedCell);
      }

      const finalRows = recalculateHiddenCells(updatedRows);
      commitRows(finalRows);
      notifyChange(currentTitleRef.current, columns, finalRows);
    },
    [notifyChange, commitRows],
  );

  const handleUnmerge = useCallback(() => {
    const selected = selectedCellRef.current;
    if (!selected) return;

    const rows = currentRowsRef.current;
    const rowIndex = rows.findIndex((row) => row.id === selected.rowId);
    const cellIndex = rows[rowIndex]?.cells.findIndex(
      (cell) => cell.id === selected.cellId,
    ) ?? -1;

    if (rowIndex === -1 || cellIndex === -1) return;

    const newRows = executeUnmerge(rowIndex, cellIndex, rows);
    if (newRows === rows) return;

    const finalRows = recalculateHiddenCells(newRows);
    commitRows(finalRows);
    notifyChange(currentTitleRef.current, currentColumnsRef.current, finalRows);
  }, [notifyChange, commitRows]);

  // ── 셀 선택 (안정된 콜백) ──

  const handleSelectCell = useCallback(
    (rowId: string, cellId: string) => {
      // 드래그 복사 중에는 셀 선택(모달 열림) 방지
      if (dragCopyState?.isDragging) return;
      setSelectedCell({ rowId, cellId });
    },
    [dragCopyState?.isDragging],
  );

  // ── 다단계 헤더 토글 ──

  const toggleMultiRowHeader = useCallback(
    (enabled: boolean) => {
      setUseMultiRowHeader(enabled);
      if (enabled && !headerGridRef.current) {
        const defaultGrid = buildDefaultHeaderGrid(currentColumnsRef.current);
        setCurrentHeaderGrid(defaultGrid);
        onTableChangeRef.current({
          tableTitle: currentTitleRef.current,
          tableColumns: currentColumnsRef.current,
          tableRowsData: currentRowsRef.current,
          tableHeaderGrid: defaultGrid,
        });
      } else if (!enabled) {
        setCurrentHeaderGrid(undefined);
        onTableChangeRef.current({
          tableTitle: currentTitleRef.current,
          tableColumns: currentColumnsRef.current,
          tableRowsData: currentRowsRef.current,
        });
      }
    },
    [],
  );

  const updateHeaderGrid = useCallback(
    (newGrid: HeaderCell[][]) => {
      setCurrentHeaderGrid(newGrid);
      onTableChangeRef.current({
        tableTitle: currentTitleRef.current,
        tableColumns: currentColumnsRef.current,
        tableRowsData: currentRowsRef.current,
        tableHeaderGrid: newGrid,
      });
    },
    [],
  );

  // ── columnWidths (EditorTableRow에 안정적 참조 전달용) ──

  const columnWidths = useMemo(
    () => currentColumns.map((col) => col.width || 150),
    // 라벨/코드 변경 시 재생성 방지: 너비만 추적
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [currentColumns.map((col) => col.width).join(',')],
  );

  // ── selectedCellContext (CellContentModal용 useMemo) ──

  const selectedCellContext = useMemo(() => {
    if (!selectedCell) return null;

    const rowIndex = currentRows.findIndex((row) => row.id === selectedCell.rowId);
    const selectedRow = rowIndex >= 0 ? currentRows[rowIndex] : undefined;
    const cellIndex = selectedRow?.cells.findIndex((c) => c.id === selectedCell.cellId) ?? -1;
    const selectedColumn = cellIndex >= 0 ? currentColumns[cellIndex] : undefined;
    const cell = cellIndex >= 0 ? selectedRow?.cells[cellIndex] : undefined;

    return {
      rowIndex,
      cellIndex,
      rowCode: selectedRow?.rowCode,
      rowLabel: selectedRow?.label,
      columnCode: selectedColumn?.columnCode,
      columnLabel: selectedColumn?.label,
      cell: cell || { id: '', content: '', type: 'text' as const },
    };
  }, [selectedCell, currentRows, currentColumns]);

  // ── 반환 ──

  return {
    // 상태
    state: {
      currentTitle,
      currentColumns,
      currentRows,
      currentRowsRef,
      selectedCell,
      copiedCell,
      copiedCellPosition,
      copiedRegion: dragCopy.copiedRegion,
      editingColumnWidth,
      columnWidths,
      useMultiRowHeader,
      currentHeaderGrid,
      rowConditionModalOpen,
      editingRowIndex,
      columnConditionModalOpen,
      editingColumnIndex,
      tableRef,
      selectedCellContext,
      currentQuestionAsQuestion,
      currentQuestionId,
      questionCode,
      questionTitle,
    },
    // 액션
    actions: {
      // 제목
      updateTitle,
      // 열
      addColumn,
      deleteColumn,
      moveColumn,
      moveRow,
      updateColumnLabel,
      updateColumnCode,
      handleColumnWidthChange,
      setEditingColumnWidth,
      mergeColumnHeaders,
      unmergeColumnHeader,
      addBulkColumns,
      // 행
      addRow,
      addBulkRows,
      duplicateRow,
      deleteRow,
      updateRowLabel,
      updateRowCode,
      // 셀
      handleSelectCell,
      setSelectedCell,
      updateCell,
      deleteCell,
      copyCell,
      pasteCell,
      // 병합
      canMerge,
      handleMerge,
      handleUnmerge,
      // 행 조건부 표시
      openRowConditionModal,
      updateRowCondition,
      setRowConditionModalOpen,
      // 동적 행 설정
      setDynamicGroupId,
      setShowWhenDynamicGroupId,
      // 열 조건부 표시
      openColumnConditionModal,
      updateColumnCondition,
      setColumnConditionModalOpen,
      // 다단계 헤더
      toggleMultiRowHeader,
      updateHeaderGrid,
      // 드래그 복사
      ...dragCopy,
    },
  };
}
