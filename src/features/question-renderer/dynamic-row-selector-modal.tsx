'use client';

import { useCallback, useState } from 'react';

import { Check, ListChecks } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { TableRow } from '@/types/survey';

interface DynamicRowSelectorModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  dynamicRows: TableRow[];
  selectedRowIds: string[];
  onConfirm: (rowIds: string[]) => void;
  label?: string | undefined;
}

export function DynamicRowSelectorModal({
  open,
  onOpenChange,
  dynamicRows,
  selectedRowIds,
  onConfirm,
  label,
}: DynamicRowSelectorModalProps) {
  const [localSelected, setLocalSelected] = useState<Set<string>>(new Set(selectedRowIds));

  // 모달 열릴 때 외부 상태 동기화
  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      if (nextOpen) {
        setLocalSelected(new Set(selectedRowIds));
      }
      onOpenChange(nextOpen);
    },
    [selectedRowIds, onOpenChange],
  );

  const toggleRow = useCallback((rowId: string) => {
    setLocalSelected((prev) => {
      const next = new Set(prev);
      if (next.has(rowId)) {
        next.delete(rowId);
      } else {
        next.add(rowId);
      }
      return next;
    });
  }, []);

  const toggleAll = useCallback(() => {
    setLocalSelected((prev) => {
      if (prev.size === dynamicRows.length) {
        return new Set();
      }
      return new Set(dynamicRows.map((r) => r.id));
    });
  }, [dynamicRows]);

  const handleConfirm = useCallback(() => {
    onConfirm(Array.from(localSelected));
    onOpenChange(false);
  }, [localSelected, onConfirm, onOpenChange]);

  const allSelected = localSelected.size === dynamicRows.length;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="flex max-h-[85vh] max-w-md flex-col gap-0 overflow-hidden p-0">
        <DialogHeader className="p-6 pb-3">
          <DialogTitle className="flex items-center gap-2">
            <ListChecks className="h-5 w-5" />
            {label || '항목 선택'}
          </DialogTitle>
          <DialogDescription asChild>
            <div className="text-sm text-muted-foreground">
              테이블에 표시할 항목을 선택하세요.
              <Badge variant="secondary" className="ml-2">
                {localSelected.size}개 선택
              </Badge>
            </div>
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 space-y-1 overflow-y-scroll px-6 py-1 [scrollbar-gutter:stable] [&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-gray-300 [&::-webkit-scrollbar-track]:bg-transparent hover:[&::-webkit-scrollbar-thumb]:bg-gray-400">
          {/* 전체 선택/해제 */}
          <label className="flex cursor-pointer items-center gap-3 rounded-md border-b px-3 py-2.5 font-medium hover:bg-accent/50">
            <Checkbox
              checked={allSelected}
              onCheckedChange={toggleAll}
            />
            <span className="text-sm">전체 선택</span>
            {allSelected && <Check className="ml-auto h-4 w-4 text-primary" />}
          </label>

          {/* 개별 항목 */}
          {dynamicRows.map((row) => {
            const isChecked = localSelected.has(row.id);
            return (
              <label
                key={row.id}
                className="flex cursor-pointer items-center gap-3 rounded-md px-3 py-2 hover:bg-accent/50"
              >
                <Checkbox
                  checked={isChecked}
                  onCheckedChange={() => toggleRow(row.id)}
                />
                <span className="text-sm">{row.label}</span>
              </label>
            );
          })}
        </div>

        <DialogFooter className="border-t bg-background px-6 py-4">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            취소
          </Button>
          <Button onClick={handleConfirm}>
            확인 ({localSelected.size}개)
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
