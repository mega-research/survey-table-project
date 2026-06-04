'use client';

import { useMemo, useState } from 'react';

import {
  CheckSquare,
  ChevronDown,
  Circle,
  Download,
  ListOrdered,
  Loader2,
  PenLine,
  Search,
  Trash2,
  Type,
  Video,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import {
  useApplySavedCell,
  useDeleteSavedCell,
  useSavedCells,
  useSearchSavedCells,
} from '@/hooks/queries/use-cell-library';
import type { SavedCell, TableCell, TableRow } from '@/types/survey';
import {
  getCellPreviewText,
  restoreCellFromLibrary,
} from '@/utils/cell-library-helpers';

// 셀 타입 아이콘 매핑
const cellTypeIcons: Record<TableCell['type'], React.ElementType> = {
  text: Type,
  image: Type,
  video: Video,
  input: PenLine,
  checkbox: CheckSquare,
  radio: Circle,
  select: ChevronDown,
  ranking: ListOrdered,
  ranking_opt: ListOrdered,
  choice_opt: Circle,
};

interface LoadCellModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  targetCell: TableCell | null;
  onApply: (restoredCell: TableCell) => void;
  /** ranking_opt "기타" 셀 중복 감지를 위한 현재 테이블 행들. */
  currentRows?: TableRow[];
}

export function LoadCellModal({
  open,
  onOpenChange,
  targetCell,
  onApply,
  currentRows,
}: LoadCellModalProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const { data: allCells, isLoading } = useSavedCells();
  const { data: searchResults } = useSearchSavedCells(searchQuery);
  const applySavedCell = useApplySavedCell();
  const deleteSavedCell = useDeleteSavedCell();

  const displayCells = useMemo(() => {
    if (searchQuery.length > 0 && searchResults) return searchResults;
    return allCells ?? [];
  }, [searchQuery, searchResults, allCells]);

  const handleApply = async (savedCell: SavedCell) => {
    if (!targetCell) return;

    const cellData = await applySavedCell.mutateAsync(savedCell.id);
    if (!cellData) return;

    const restoredCell = restoreCellFromLibrary(cellData, targetCell, currentRows);
    onApply(restoredCell);
    onOpenChange(false);
  };

  const handleDelete = async (id: string) => {
    if (deletingId) return;
    setDeletingId(id);
    await deleteSavedCell.mutateAsync(id);
    setDeletingId(null);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle className="text-base">셀 불러오기</DialogTitle>
          <DialogDescription className="sr-only">
            보관함에서 셀을 불러옵니다
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {/* 검색 */}
          <div className="relative">
            <Search className="absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-gray-400" />
            <Input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="이름으로 검색..."
              className="pl-9"
            />
          </div>

          {/* 리스트 */}
          <div className="max-h-[360px] space-y-1 overflow-y-auto">
            {isLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-5 w-5 animate-spin text-gray-400" />
              </div>
            ) : displayCells.length === 0 ? (
              <div className="py-8 text-center text-sm text-gray-400">
                {searchQuery ? '검색 결과가 없습니다' : '저장된 셀이 없습니다'}
              </div>
            ) : (
              displayCells.map((savedCell) => (
                <SavedCellItem
                  key={savedCell.id}
                  savedCell={savedCell}
                  isDeleting={deletingId === savedCell.id}
                  isApplying={applySavedCell.isPending}
                  onApply={() => handleApply(savedCell)}
                  onDelete={() => handleDelete(savedCell.id)}
                />
              ))
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ========================
// SavedCellItem 컴포넌트
// ========================

interface SavedCellItemProps {
  savedCell: SavedCell;
  isDeleting: boolean;
  isApplying: boolean;
  onApply: () => void;
  onDelete: () => void;
}

function SavedCellItem({ savedCell, isDeleting, isApplying, onApply, onDelete }: SavedCellItemProps) {
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const Icon = cellTypeIcons[savedCell.cellType] ?? Type;
  const previewText = getCellPreviewText(savedCell.cell);

  return (
    <div className="overflow-hidden rounded-lg border p-2.5 transition-colors hover:bg-gray-50">
      {/* 상단: 타입 아이콘, 이름, 사용횟수, 액션 */}
      <div className="flex items-center gap-2">
        <Icon className="h-4 w-4 shrink-0 text-gray-500" />
        <span className="min-w-0 flex-1 truncate text-sm font-medium text-gray-700">
          {savedCell.name}
        </span>
        <span className="shrink-0 text-xs whitespace-nowrap text-gray-400">사용 {savedCell.usageCount}회</span>

        {showDeleteConfirm ? (
          <div className="flex shrink-0 items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              className="h-6 px-2 text-xs text-gray-500"
              onClick={() => setShowDeleteConfirm(false)}
            >
              취소
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 px-2 text-xs text-red-500 hover:text-red-600"
              onClick={() => {
                onDelete();
                setShowDeleteConfirm(false);
              }}
              disabled={isDeleting}
            >
              {isDeleting ? '삭제 중...' : '확인'}
            </Button>
          </div>
        ) : (
          <div className="flex shrink-0 items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              className="h-6 w-6 p-0 text-gray-400 hover:text-red-500"
              onClick={() => setShowDeleteConfirm(true)}
              title="삭제"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 gap-1 px-2 text-xs text-blue-600 hover:text-blue-700"
              onClick={onApply}
              disabled={isApplying}
              title="이 셀에 적용"
            >
              <Download className="h-3.5 w-3.5" />
              적용
            </Button>
          </div>
        )}
      </div>

      {/* 하단: 미리보기 */}
      {previewText && (
        <p className="mt-1 line-clamp-2 break-all pl-6 text-xs text-gray-400">{previewText}</p>
      )}
    </div>
  );
}
