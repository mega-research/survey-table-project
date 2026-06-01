'use client';

import React from 'react';

import {
  Archive,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  CheckSquare,
  Circle,
  Clipboard,
  Copy,
  Download,
  Eye,
  Image,
  Settings2,
  Trash2,
  Video,
  Zap,
} from 'lucide-react';

import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import { DynamicRowGroupConfig, TableCell, TableRow } from '@/types/survey';
import { isCellSaveable } from '@/utils/cell-library-helpers';
import { getAlignmentClasses, getGridSpanStyle } from '@/utils/table-grid-utils';

import { useDebouncedInput } from './hooks/use-debounced-input';

const GROUP_COLORS = [
  'bg-purple-500', 'bg-green-500', 'bg-yellow-500', 'bg-blue-500',
  'bg-pink-500', 'bg-orange-500', 'bg-teal-500', 'bg-red-500',
  'bg-indigo-500', 'bg-cyan-500', 'bg-lime-500', 'bg-rose-500',
  'bg-violet-500', 'bg-emerald-500', 'bg-amber-500', 'bg-sky-500',
  'bg-fuchsia-500', 'bg-stone-500',
];

/** 에디터 셀 내용 표시 */
const EditorCellContent = React.memo(function EditorCellContent({ cell }: { cell: TableCell }) {
  const hasText = cell.content && cell.content.trim().length > 0;

  const textContent = hasText ? (
    <div
      className={`mb-2 w-full text-sm whitespace-pre-wrap [overflow-wrap:anywhere] ${cell.type === 'text' ? '' : 'font-medium text-gray-700'}`}
    >
      {cell.content}
    </div>
  ) : null;

  let typeContent = null;
  switch (cell.type) {
    case 'checkbox':
      typeContent = cell.checkboxOptions && cell.checkboxOptions.length > 0
        ? (<div className="flex items-center gap-2"><CheckSquare className="h-4 w-4 text-green-500" /><span className="truncate text-sm text-gray-600">체크박스 ({cell.checkboxOptions.length}개)</span></div>)
        : (<span className="text-sm text-gray-400">체크박스 없음</span>);
      break;
    case 'radio':
      typeContent = cell.radioOptions && cell.radioOptions.length > 0
        ? (<div className="flex items-center justify-center gap-2"><Circle className="h-4 w-4 text-purple-500" /><span className="truncate text-sm text-gray-600">라디오 ({cell.radioOptions.length}개)</span></div>)
        : (<span className="text-sm text-gray-400">라디오 없음</span>);
      break;
    case 'image':
      typeContent = cell.imageUrl
        ? (<div className="flex items-center gap-2"><Image className="h-4 w-4 text-blue-500" aria-label="이미지 아이콘" /><span className="truncate text-sm text-gray-600">이미지</span></div>)
        : (<span className="text-sm text-gray-400">이미지 없음</span>);
      break;
    case 'video':
      typeContent = cell.videoUrl
        ? (<div className="flex items-center gap-2"><Video className="h-4 w-4 text-red-500" /><span className="truncate text-sm text-gray-600">동영상</span></div>)
        : (<span className="text-sm text-gray-400">동영상 없음</span>);
      break;
    case 'input':
      typeContent = (<div className="flex items-center gap-2"><span className="truncate text-sm text-gray-600">{cell.placeholder ? `입력 필드: ${cell.placeholder}` : '단답형 입력'}</span></div>);
      break;
    case 'select':
      typeContent = cell.selectOptions && cell.selectOptions.length > 0
        ? (<div className="flex items-center gap-2"><span className="truncate text-sm text-gray-600">선택 ({cell.selectOptions.length}개)</span></div>)
        : (<span className="text-sm text-gray-400">선택 옵션 없음</span>);
      break;
    case 'choice_opt':
      typeContent = (<div className="flex items-center justify-center gap-2"><CheckSquare className="h-4 w-4 text-emerald-500" /><span className="truncate text-sm text-gray-600">보기 옵션{cell.choiceLabel ? `: ${cell.choiceLabel}` : ''}</span></div>);
      break;
    case 'text':
    default:
      typeContent = null;
  }

  return (<div className="w-full">{textContent}{typeContent}</div>);
});

export interface EditorTableRowProps {
  row: TableRow;
  rowIndex: number;
  columnWidths: number[];
  columnCount: number;
  totalRowCount: number;
  hasQuestions: boolean;
  hasCopiedCell: boolean;
  hasCopiedRegion: boolean;
  isDragCopyActive: boolean;
  dragSelectionCellsKey: string;
  onStartDragCopy: (rowIndex: number, cellIndex: number) => void;
  onUpdateRowLabel: (rowIndex: number, label: string) => void;
  onUpdateRowCode: (rowIndex: number, rowCode: string) => void;
  onOpenRowConditionModal: (rowIndex: number) => void;
  dynamicRowConfigs: DynamicRowGroupConfig[];
  onSetDynamicGroupId: (rowId: string, groupId: string | undefined) => void;
  onSetShowWhenDynamicGroupId: (rowId: string, groupId: string | undefined) => void;
  onMoveRow: (rowIndex: number, targetIndex: number) => void;
  onDuplicateRow: (rowIndex: number) => void;
  onDeleteRow: (rowIndex: number) => void;
  onSelectCell: (rowId: string, cellId: string) => void;
  onMoveColumn: (cellIndex: number, direction: 'left' | 'right') => void;
  onDeleteCell: (rowIndex: number, cellIndex: number) => void;
  onCopyCell: (rowIndex: number, cellIndex: number) => void;
  onPasteCell: (rowIndex: number, cellIndex: number) => void;
  onSaveCell: (rowIndex: number, cellIndex: number) => void;
  onLoadCell: (rowIndex: number, cellIndex: number) => void;
}

/** 에디터 테이블 행 — CSS Grid 셀들을 반환 (Fragment) */
export const EditorTableRow = React.memo(function EditorTableRow({
  row,
  rowIndex,
  columnWidths,
  columnCount,
  totalRowCount,
  hasQuestions,
  hasCopiedCell,
  hasCopiedRegion,
  isDragCopyActive,
  dragSelectionCellsKey,
  onStartDragCopy,
  onUpdateRowLabel,
  onUpdateRowCode,
  onOpenRowConditionModal,
  dynamicRowConfigs,
  onSetDynamicGroupId,
  onSetShowWhenDynamicGroupId,
  onMoveRow,
  onDuplicateRow,
  onDeleteRow,
  onSelectCell,
  onMoveColumn,
  onDeleteCell,
  onCopyCell,
  onPasteCell,
  onSaveCell,
  onLoadCell,
}: EditorTableRowProps) {
  const [openPopoverCellId, setOpenPopoverCellId] = React.useState<string | null>(null);

  const handleRowLabelCommit = React.useCallback(
    (value: string) => onUpdateRowLabel(rowIndex, value),
    [onUpdateRowLabel, rowIndex],
  );
  const handleRowCodeCommit = React.useCallback(
    (value: string) => onUpdateRowCode(rowIndex, value),
    [onUpdateRowCode, rowIndex],
  );
  const [localRowLabel, setLocalRowLabel] = useDebouncedInput(row.label, handleRowLabelCommit);
  const [localRowCode, setLocalRowCode] = useDebouncedInput(row.rowCode || '', handleRowCodeCommit, 100);

  const dragSelectionCells = React.useMemo(() => {
    if (!dragSelectionCellsKey) return null;
    return new Set(dragSelectionCellsKey.split(',').map(Number));
  }, [dragSelectionCellsKey]);

  const rowHeight = row.height ? `${row.height}px` : '60px';

  return (
    <>
      {/* 행 라벨 셀 (sticky) */}
      <div
        className="sticky left-0 z-10 border-r border-b border-gray-300 bg-gray-50 p-1"
        style={{ minHeight: rowHeight }}
      >
        <div className="space-y-1">
          <Input
            value={localRowLabel}
            onChange={(e) => setLocalRowLabel(e.target.value)}
            className="h-6 bg-white px-1 text-center text-xs"
            placeholder="행 라벨"
            title={`행 라벨: ${localRowLabel}`}
          />
          <div className="flex items-center justify-center gap-0.5">
            <span className="truncate text-[10px] text-gray-400">{localRowCode || `r${rowIndex + 1}`}</span>
            {row.displayCondition && row.displayCondition.conditions.length > 0 && (
              <Eye className="h-2.5 w-2.5 shrink-0 text-blue-500" />
            )}
            {row.dynamicGroupId && (
              <span className={`inline-block h-2 w-2 shrink-0 rounded-full ${
                GROUP_COLORS[dynamicRowConfigs.findIndex((g) => g.groupId === row.dynamicGroupId) % GROUP_COLORS.length] || 'bg-purple-500'
              }`} />
            )}
            {row.showWhenDynamicGroupId && (
              <Zap className={`h-2.5 w-2.5 shrink-0 ${GROUP_COLORS[dynamicRowConfigs.findIndex((g) => g.groupId === row.showWhenDynamicGroupId) % GROUP_COLORS.length]?.replace('bg-', 'text-') || 'text-amber-500'}`} />
            )}
            <Popover>
              <PopoverTrigger asChild>
                <button
                  className="flex h-4 w-4 shrink-0 items-center justify-center rounded text-gray-400 transition-colors hover:bg-gray-200 hover:text-gray-700"
                  title="행 설정"
                >
                  <Settings2 className="h-3 w-3" />
                </button>
              </PopoverTrigger>
              <PopoverContent className="max-h-[60vh] w-auto min-w-32 overflow-y-auto p-1" side="right" align="start">
                <div className="space-y-0.5">
                  <div className="px-2 py-1.5">
                    <label className="mb-1 block text-[10px] font-medium text-gray-500">행 코드 (엑셀용)</label>
                    <Input
                      value={localRowCode}
                      onChange={(e) => setLocalRowCode(e.target.value)}
                      className="h-6 bg-gray-50 px-1.5 text-xs"
                      placeholder="행 코드"
                    />
                  </div>
                  {hasQuestions && (
                    <>
                      <div className="my-1 border-t" />
                      <button
                        onClick={() => onOpenRowConditionModal(rowIndex)}
                        className={`flex w-full items-center gap-2 rounded px-2 py-1 text-xs ${
                          row.displayCondition && row.displayCondition.conditions.length > 0
                            ? 'text-blue-600 hover:bg-blue-50'
                            : 'text-gray-600 hover:bg-gray-100'
                        }`}
                      >
                        <Eye className="h-3 w-3" />
                        {row.displayCondition && row.displayCondition.conditions.length > 0
                          ? `조건부 표시 (${row.displayCondition.conditions.length}개)`
                          : '조건부 표시'}
                      </button>
                    </>
                  )}
                  {dynamicRowConfigs.length > 0 && (
                    <>
                      <div className="my-1 border-t" />
                      <div className="px-2 py-0.5 text-[10px] font-medium text-gray-500">동적 그룹</div>
                      <button
                        onClick={() => { onSetDynamicGroupId(row.id, undefined); onSetShowWhenDynamicGroupId(row.id, undefined); }}
                        className={`flex w-full items-center gap-2 rounded px-2 py-1 text-xs hover:bg-gray-100 ${
                          !row.dynamicGroupId && !row.showWhenDynamicGroupId ? 'bg-gray-100 font-medium' : ''
                        }`}
                      >
                        <span className="inline-block h-2 w-2 rounded-full bg-gray-300" />
                        그룹없음
                      </button>
                      {dynamicRowConfigs.map((g, idx) => (
                        <button
                          key={g.groupId}
                          onClick={() => onSetDynamicGroupId(row.id, g.groupId)}
                          className={`flex w-full items-center gap-2 rounded px-2 py-1 text-xs hover:bg-gray-100 ${
                            row.dynamicGroupId === g.groupId ? 'bg-gray-100 font-medium' : ''
                          }`}
                        >
                          <span className={`inline-block h-2 w-2 rounded-full ${GROUP_COLORS[idx % GROUP_COLORS.length]}`} />
                          {g.label || g.groupId}
                        </button>
                      ))}
                      <div className="my-1 border-t" />
                      {dynamicRowConfigs.map((g, idx) => (
                        <button
                          key={`link-${g.groupId}`}
                          onClick={() => onSetShowWhenDynamicGroupId(row.id, g.groupId)}
                          className={`flex w-full items-center gap-2 rounded px-2 py-1 text-xs hover:bg-gray-100 ${
                            row.showWhenDynamicGroupId === g.groupId ? 'bg-gray-100 font-medium' : ''
                          }`}
                        >
                          <Zap className={`h-3 w-3 ${GROUP_COLORS[idx % GROUP_COLORS.length]?.replace('bg-', 'text-') || 'text-gray-400'}`} />
                          {g.label || g.groupId} (소계)
                        </button>
                      ))}
                    </>
                  )}
                  <div className="my-1 border-t" />
                  {/* 행 이동 */}
                  <div className="flex items-center justify-center gap-1 px-1">
                    <button
                      onClick={() => onMoveRow(rowIndex, rowIndex - 1)}
                      disabled={rowIndex === 0}
                      className="rounded p-1 text-gray-600 hover:bg-gray-100 disabled:opacity-30"
                    >
                      <ArrowUp className="h-3.5 w-3.5" />
                    </button>
                    <input
                      type="number"
                      min={1}
                      max={totalRowCount}
                      defaultValue={rowIndex + 1}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          const target = parseInt((e.target as HTMLInputElement).value, 10) - 1;
                          if (!isNaN(target)) onMoveRow(rowIndex, target);
                        }
                      }}
                      className="h-5 w-8 rounded border text-center text-xs [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                    />
                    <button
                      onClick={() => onMoveRow(rowIndex, rowIndex + 1)}
                      disabled={rowIndex === totalRowCount - 1}
                      className="rounded p-1 text-gray-600 hover:bg-gray-100 disabled:opacity-30"
                    >
                      <ArrowDown className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  <div className="my-1 border-t" />
                  <button
                    onClick={() => onDuplicateRow(rowIndex)}
                    className="flex w-full items-center gap-2 rounded px-2 py-1 text-xs text-gray-600 hover:bg-gray-100"
                  >
                    <Copy className="h-3 w-3" /> 행 복제
                  </button>
                  {totalRowCount > 1 && (
                    <button
                      onClick={() => onDeleteRow(rowIndex)}
                      className="flex w-full items-center gap-2 rounded px-2 py-1 text-xs text-red-500 hover:bg-red-50"
                    >
                      <Trash2 className="h-3 w-3" /> 행 삭제
                    </button>
                  )}
                </div>
              </PopoverContent>
            </Popover>
          </div>
        </div>
      </div>

      {/* 데이터 셀들 */}
      {row.cells.map((cell, cellIndex) => {
        if (cell.isHidden) return null;

        const rowspan = cell.rowspan || 1;
        const colspan = cell.colspan || 1;
        const isMerged = rowspan > 1 || colspan > 1;
        const isSelected = dragSelectionCells?.has(cellIndex) ?? false;

        return (
          <div
            key={cell.id}
            data-row-index={rowIndex}
            data-cell-index={cellIndex}
            className={cn(
              'relative min-w-0 border-r border-b border-gray-300 bg-white p-2',
              isSelected && 'ring-2 ring-inset ring-blue-500 bg-blue-50',
            )}
            style={{
              ...getGridSpanStyle(colspan, rowspan),
              minHeight: rowHeight,
            }}
          >
            <div
              className={cn(
                'group relative flex h-full cursor-pointer flex-col rounded p-2 transition-colors hover:bg-gray-50',
                getAlignmentClasses(cell.horizontalAlign, cell.verticalAlign),
              )}
              onClick={() => onSelectCell(row.id, cell.id)}
              style={{ minHeight: row.minHeight ? `${row.minHeight - 16}px` : '40px' }}
            >
              <div className="mb-2 flex items-start justify-between">
                <div className="flex-1">
                  <EditorCellContent cell={cell} />
                </div>
                <Popover open={openPopoverCellId === cell.id} onOpenChange={(open) => setOpenPopoverCellId(open ? cell.id : null)}>
                  <PopoverTrigger asChild>
                    <button
                      className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-gray-400 opacity-0 transition-opacity hover:bg-gray-200 hover:text-gray-700 group-hover:opacity-100 data-[state=open]:opacity-100"
                      onClick={(e) => e.stopPropagation()}
                      title="셀 설정"
                    >
                      <Settings2 className="h-3 w-3" />
                    </button>
                  </PopoverTrigger>
                  <PopoverContent className="w-40 p-1" side="bottom" align="end" onClick={(e) => e.stopPropagation()}>
                    <div className="space-y-0.5">
                      <button onClick={() => { onCopyCell(rowIndex, cellIndex); setOpenPopoverCellId(null); }} className="flex w-full items-center gap-2 rounded px-2 py-1 text-xs text-gray-600 hover:bg-gray-100">
                        <Copy className="h-3 w-3" /> 셀 복사
                      </button>
                      {(hasCopiedCell || hasCopiedRegion) && (
                        <button onClick={() => { onPasteCell(rowIndex, cellIndex); setOpenPopoverCellId(null); }} className="flex w-full items-center gap-2 rounded px-2 py-1 text-xs text-blue-600 hover:bg-blue-50">
                          <Clipboard className="h-3 w-3" /> 셀 붙여넣기
                        </button>
                      )}
                      <button onClick={() => { onDeleteCell(rowIndex, cellIndex); setOpenPopoverCellId(null); }} className="flex w-full items-center gap-2 rounded px-2 py-1 text-xs text-red-500 hover:bg-red-50">
                        <Trash2 className="h-3 w-3" /> 셀 삭제
                      </button>
                      <div className="my-1 border-t" />
                      <button onClick={() => { onSaveCell(rowIndex, cellIndex); setOpenPopoverCellId(null); }} disabled={!isCellSaveable(cell)} className="flex w-full items-center gap-2 rounded px-2 py-1 text-xs text-purple-600 hover:bg-purple-50 disabled:opacity-30">
                        <Archive className="h-3 w-3" /> 셀 보관
                      </button>
                      <button onClick={() => { onLoadCell(rowIndex, cellIndex); setOpenPopoverCellId(null); }} className="flex w-full items-center gap-2 rounded px-2 py-1 text-xs text-green-600 hover:bg-green-50">
                        <Download className="h-3 w-3" /> 셀 불러오기
                      </button>
                      <div className="my-1 border-t" />
                      <div className="flex gap-0.5 px-1">
                        <button onClick={() => { onMoveColumn(cellIndex, 'left'); setOpenPopoverCellId(null); }} disabled={cellIndex === 0} className="flex flex-1 items-center justify-center gap-1 rounded px-2 py-1 text-xs text-gray-600 hover:bg-gray-100 disabled:opacity-30">
                          <ArrowLeft className="h-3 w-3" /> 왼쪽
                        </button>
                        <button onClick={() => { onMoveColumn(cellIndex, 'right'); setOpenPopoverCellId(null); }} disabled={cellIndex === columnCount - 1} className="flex flex-1 items-center justify-center gap-1 rounded px-2 py-1 text-xs text-gray-600 hover:bg-gray-100 disabled:opacity-30">
                          오른쪽 <ArrowRight className="h-3 w-3" />
                        </button>
                      </div>
                    </div>
                  </PopoverContent>
                </Popover>
              </div>

              {/* Fill Handle — 드래그 복사 시작점 */}
              {!isDragCopyActive && (
                <div
                  className="absolute bottom-0 right-0 z-10 flex h-3 w-3 cursor-crosshair items-center justify-center opacity-0 group-hover:opacity-100"
                  style={{ padding: '3px', margin: '-3px' }}
                  onMouseDown={(e) => { e.stopPropagation(); e.preventDefault(); onStartDragCopy(rowIndex, cellIndex); }}
                >
                  <div className="h-1.5 w-1.5 rounded-sm bg-blue-500" />
                </div>
              )}

              <div className="mt-1 border-t border-gray-100 pt-1 text-xs text-gray-400">
                <div className="flex items-center justify-between">
                  <span>셀 ({rowIndex + 1}, {cellIndex + 1})</span>
                  <span className="font-medium capitalize">{cell.type}</span>
                </div>
                {isMerged && <div className="mt-1 font-medium text-orange-600">🔗 병합: {rowspan}행 × {colspan}열</div>}
                {cell.type === 'checkbox' && cell.checkboxOptions && <div className="mt-1 text-green-600">체크박스 {cell.checkboxOptions.length}개</div>}
                {cell.type === 'radio' && cell.radioOptions && <div className="mt-1 text-purple-600">라디오 {cell.radioOptions.length}개</div>}
                {cell.type === 'select' && cell.selectOptions && <div className="mt-1 text-indigo-600">선택 {cell.selectOptions.length}개</div>}
                {cell.type === 'input' && <div className="mt-1 text-teal-600">{cell.placeholder || '단답형 입력'}</div>}
                {cell.type === 'image' && cell.imageUrl && <div className="mt-1 text-blue-600">이미지 설정됨</div>}
                {cell.type === 'video' && cell.videoUrl && <div className="mt-1 text-red-600">비디오 설정됨</div>}
              </div>
            </div>
          </div>
        );
      })}
    </>
  );
});
