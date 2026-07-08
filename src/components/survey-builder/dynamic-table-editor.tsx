'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { Clipboard, Eye, ListChecks, Plus, Undo2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { generateId } from '@/lib/utils';
import { useSurveyBuilderStore } from '@/stores/survey-store';
import { useSurveyUIStore } from '@/stores/ui-store';
import { ChoiceGroup, DynamicRowGroupConfig, HeaderCell, QuestionConditionGroup, TableCell, TableColumn, TableRow } from '@/types/survey';
import { pruneChoiceGroups } from '@/utils/choice-group-helpers';

import { BulkGeneratorModal, BulkColumnDef } from './bulk-generator';
import { CellContentModal } from './cell-content-modal';
import { ConditionModal } from './condition-modal';
import { EditorTableRow } from './editor-table-row';
import { HeaderGridEditor } from './header-grid-editor';
import { useTableEditor } from './hooks/use-table-editor';
import { LoadCellModal } from './load-cell-modal';
import { SaveCellModal } from './save-cell-modal';
import { TableHeaderSection } from './table-header-section';
import { TableSummaryCard } from './table-summary-card';

const EMPTY_DYNAMIC_ROW_CONFIGS: DynamicRowGroupConfig[] = [];

// ── Props ──

interface DynamicTableEditorProps {
  tableTitle?: string | undefined;
  columns?: TableColumn[] | undefined;
  rows?: TableRow[] | undefined;
  tableHeaderGrid?: HeaderCell[][] | undefined;
  currentQuestionId?: string | undefined;
  questionCode?: string | undefined;
  questionTitle?: string | undefined;
  dynamicRowConfigs?: DynamicRowGroupConfig[] | undefined;
  onTableChange: (data: {
    tableTitle: string;
    tableColumns: TableColumn[];
    tableRowsData: TableRow[];
    tableHeaderGrid?: HeaderCell[][] | undefined;
  }) => void;
  onDynamicRowConfigsChange?: (configs: DynamicRowGroupConfig[] | undefined) => void;
}

// ── 컴포넌트 ──

export function DynamicTableEditor(props: DynamicTableEditorProps) {
  const { dynamicRowConfigs: rawConfigs, onDynamicRowConfigsChange } = props;
  // 기존 단일 객체 → 배열 마이그레이션 호환
  const dynamicRowConfigs = Array.isArray(rawConfigs) ? rawConfigs : EMPTY_DYNAMIC_ROW_CONFIGS;
  const hasQuestions = useSurveyBuilderStore((s) => s.currentSurvey.questions.length > 0);
  const editingQuestionId = useSurveyUIStore((s) => s.editingQuestionId);
  const hideColumnLabels = useSurveyBuilderStore(
    (s) => s.currentSurvey.questions.find((q) => q.id === editingQuestionId)?.hideColumnLabels ?? false,
  );
  const silentUpdateQuestion = useSurveyBuilderStore((s) => s.silentUpdateQuestion);
  const { state, actions } = useTableEditor(props);

  const {
    currentTitle,
    currentColumns,
    currentRows,
    currentRowsRef,
    selectedCell,
    copiedCell,
    copiedCellPosition,
    copiedRegion,
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
  } = state;

  const {
    updateTitle,
    addColumn,
    deleteColumn,
    moveColumn,
    updateColumnLabel,
    updateColumnCode,
    handleColumnWidthChange,
    setEditingColumnWidth,
    mergeColumnHeaders,
    unmergeColumnHeader,
    addBulkColumns,
    addRow,
    addBulkRows,
    moveRow,
    duplicateRow,
    deleteRow,
    updateRowLabel,
    updateRowCode,
    handleSelectCell,
    setSelectedCell,
    updateCell,
    deleteCell,
    copyCell,
    pasteCell,
    canMerge,
    handleMerge,
    handleUnmerge,
    openRowConditionModal,
    updateRowCondition,
    setRowConditionModalOpen,
    setDynamicGroupId,
    setShowWhenDynamicGroupId,
    openColumnConditionModal,
    updateColumnCondition,
    setColumnConditionModalOpen,
    toggleMultiRowHeader,
    updateHeaderGrid,
    // 드래그 복사
    dragCopyState,
    undoInfo,
    startDragCopy,
    updateDragCopyRange,
    storeSelectedRegion,
    cancelDragCopy,
    undoPaste,
    clearCopiedRegion,
  } = actions;

  // ── 동적 행 감지 ──
  const nonDynamicRows = currentRows.filter((r) => !r.dynamicGroupId && !r.showWhenDynamicGroupId);

  // ── 행 일괄 생성 상태 ──
  const [bulkRowModalOpen, setBulkRowModalOpen] = useState(false);
  const [bulkRowToast, setBulkRowToast] = useState<{ count: number; visible: boolean } | null>(null);
  const bulkRowToastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleBulkGenerate = useCallback(
    (rows: Parameters<typeof addBulkRows>[0]) => {
      addBulkRows(rows);
      setBulkRowToast({ count: rows.length, visible: true });
      if (bulkRowToastTimer.current) clearTimeout(bulkRowToastTimer.current);
      bulkRowToastTimer.current = setTimeout(() => setBulkRowToast(null), 2500);
    },
    [addBulkRows],
  );

  // ── 열 일괄 생성 상태 ──
  const [bulkColumnModalOpen, setBulkColumnModalOpen] = useState(false);
  const [bulkColumnToast, setBulkColumnToast] = useState<{ count: number; visible: boolean } | null>(null);
  const bulkColumnToastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleBulkColumnGenerate = useCallback(
    (columnDefs: BulkColumnDef[]) => {
      addBulkColumns(columnDefs);
      setBulkColumnToast({ count: columnDefs.length, visible: true });
      if (bulkColumnToastTimer.current) clearTimeout(bulkColumnToastTimer.current);
      bulkColumnToastTimer.current = setTimeout(() => setBulkColumnToast(null), 2500);
    },
    [addBulkColumns],
  );

  // ── 그룹 조건 모달 상태 ──
  const [editingGroupCondition, setEditingGroupCondition] = useState<DynamicRowGroupConfig | null>(null);
  const currentQuestion = useSurveyBuilderStore(
    (s) => s.currentSurvey.questions.find((q) => q.id === editingQuestionId),
  );

  const handleUpdateGroupCondition = useCallback(
    (groupId: string, condition: QuestionConditionGroup | undefined) => {
      const updated = dynamicRowConfigs.map((g) => {
        if (g.groupId !== groupId) return g;
        const { displayCondition: _dc, ...rest } = g;
        return condition !== undefined ? { ...rest, displayCondition: condition } : rest;
      });
      onDynamicRowConfigsChange?.(updated);
    },
    [dynamicRowConfigs, onDynamicRowConfigsChange],
  );

  // ── 셀 보관함 상태 ──
  const [saveCellTarget, setSaveCellTarget] = useState<{
    rowIndex: number;
    cellIndex: number;
    cell: TableCell;
  } | null>(null);
  const [loadCellTarget, setLoadCellTarget] = useState<{
    rowIndex: number;
    cellIndex: number;
    targetCell: TableCell;
  } | null>(null);

  const handleSaveCell = useCallback(
    (rowIndex: number, cellIndex: number) => {
      const cell = currentRowsRef.current[rowIndex]?.cells[cellIndex];
      if (!cell) return;
      setSaveCellTarget({ rowIndex, cellIndex, cell });
    },
    [currentRowsRef, setSaveCellTarget],
  );

  const handleLoadCell = useCallback(
    (rowIndex: number, cellIndex: number) => {
      const cell = currentRowsRef.current[rowIndex]?.cells[cellIndex];
      if (!cell) return;
      setLoadCellTarget({ rowIndex, cellIndex, targetCell: cell });
    },
    [currentRowsRef, setLoadCellTarget],
  );

  const handleCellApplied = useCallback(
    (restoredCell: TableCell) => {
      if (!loadCellTarget) return;
      updateCell(loadCellTarget.rowIndex, loadCellTarget.cellIndex, restoredCell);
      setLoadCellTarget(null);
    },
    [loadCellTarget, setLoadCellTarget, updateCell],
  );

  // ── 드래그 복사: 토스트 상태 ──

  const [dragCopyToast, setDragCopyToast] = useState<{
    count: number;
    visible: boolean;
  } | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showDragCopyToast = useCallback((count: number) => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setDragCopyToast({ count, visible: true });
    toastTimerRef.current = setTimeout(() => {
      setDragCopyToast(null);
    }, 4000);
  }, []);

  const handleUndoPaste = useCallback(() => {
    undoPaste();
    setDragCopyToast(null);
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
  }, [undoPaste]);

  // 토스트 타이머 언마운트 시 정리
  useEffect(() => {
    return () => {
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
      if (bulkRowToastTimer.current) clearTimeout(bulkRowToastTimer.current);
      if (bulkColumnToastTimer.current) clearTimeout(bulkColumnToastTimer.current);
    };
  }, []);

  // ── 드래그 복사: 행별 대상 셀 매핑 ──

  const dragCopyTargetsByRow = useMemo(() => {
    if (!dragCopyState) return null;
    const map = new Map<number, string>();
    for (const t of dragCopyState.selectedCells) {
      const existing = map.get(t.rowIndex);
      map.set(t.rowIndex, existing ? `${existing},${t.cellIndex}` : `${t.cellIndex}`);
    }
    return map;
  }, [dragCopyState]);

  // ── 드래그 복사: document 이벤트 리스너 ──

  const tableContainerRef = useRef<HTMLDivElement>(null);
  const scrollAnimRef = useRef<number | null>(null);
  const scrollSpeedRef = useRef({ x: 0, y: 0 });

  useEffect(() => {
    if (!dragCopyState?.isDragging) {
      if (scrollAnimRef.current) {
        cancelAnimationFrame(scrollAnimRef.current);
        scrollAnimRef.current = null;
      }
      scrollSpeedRef.current = { x: 0, y: 0 };
      return;
    }

    // rAF 기반 스크롤 루프 (ref에서 속도를 읽어 항상 최신 값 사용)
    const doScroll = () => {
      const { x, y } = scrollSpeedRef.current;
      if (x !== 0 || y !== 0) {
        tableContainerRef.current?.scrollBy(x, y);
      }
      scrollAnimRef.current = requestAnimationFrame(doScroll);
    };

    const handleMouseMove = (e: MouseEvent) => {
      const el = document.elementFromPoint(e.clientX, e.clientY);
      const td = el?.closest('[data-row-index]') as HTMLElement | null;
      if (td) {
        const rowIndex = parseInt(td.getAttribute('data-row-index')!, 10);
        const cellIndex = parseInt(td.getAttribute('data-cell-index')!, 10);
        if (!isNaN(rowIndex) && !isNaN(cellIndex)) {
          updateDragCopyRange(rowIndex, cellIndex);
        }
      }

      // 자동 스크롤 속도 계산 (ref 업데이트 — rAF 루프가 최신 속도 사용)
      const container = tableContainerRef.current;
      if (!container) return;
      const rect = container.getBoundingClientRect();
      const EDGE = 40;
      const MAX_SPEED = 8;
      let scrollX = 0;
      let scrollY = 0;

      if (e.clientY < rect.top + EDGE) {
        scrollY = -MAX_SPEED * (1 - (e.clientY - rect.top) / EDGE);
      } else if (e.clientY > rect.bottom - EDGE) {
        scrollY = MAX_SPEED * (1 - (rect.bottom - e.clientY) / EDGE);
      }
      if (e.clientX < rect.left + EDGE) {
        scrollX = -MAX_SPEED * (1 - (e.clientX - rect.left) / EDGE);
      } else if (e.clientX > rect.right - EDGE) {
        scrollX = MAX_SPEED * (1 - (rect.right - e.clientX) / EDGE);
      }

      scrollSpeedRef.current = { x: scrollX, y: scrollY };
    };

    const stopScroll = () => {
      if (scrollAnimRef.current) {
        cancelAnimationFrame(scrollAnimRef.current);
        scrollAnimRef.current = null;
      }
      scrollSpeedRef.current = { x: 0, y: 0 };
    };

    const handleMouseUp = () => {
      stopScroll();
      const result = storeSelectedRegion();
      if (result) showDragCopyToast(result.width * result.height);
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        stopScroll();
        cancelDragCopy();
      }
    };

    // 스크롤 루프 시작
    scrollAnimRef.current = requestAnimationFrame(doScroll);

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.removeEventListener('keydown', handleKeyDown);
      stopScroll();
    };
  }, [dragCopyState?.isDragging, updateDragCopyRange, storeSelectedRegion, cancelDragCopy, showDragCopyToast]);

  return (
    <div className="space-y-6">
      {/* 테이블 제목 */}
      <div className="space-y-2">
        <Label htmlFor="table-title">테이블 제목</Label>
        <Input
          id="table-title"
          value={currentTitle}
          onChange={(e) => updateTitle(e.target.value)}
          placeholder="테이블 제목을 입력하세요"
        />
      </div>

      {/* 다단계 헤더 설정 */}
      <div className="space-y-3 rounded-lg border border-gray-200 p-4">
        <div className="flex items-center justify-between">
          <div>
            <Label className="text-sm font-medium">다단계 헤더</Label>
            <p className="text-xs text-gray-500">
              여러 행으로 구성된 계층적 헤더 (종사자 수 → 사무직/생산직 → 남/여 등)
            </p>
          </div>
          <label className="relative inline-flex cursor-pointer items-center">
            <input
              type="checkbox"
              checked={useMultiRowHeader}
              onChange={(e) => toggleMultiRowHeader(e.target.checked)}
              className="peer sr-only"
            />
            <div className="peer h-5 w-9 rounded-full bg-gray-200 after:absolute after:left-[2px] after:top-[2px] after:h-4 after:w-4 after:rounded-full after:border after:border-gray-300 after:bg-white after:transition-all after:content-[''] peer-checked:bg-blue-600 peer-checked:after:translate-x-full peer-checked:after:border-white peer-focus:outline-none" />
          </label>
        </div>

        {useMultiRowHeader && currentHeaderGrid && (
          <HeaderGridEditor
            headerGrid={currentHeaderGrid}
            columnCount={currentColumns.length}
            onChange={updateHeaderGrid}
          />
        )}
      </div>

      {/* 열 라벨 숨기기 설정 */}
      <div className="space-y-3 rounded-lg border border-gray-200 p-4">
        <div className="flex items-center justify-between">
          <div>
            <Label className="text-sm font-medium">열 라벨 숨기기</Label>
            <p className="text-xs text-gray-500">
              응답자가 직접 열 항목을 기입하는 테이블에 사용합니다. 열 헤더를 숨기고 데이터만 표시합니다.
            </p>
          </div>
          <label className="relative inline-flex cursor-pointer items-center">
            <input
              type="checkbox"
              checked={hideColumnLabels}
              onChange={(e) => {
                if (editingQuestionId) {
                  silentUpdateQuestion(editingQuestionId, { hideColumnLabels: e.target.checked });
                }
              }}
              className="peer sr-only"
            />
            <div className="peer h-5 w-9 rounded-full bg-gray-200 after:absolute after:left-[2px] after:top-[2px] after:h-4 after:w-4 after:rounded-full after:border after:border-gray-300 after:bg-white after:transition-all after:content-[''] peer-checked:bg-blue-600 peer-checked:after:translate-x-full peer-checked:after:border-white peer-focus:outline-none" />
          </label>
        </div>
      </div>

      {/* 테이블 정보 요약 */}
      <TableSummaryCard rows={currentRows} columns={currentColumns} />

      {/* 테이블 편집 영역 */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <span>테이블 구조 편집</span>
            <div className="flex gap-2">
              {copiedRegion && (
                <div className="flex items-center gap-2 rounded-md border border-purple-200 bg-purple-50 px-3 py-1 text-sm text-purple-700">
                  <Clipboard className="h-4 w-4" />
                  <span>
                    영역 복사됨 ({copiedRegion.height}행 × {copiedRegion.width}열)
                  </span>
                  <button
                    onClick={clearCopiedRegion}
                    className="ml-1 text-purple-500 hover:text-purple-700"
                    title="복사 취소"
                  >
                    ✕
                  </button>
                </div>
              )}
              {copiedCell && !copiedRegion && (
                <div className="flex items-center gap-2 rounded-md border border-blue-200 bg-blue-50 px-3 py-1 text-sm text-blue-700">
                  <Clipboard className="h-4 w-4" />
                  <span>
                    셀 복사됨 (
                    {copiedCellPosition
                      ? `${copiedCellPosition.rowIndex + 1}, ${copiedCellPosition.cellIndex + 1}`
                      : ''}
                    )
                  </span>
                </div>
              )}
              <Button onClick={addColumn} size="sm" variant="outline">
                <Plus className="mr-1 h-4 w-4" />열 추가
              </Button>
              <Button onClick={() => setBulkColumnModalOpen(true)} size="sm" variant="outline">
                <Plus className="mr-1 h-4 w-4" />열 일괄 생성
              </Button>
              <Button onClick={addRow} size="sm" variant="outline">
                <Plus className="mr-1 h-4 w-4" />행 추가
              </Button>
              <Button onClick={() => setBulkRowModalOpen(true)} size="sm" variant="outline">
                <Plus className="mr-1 h-4 w-4" />행 일괄 생성
              </Button>
            </div>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div
            ref={tableContainerRef}
            className="overflow-x-auto"
            style={dragCopyState?.isDragging ? { cursor: 'crosshair', userSelect: 'none' } : undefined}
          >
            <div
              ref={tableRef}
              role="grid"
              className="mx-auto overflow-hidden rounded-md border-t border-l border-r border-gray-300 bg-white"
              style={{
                display: 'grid',
                gridTemplateColumns: `120px ${currentColumns.map((col) => `${col.width || 150}px`).join(' ')}`,
                width: `${120 + currentColumns.reduce((sum, col) => sum + (col.width || 150), 0)}px`,
              }}
            >
              {/* 헤더 행 */}
              <TableHeaderSection
                columns={currentColumns}
                editingColumnWidth={editingColumnWidth}
                hasQuestions={hasQuestions}
                onUpdateColumnLabel={updateColumnLabel}
                onUpdateColumnCode={updateColumnCode}
                onMoveColumn={moveColumn}
                onDeleteColumn={deleteColumn}
                onMergeColumnHeaders={mergeColumnHeaders}
                onUnmergeColumnHeader={unmergeColumnHeader}
                onSetEditingColumnWidth={setEditingColumnWidth}
                onColumnWidthChange={handleColumnWidthChange}
                onOpenColumnConditionModal={openColumnConditionModal}
              />

              {/* 데이터 행들 */}
              {currentRows.map((row, rowIndex) => (
                <EditorTableRow
                  key={row.id}
                  row={row}
                  rowIndex={rowIndex}
                  columnWidths={columnWidths}
                  columnCount={currentColumns.length}
                  totalRowCount={currentRows.length}
                  hasQuestions={hasQuestions}
                  hasCopiedCell={!!copiedCell}
                  hasCopiedRegion={!!copiedRegion}
                  isDragCopyActive={!!dragCopyState}
                  dragSelectionCellsKey={dragCopyTargetsByRow?.get(rowIndex) ?? ''}
                  onStartDragCopy={startDragCopy}
                  onUpdateRowLabel={updateRowLabel}
                  onUpdateRowCode={updateRowCode}
                  onOpenRowConditionModal={openRowConditionModal}
                  dynamicRowConfigs={dynamicRowConfigs}
                  onSetDynamicGroupId={setDynamicGroupId}
                  onSetShowWhenDynamicGroupId={setShowWhenDynamicGroupId}
                  onMoveRow={moveRow}
                  onDuplicateRow={duplicateRow}
                  onDeleteRow={deleteRow}
                  onSelectCell={handleSelectCell}
                  onMoveColumn={moveColumn}
                  onDeleteCell={deleteCell}
                  onCopyCell={copyCell}
                  onPasteCell={pasteCell}
                  onSaveCell={handleSaveCell}
                  onLoadCell={handleLoadCell}
                />
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* 셀 병합/해제 버튼 (선택된 셀이 있을 때) */}
      {selectedCell && (
        <Card>
          <CardContent className="p-4">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-medium text-gray-700">셀 병합:</span>
              {(['up', 'down', 'left', 'right'] as const).map((dir) => (
                <Button
                  key={dir}
                  size="sm"
                  variant="outline"
                  disabled={!canMerge(dir)}
                  onClick={() => handleMerge(dir)}
                >
                  {dir === 'up' ? '↑ 위' : dir === 'down' ? '↓ 아래' : dir === 'left' ? '← 왼쪽' : '→ 오른쪽'}
                </Button>
              ))}
              <Button
                size="sm"
                variant="outline"
                onClick={handleUnmerge}
              >
                병합 해제
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* 동적 행 그룹 설정 */}
      <Card>
        <CardContent className="space-y-3 p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <ListChecks className="h-4 w-4 text-purple-600" />
              <span className="text-sm font-medium text-gray-700">동적 행 그룹</span>
              {dynamicRowConfigs.length > 0 && (
                <span className="rounded-full bg-purple-100 px-2 py-0.5 text-xs text-purple-600">
                  {dynamicRowConfigs.length}개 그룹
                </span>
              )}
            </div>
            <Button
              size="sm"
              variant="outline"
              className="h-7 gap-1 text-xs"
              onClick={() => {
                const newGroup: DynamicRowGroupConfig = {
                  groupId: generateId(),
                  enabled: true,
                  label: `그룹 ${dynamicRowConfigs.length + 1}`,
                };
                onDynamicRowConfigsChange?.([...dynamicRowConfigs, newGroup]);
              }}
            >
              <Plus className="h-3 w-3" />
              그룹 추가
            </Button>
          </div>

          {dynamicRowConfigs.length === 0 && (
            <p className="text-xs text-gray-400">그룹을 추가하면 행을 동적으로 선택/표시할 수 있습니다.</p>
          )}

          {dynamicRowConfigs.map((group) => {
            const groupRowCount = currentRows.filter((r) => r.dynamicGroupId === group.groupId).length;
            return (
              <div key={group.groupId} className="space-y-2 rounded-md border border-purple-200 bg-purple-50/30 p-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={group.enabled}
                      onChange={(e) => {
                        const updated = dynamicRowConfigs.map((g) =>
                          g.groupId === group.groupId ? { ...g, enabled: e.target.checked } : g,
                        );
                        onDynamicRowConfigsChange?.(updated);
                      }}
                      className="rounded"
                    />
                    <span className="text-xs font-medium text-purple-700">
                      {group.label || group.groupId}
                    </span>
                    <span className="text-xs text-gray-400">{groupRowCount}개 행</span>
                  </div>
                  <button
                    onClick={() => {
                      // 그룹 삭제 + 고아 행 정리
                      const updated = dynamicRowConfigs.filter((g) => g.groupId !== group.groupId);
                      onDynamicRowConfigsChange?.(updated.length > 0 ? updated : undefined);
                      // 해당 그룹에 배정된 행들의 groupId 정리 (각 액션이 commitRows + notifyChange 로 영속)
                      currentRowsRef.current.forEach((row) => {
                        if (row.dynamicGroupId === group.groupId) setDynamicGroupId(row.id, undefined);
                        if (row.showWhenDynamicGroupId === group.groupId) setShowWhenDynamicGroupId(row.id, undefined);
                      });
                    }}
                    className="text-xs text-red-400 hover:text-red-600"
                    title="그룹 삭제"
                  >
                    삭제
                  </button>
                </div>
                {group.enabled && (
                  <div className="grid grid-cols-3 gap-2">
                    <div className="space-y-1">
                      <Label className="text-[10px] text-gray-500">버튼 텍스트</Label>
                      <Input
                        value={group.label ?? ''}
                        onChange={(e) => {
                          const updated = dynamicRowConfigs.map((g) => {
                            if (g.groupId !== group.groupId) return g;
                            const newLabel = e.target.value;
                            const { label: _l, ...rest } = g;
                            return newLabel ? { ...rest, label: newLabel } : rest;
                          });
                          onDynamicRowConfigsChange?.(updated);
                        }}
                        placeholder="항목 선택"
                        className="h-7 text-xs"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-[10px] text-gray-500">삽입 위치</Label>
                      <select
                        value={group.insertAfterRowId ?? ''}
                        onChange={(e) => {
                          const updated = dynamicRowConfigs.map((g) => {
                            if (g.groupId !== group.groupId) return g;
                            const newId = e.target.value;
                            const { insertAfterRowId: _iid, ...rest } = g;
                            return newId ? { ...rest, insertAfterRowId: newId } : rest;
                          });
                          onDynamicRowConfigsChange?.(updated);
                        }}
                        className="h-7 w-full rounded-md border border-input bg-background px-1 text-xs"
                      >
                        <option value="">헤더 바로 아래</option>
                        {nonDynamicRows.map((row) => (
                          <option key={row.id} value={row.id}>{row.label}</option>
                        ))}
                      </select>
                    </div>
                    <div className="space-y-1">
                      <Label className="text-[10px] text-gray-500">정렬</Label>
                      <select
                        value={group.buttonAlign ?? 'left'}
                        onChange={(e) => {
                          const updated = dynamicRowConfigs.map((g) =>
                            g.groupId === group.groupId
                              ? { ...g, buttonAlign: e.target.value as 'left' | 'center' | 'right' }
                              : g,
                          );
                          onDynamicRowConfigsChange?.(updated);
                        }}
                        className="h-7 w-full rounded-md border border-input bg-background px-1 text-xs"
                      >
                        <option value="left">좌측</option>
                        <option value="center">중앙</option>
                        <option value="right">우측</option>
                      </select>
                    </div>
                    {/* 그룹 표시 조건 */}
                    <div className="col-span-3">
                      <button
                        onClick={() => setEditingGroupCondition(group)}
                        className={`flex items-center gap-1 text-[10px] transition-colors ${
                          group.displayCondition && group.displayCondition.conditions.length > 0
                            ? 'text-blue-600 hover:text-blue-800'
                            : 'text-gray-400 hover:text-gray-600'
                        }`}
                      >
                        <Eye className="h-3 w-3" />
                        <span>
                          {group.displayCondition && group.displayCondition.conditions.length > 0
                            ? `표시 조건 ${group.displayCondition.conditions.length}개`
                            : '표시 조건 설정'}
                        </span>
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </CardContent>
      </Card>

      {/* 셀 내용 편집 모달 */}
      {selectedCellContext && (
        <CellContentModal
          isOpen={!!selectedCell}
          onClose={() => setSelectedCell(null)}
          currentQuestionId={currentQuestionId}
          questionCode={questionCode}
          questionTitle={questionTitle}
          rowCode={selectedCellContext.rowCode}
          rowLabel={selectedCellContext.rowLabel}
          columnCode={selectedCellContext.columnCode}
          columnLabel={selectedCellContext.columnLabel}
          cell={selectedCellContext.cell}
          getLatestRows={() => currentRowsRef.current}
          choiceGroups={currentQuestion?.choiceGroups}
          onChoiceGroupsChange={(groups: ChoiceGroup[]) => {
            if (!currentQuestionId) return;
            // 모달 handleSave 에서 onSave(셀 반영) 이후에 호출된다 —
            // currentRowsRef 는 이번 셀 변경을 이미 반영한 상태. DB prune 은
            // 모달 쪽(updatedRowsData 기준)이 정확하고, 여기는 스토어 표시용 보정.
            const qAfter = {
              ...currentQuestion!,
              tableRowsData: currentRowsRef.current,
              choiceGroups: groups,
            };
            const pruned = pruneChoiceGroups(qAfter);
            silentUpdateQuestion(currentQuestionId, {
              ...(pruned !== undefined ? { choiceGroups: pruned } : { choiceGroups: [] }),
            });
          }}
          onSave={(cell) => {
            if (selectedCellContext.rowIndex !== -1 && selectedCellContext.cellIndex !== -1) {
              updateCell(selectedCellContext.rowIndex, selectedCellContext.cellIndex, cell);
            }
          }}
        />
      )}

      {/* 행 조건부 표시 설정 모달 */}
      <ConditionModal
        kind="row"
        open={rowConditionModalOpen}
        onOpenChange={setRowConditionModalOpen}
        editingRowIndex={editingRowIndex}
        rows={currentRows}
        currentQuestion={currentQuestionAsQuestion}
        onUpdateCondition={updateRowCondition}
      />

      <ConditionModal
        kind="column"
        open={columnConditionModalOpen}
        onOpenChange={setColumnConditionModalOpen}
        editingColumnIndex={editingColumnIndex}
        columns={currentColumns}
        currentQuestion={currentQuestionAsQuestion}
        onUpdateCondition={updateColumnCondition}
      />

      {/* 그룹 조건부 표시 설정 모달 */}
      {currentQuestion && (
        <ConditionModal
          kind="group"
          open={!!editingGroupCondition}
          onOpenChange={(open) => { if (!open) setEditingGroupCondition(null); }}
          group={editingGroupCondition}
          currentQuestion={currentQuestion}
          onUpdateCondition={handleUpdateGroupCondition}
        />
      )}

      {/* 셀 보관함 모달 */}
      <SaveCellModal
        open={!!saveCellTarget}
        onOpenChange={(open) => { if (!open) setSaveCellTarget(null); }}
        cell={saveCellTarget?.cell ?? null}
      />
      <LoadCellModal
        open={!!loadCellTarget}
        onOpenChange={(open) => { if (!open) setLoadCellTarget(null); }}
        targetCell={loadCellTarget?.targetCell ?? null}
        onApply={handleCellApplied}
        currentRows={currentRows}
      />

      {/* 행 일괄 생성 모달 */}
      <BulkGeneratorModal
        mode="row"
        open={bulkRowModalOpen}
        onOpenChange={setBulkRowModalOpen}
        currentQuestionId={currentQuestionId}
        existingCodes={currentRows.map((r) => r.rowCode).filter(Boolean) as string[]}
        dynamicRowGroups={dynamicRowConfigs}
        onGenerate={handleBulkGenerate}
      />

      {/* 행 일괄 생성 토스트 */}
      {bulkRowToast?.visible && (
        <div className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 animate-in fade-in slide-in-from-bottom-4 duration-200">
          <div className="flex items-center gap-3 rounded-lg border border-blue-200 bg-blue-50 px-4 py-2.5 text-sm text-blue-700 shadow-lg">
            <span className="font-medium">{bulkRowToast.count}개 행 추가됨</span>
          </div>
        </div>
      )}

      {/* 열 일괄 생성 모달 */}
      <BulkGeneratorModal
        mode="column"
        open={bulkColumnModalOpen}
        onOpenChange={setBulkColumnModalOpen}
        currentQuestionId={currentQuestionId}
        existingCodes={currentColumns.map((c) => c.columnCode).filter(Boolean) as string[]}
        onGenerate={handleBulkColumnGenerate}
      />

      {/* 열 일괄 생성 토스트 */}
      {bulkColumnToast?.visible && (
        <div className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 animate-in fade-in slide-in-from-bottom-4 duration-200">
          <div className="flex items-center gap-3 rounded-lg border border-green-200 bg-green-50 px-4 py-2.5 text-sm text-green-700 shadow-lg">
            <span className="font-medium">{bulkColumnToast.count}개 열 추가됨</span>
          </div>
        </div>
      )}

      {/* 영역 복사 알림 토스트 (화면 하단 고정) */}
      {dragCopyToast?.visible && (
        <div className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 animate-in fade-in slide-in-from-bottom-4 duration-200">
          <div className="flex items-center gap-3 rounded-lg border border-purple-200 bg-purple-50 px-4 py-2.5 text-sm text-purple-700 shadow-lg">
            <span className="font-medium">{dragCopyToast.count}개 셀 영역 복사됨</span>
          </div>
        </div>
      )}

      {/* 붙여넣기 Undo 토스트 (화면 하단 고정) */}
      {!dragCopyToast?.visible && undoInfo && (
        <div className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 animate-in fade-in slide-in-from-bottom-4 duration-200">
          <div className="flex items-center gap-3 rounded-lg border border-green-200 bg-green-50 px-4 py-2.5 text-sm text-green-700 shadow-lg">
            <span className="font-medium">영역 붙여넣기 완료</span>
            <Button
              size="sm"
              variant="ghost"
              className="h-7 gap-1 px-2 text-green-700 hover:bg-green-100 hover:text-green-900"
              onClick={handleUndoPaste}
            >
              <Undo2 className="h-3.5 w-3.5" />
              실행 취소
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
