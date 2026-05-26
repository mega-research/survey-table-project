'use client';

import { useEffect, useState } from 'react';

import {
  CheckSquare,
  ChevronDown,
  Circle,
  ListOrdered,
  PenLine,
  Save,
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
import { Label } from '@/components/ui/label';
import { useSaveCell } from '@/hooks/queries/use-cell-library';
import type { TableCell } from '@/types/survey';
import { CELL_TYPE_LABELS, getCellPreviewText } from '@/utils/cell-library-helpers';

// 셀 타입 아이콘 매핑
const cellTypeIcons: Record<TableCell['type'], React.ElementType> = {
  text: Type,
  image: Type, // image 셀은 저장 불가이므로 실제로 표시되지 않음
  video: Video,
  input: PenLine,
  checkbox: CheckSquare,
  radio: Circle,
  select: ChevronDown,
  ranking: ListOrdered,
  ranking_opt: ListOrdered,
};

interface SaveCellModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  cell: TableCell | null;
}

export function SaveCellModal({ open, onOpenChange, cell }: SaveCellModalProps) {
  const [name, setName] = useState('');
  const saveCell = useSaveCell();

  // 모달 열릴 때 기본 이름 설정
  useEffect(() => {
    if (open && cell) {
      const preview = getCellPreviewText(cell);
      const defaultName = preview.length > 0 ? preview.slice(0, 20) : CELL_TYPE_LABELS[cell.type];
      setName(defaultName);
    }
  // deps 를 cell?.id 로 좁힘 — cell reference 가 바뀌어도 사용자가 수정 중인 이름이
  // 자동 생성 값으로 reset 되지 않도록 한다.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, cell?.id]);

  const handleSave = async () => {
    if (!cell || !name.trim()) return;

    await saveCell.mutateAsync({ cell, name: name.trim() });
    onOpenChange(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && name.trim()) {
      e.preventDefault();
      handleSave();
    }
  };

  if (!cell) return null;

  const Icon = cellTypeIcons[cell.type];
  const previewText = getCellPreviewText(cell);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[400px]">
        <DialogHeader>
          <DialogTitle className="text-base">셀 보관하기</DialogTitle>
          <DialogDescription className="sr-only">셀을 보관함에 저장합니다</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* 셀 타입 미리보기 */}
          <div className="overflow-hidden rounded-lg border bg-gray-50 p-3">
            <div className="flex items-center gap-2">
              <Icon className="h-4 w-4 shrink-0 text-gray-500" />
              <span className="text-sm font-medium text-gray-700">
                {CELL_TYPE_LABELS[cell.type]}
              </span>
            </div>
            {previewText && (
              <p className="mt-1.5 line-clamp-2 break-all text-xs text-gray-500">
                {previewText}
              </p>
            )}
          </div>

          {/* 이름 입력 */}
          <div className="space-y-1.5">
            <Label htmlFor="cell-name">이름</Label>
            <Input
              id="cell-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="셀 이름을 입력하세요"
              autoFocus
            />
          </div>

          {/* 버튼 */}
          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
              취소
            </Button>
            <Button
              size="sm"
              onClick={handleSave}
              disabled={!name.trim() || saveCell.isPending}
            >
              <Save className="mr-1.5 h-3.5 w-3.5" />
              {saveCell.isPending ? '저장 중...' : '저장'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
