'use client';

import { useState } from 'react';

import type { Editor } from '@tiptap/react';
import { Table as TableIcon } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

const GRID_SIZE = 6;
const MAX_DIALOG = 50;
const MIN_DIALOG = 1;

interface Props {
  editor: Editor;
}

export function TableInsertMenu({ editor }: Props) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<'grid' | 'dialog'>('grid');
  const [hoverRows, setHoverRows] = useState(0);
  const [hoverCols, setHoverCols] = useState(0);
  const [dialogRows, setDialogRows] = useState(5);
  const [dialogCols, setDialogCols] = useState(5);

  function resetState() {
    setMode('grid');
    setHoverRows(0);
    setHoverCols(0);
    setDialogRows(5);
    setDialogCols(5);
  }

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (!next) resetState();
  }

  function insertTable(rows: number, cols: number) {
    if (rows <= 0 || cols <= 0) return;
    editor
      .chain()
      .focus()
      .insertTable({ rows, cols, withHeaderRow: false })
      .run();
    setOpen(false);
    resetState();
  }

  function handleGridClick(r: number, c: number) {
    if (r === 0 || c === 0) return;
    insertTable(r, c);
  }

  function handleDialogInsert() {
    const r = Math.min(MAX_DIALOG, Math.max(MIN_DIALOG, dialogRows));
    const c = Math.min(MAX_DIALOG, Math.max(MIN_DIALOG, dialogCols));
    insertTable(r, c);
  }

  const dialogValid =
    dialogRows >= MIN_DIALOG &&
    dialogRows <= MAX_DIALOG &&
    dialogCols >= MIN_DIALOG &&
    dialogCols <= MAX_DIALOG;

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <Button type="button" variant="ghost" size="sm" title="표 삽입">
          <TableIcon className="h-4 w-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[260px] p-3" align="start">
        {mode === 'grid' ? (
          <>
            <div className="mb-2 flex items-center justify-between text-xs">
              <span className="font-medium text-gray-800">
                표 삽입 {hoverRows > 0 && hoverCols > 0 ? `${hoverRows}×${hoverCols}` : ''}
              </span>
              <button
                type="button"
                className="text-gray-500 underline hover:text-gray-700"
                onClick={() => setMode('dialog')}
              >
                세부 설정
              </button>
            </div>
            <div
              className="grid gap-[3px]"
              style={{ gridTemplateColumns: `repeat(${GRID_SIZE}, 24px)` }}
              onMouseLeave={() => {
                setHoverRows(0);
                setHoverCols(0);
              }}
            >
              {Array.from({ length: GRID_SIZE * GRID_SIZE }).map((_, i) => {
                const r = Math.floor(i / GRID_SIZE) + 1;
                const c = (i % GRID_SIZE) + 1;
                const selected = r <= hoverRows && c <= hoverCols;
                return (
                  <button
                    key={i}
                    type="button"
                    className={
                      'h-6 w-6 rounded-sm border ' +
                      (selected
                        ? 'border-blue-400 bg-blue-100'
                        : 'border-gray-300 bg-white hover:border-gray-400')
                    }
                    onMouseEnter={() => {
                      setHoverRows(r);
                      setHoverCols(c);
                    }}
                    onClick={() => handleGridClick(r, c)}
                  />
                );
              })}
            </div>
          </>
        ) : (
          <div className="space-y-3">
            <div className="flex items-center justify-between text-xs">
              <span className="font-medium text-gray-800">세부 설정</span>
              <button
                type="button"
                className="text-gray-500 underline hover:text-gray-700"
                onClick={() => setMode('grid')}
              >
                ← 그리드로
              </button>
            </div>
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Label htmlFor="rows" className="w-10 text-xs">행</Label>
                <Input
                  id="rows"
                  type="number"
                  min={MIN_DIALOG}
                  max={MAX_DIALOG}
                  value={dialogRows}
                  onChange={(e) => setDialogRows(Number(e.target.value) || 0)}
                  className="h-8 w-20"
                />
              </div>
              <div className="flex items-center gap-2">
                <Label htmlFor="cols" className="w-10 text-xs">열</Label>
                <Input
                  id="cols"
                  type="number"
                  min={MIN_DIALOG}
                  max={MAX_DIALOG}
                  value={dialogCols}
                  onChange={(e) => setDialogCols(Number(e.target.value) || 0)}
                  className="h-8 w-20"
                />
              </div>
            </div>
            <Button
              type="button"
              size="sm"
              className="w-full"
              disabled={!dialogValid}
              onClick={handleDialogInsert}
            >
              삽입
            </Button>
            <p className="text-[10px] text-gray-500">
              {MIN_DIALOG}~{MAX_DIALOG} 범위
            </p>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
