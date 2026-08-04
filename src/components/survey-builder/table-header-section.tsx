'use client';

import React from 'react';

import {
  ArrowLeft,
  ArrowRight,
  Combine,
  Eye,
  Settings2,
  Trash2,
  Unlink,
} from 'lucide-react';

import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import { useSurveyBuilderStore } from '@/stores/survey-store';
import { useSurveyUIStore } from '@/stores/ui-store';
import { TableColumn } from '@/types/survey';
import {
  getCellBackgroundStyle,
  getCellTextClassName,
  toCellStyleFieldProps,
} from '@/utils/cell-style';
import { getGridSpanStyle } from '@/utils/table-grid-utils';

import { CellStyleFields } from './cell-style-fields';
import { useDebouncedInput } from './hooks/use-debounced-input';

// ── 공통 스타일 상수 ──
const DEFAULT_COLUMN_WIDTH = 150;
const MENU_BUTTON_BASE = 'flex w-full items-center gap-2 rounded px-2 py-1 text-xs';
const MOVE_BUTTON_BASE =
  'flex flex-1 items-center justify-center gap-1 rounded px-2 py-1 text-xs text-gray-600 hover:bg-gray-100 disabled:opacity-30';
const MenuDivider = () => <div className="my-1 border-t" />;

type EditingColumnWidth = { columnIndex: number; value: string } | null;

interface ColumnHeaderCallbacks {
  onUpdateColumnLabel: (columnIndex: number, label: string) => void;
  onUpdateColumnCode: (columnIndex: number, code: string) => void;
  onMoveColumn: (columnIndex: number, direction: 'left' | 'right') => void;
  onDeleteColumn: (columnIndex: number) => void;
  onMergeColumnHeaders: (columnIndex: number) => void;
  onUnmergeColumnHeader: (columnIndex: number) => void;
  onSetEditingColumnWidth: (value: EditingColumnWidth) => void;
  onColumnWidthChange: (columnIndex: number, width: number) => void;
  onUpdateColumnStyle: (columnIndex: number, textBold: boolean, backgroundColor: string) => void;
  onOpenColumnConditionModal?: ((columnIndex: number) => void) | undefined;
}

export interface TableHeaderSectionProps extends ColumnHeaderCallbacks {
  columns: TableColumn[];
  editingColumnWidth: EditingColumnWidth;
  hasQuestions?: boolean | undefined;
}

interface ColumnHeaderProps extends ColumnHeaderCallbacks {
  column: TableColumn;
  columnIndex: number;
  totalColumns: number;
  editingColumnWidth: EditingColumnWidth;
  hasQuestions?: boolean | undefined;
  hideColumnLabels: boolean;
}

/** 개별 열 헤더 — debounced input + memo */
const ColumnHeader = React.memo(function ColumnHeader({
  column,
  columnIndex,
  totalColumns,
  editingColumnWidth,
  hasQuestions,
  hideColumnLabels,
  onUpdateColumnLabel,
  onUpdateColumnCode,
  onMoveColumn,
  onDeleteColumn,
  onMergeColumnHeaders,
  onUnmergeColumnHeader,
  onSetEditingColumnWidth,
  onColumnWidthChange,
  onUpdateColumnStyle,
  onOpenColumnConditionModal,
}: ColumnHeaderProps) {
  const handleLabelCommit = React.useCallback(
    (value: string) => onUpdateColumnLabel(columnIndex, value),
    [onUpdateColumnLabel, columnIndex],
  );
  const handleCodeCommit = React.useCallback(
    (value: string) => onUpdateColumnCode(columnIndex, value),
    [onUpdateColumnCode, columnIndex],
  );
  const [localLabel, setLocalLabel] = useDebouncedInput(column.label, handleLabelCommit);
  const [localCode, setLocalCode] = useDebouncedInput(column.columnCode || '', handleCodeCommit, 100);

  const headerColspan = column.colspan || 1;
  const isHeaderMerged = headerColspan > 1;
  const canMergeRight = columnIndex + headerColspan < totalColumns;
  const conditionCount = column.displayCondition?.conditions.length ?? 0;
  const hasCondition = conditionCount > 0;

  // 너비 편집 확정 (onBlur, Enter 공용)
  const commitWidthEdit = React.useCallback(() => {
    if (editingColumnWidth?.columnIndex !== columnIndex) return;
    const width = parseInt(editingColumnWidth.value);
    if (!isNaN(width) && width >= 0) {
      onColumnWidthChange(columnIndex, width);
    }
    onSetEditingColumnWidth(null);
  }, [editingColumnWidth, columnIndex, onColumnWidthChange, onSetEditingColumnWidth]);

  const widthInputValue =
    editingColumnWidth?.columnIndex === columnIndex
      ? editingColumnWidth.value
      : String(column.width || DEFAULT_COLUMN_WIDTH);

  return (
    <div
      className="relative min-h-[40px] min-w-0 overflow-hidden border-r border-b border-gray-300 bg-gray-50 p-2 [overflow-wrap:anywhere]"
      style={{
        ...getGridSpanStyle(headerColspan),
        ...getCellBackgroundStyle(column),
      }}
    >
      {!hideColumnLabels && (
        <div className="space-y-1">
          <Input
            value={localLabel}
            onChange={(e) => setLocalLabel(e.target.value)}
            className={cn(
              'h-7 w-full border border-gray-200 bg-transparent pr-7 text-center text-sm',
              getCellTextClassName(column),
            )}
            placeholder="열 제목"
          />
          <div className="flex items-center justify-center gap-1 text-[10px] text-gray-400">
            <span>{localCode || `c${columnIndex + 1}`}</span>
            {isHeaderMerged && <span className="text-orange-500">🔗{headerColspan}</span>}
            {hasCondition && <Eye className="h-2.5 w-2.5 text-blue-500" />}
          </div>
        </div>
      )}

      {/* 설정 버튼 — 열 너비가 좁아도 항상 클릭 가능하도록 absolute 고정 */}
      <Popover>
        <PopoverTrigger asChild>
          <button
            className="absolute top-1.5 right-1 z-10 flex h-6 w-6 items-center justify-center rounded bg-gray-50 text-gray-400 shadow-sm transition-colors hover:bg-gray-200 hover:text-gray-700"
            title="열 설정"
          >
            <Settings2 className="h-3.5 w-3.5" />
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-80 p-1" side="bottom" align="end">
          <div className="space-y-0.5">
            {/* 열 코드 */}
            <div className="px-2 py-1.5">
              <label className="mb-1 block text-[10px] font-medium text-gray-500">열 코드 (엑셀용)</label>
              <Input
                value={localCode}
                onChange={(e) => setLocalCode(e.target.value)}
                className="h-6 bg-gray-50 px-1.5 text-xs"
                placeholder="열 코드"
              />
            </div>

            {/* 너비 */}
            <div className="px-2 py-1.5">
              <label className="mb-1 block text-[10px] font-medium text-gray-500">너비 (px)</label>
              <Input
                type="number"
                min={0}
                value={widthInputValue}
                onChange={(e) => onSetEditingColumnWidth({ columnIndex, value: e.target.value })}
                onBlur={commitWidthEdit}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') commitWidthEdit();
                }}
                onFocus={() => {
                  if (editingColumnWidth?.columnIndex !== columnIndex) {
                    onSetEditingColumnWidth({
                      columnIndex,
                      value: String(column.width || DEFAULT_COLUMN_WIDTH),
                    });
                  }
                }}
                className="h-6 bg-gray-50 px-1.5 text-xs"
              />
            </div>

            <MenuDivider />

            {/* 헤더 스타일 */}
            <div className="px-2 py-1.5">
              <label className="mb-1.5 block text-[10px] font-medium text-gray-500">
                헤더 스타일
              </label>
              <CellStyleFields
                {...toCellStyleFieldProps(column, (textBold, backgroundColor) => (
                  onUpdateColumnStyle(columnIndex, textBold, backgroundColor)
                ))}
              />
            </div>

            {/* 이동 */}
            <div className="flex gap-0.5 px-1">
              <button
                onClick={() => onMoveColumn(columnIndex, 'left')}
                disabled={columnIndex === 0}
                className={MOVE_BUTTON_BASE}
              >
                <ArrowLeft className="h-3 w-3" /> 왼쪽
              </button>
              <button
                onClick={() => onMoveColumn(columnIndex, 'right')}
                disabled={columnIndex === totalColumns - 1}
                className={MOVE_BUTTON_BASE}
              >
                오른쪽 <ArrowRight className="h-3 w-3" />
              </button>
            </div>

            {/* 병합/해제 */}
            {(canMergeRight || isHeaderMerged) && (
              <>
                <MenuDivider />
                {canMergeRight && (
                  <button
                    onClick={() => onMergeColumnHeaders(columnIndex)}
                    className={`${MENU_BUTTON_BASE} text-gray-600 hover:bg-gray-100`}
                  >
                    <Combine className="h-3 w-3" /> 오른쪽 열과 병합
                  </button>
                )}
                {isHeaderMerged && (
                  <button
                    onClick={() => onUnmergeColumnHeader(columnIndex)}
                    className={`${MENU_BUTTON_BASE} text-orange-600 hover:bg-orange-50`}
                  >
                    <Unlink className="h-3 w-3" /> 병합 해제
                  </button>
                )}
              </>
            )}

            {/* 조건부 표시 */}
            {hasQuestions && onOpenColumnConditionModal && !isHeaderMerged && (
              <>
                <MenuDivider />
                <button
                  onClick={() => onOpenColumnConditionModal(columnIndex)}
                  className={`${MENU_BUTTON_BASE} ${
                    hasCondition
                      ? 'text-blue-600 hover:bg-blue-50'
                      : 'text-gray-600 hover:bg-gray-100'
                  }`}
                >
                  <Eye className="h-3 w-3" />
                  {hasCondition ? `조건부 표시 (${conditionCount}개)` : '조건부 표시'}
                </button>
              </>
            )}

            {/* 삭제 */}
            {totalColumns > 1 && (
              <>
                <MenuDivider />
                <button
                  onClick={() => onDeleteColumn(columnIndex)}
                  className={`${MENU_BUTTON_BASE} text-red-500 hover:bg-red-50`}
                >
                  <Trash2 className="h-3 w-3" /> 열 삭제
                </button>
              </>
            )}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
});

/** 에디터 테이블 헤더 — CSS Grid 셀들을 반환 (Fragment) */
export const TableHeaderSection = React.memo(function TableHeaderSection({
  columns,
  editingColumnWidth,
  hasQuestions,
  onUpdateColumnLabel,
  onUpdateColumnCode,
  onMoveColumn,
  onDeleteColumn,
  onMergeColumnHeaders,
  onUnmergeColumnHeader,
  onSetEditingColumnWidth,
  onColumnWidthChange,
  onUpdateColumnStyle,
  onOpenColumnConditionModal,
}: TableHeaderSectionProps) {
  const editingQuestionId = useSurveyUIStore((s) => s.editingQuestionId);
  const hideColumnLabels = useSurveyBuilderStore(
    (s) => s.currentSurvey.questions.find((q) => q.id === editingQuestionId)?.hideColumnLabels ?? false,
  );

  return (
    <>
      {/* 행 라벨 헤더 (첫 번째 열) */}
      <div className="sticky left-0 z-10 border-r border-b border-gray-300 bg-gray-100 p-2">
        <div className="truncate text-center text-xs font-semibold text-gray-600" title="행 라벨/코드">
          행
        </div>
      </div>

      {/* 열 헤더들 */}
      {columns.map((column, columnIndex) => {
        if (column.isHeaderHidden) return null;

        return (
          <ColumnHeader
            key={column.id}
            column={column}
            columnIndex={columnIndex}
            totalColumns={columns.length}
            editingColumnWidth={editingColumnWidth}
            hasQuestions={hasQuestions}
            hideColumnLabels={hideColumnLabels}
            onUpdateColumnLabel={onUpdateColumnLabel}
            onUpdateColumnCode={onUpdateColumnCode}
            onMoveColumn={onMoveColumn}
            onDeleteColumn={onDeleteColumn}
            onMergeColumnHeaders={onMergeColumnHeaders}
            onUnmergeColumnHeader={onUnmergeColumnHeader}
            onSetEditingColumnWidth={onSetEditingColumnWidth}
            onColumnWidthChange={onColumnWidthChange}
            onUpdateColumnStyle={onUpdateColumnStyle}
            onOpenColumnConditionModal={onOpenColumnConditionModal}
          />
        );
      })}
    </>
  );
});
