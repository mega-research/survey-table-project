'use client';

import { useState, useCallback } from 'react';

import { ClipboardPaste, Plus, Trash2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { SavedLookup } from '@/types/survey';
import { parseNumericInput } from '@/utils/numeric-input';

type LookupDraft = Pick<
  SavedLookup,
  'name' | 'description' | 'category' | 'tags' | 'keyColumns' | 'valueColumns' | 'rows'
>;

interface Props {
  isOpen: boolean;
  initialValue?: Partial<LookupDraft>;
  onClose: () => void;
  onSave: (draft: LookupDraft) => Promise<void> | void;
}

export function LookupEditModal({ isOpen, initialValue, onClose, onSave }: Props) {
  const [name, setName] = useState(initialValue?.name ?? '');
  const [description, setDescription] = useState(initialValue?.description ?? '');
  const [category, setCategory] = useState(initialValue?.category ?? 'custom');
  const [keyColumns, setKeyColumns] = useState<string[]>(initialValue?.keyColumns ?? ['키']);
  const [valueColumns, setValueColumns] = useState<string[]>(
    initialValue?.valueColumns ?? ['값'],
  );
  const [rows, setRows] = useState<Array<Record<string, string | number>>>(
    initialValue?.rows ?? [],
  );
  const [error, setError] = useState<string | null>(null);

  const allColumns = [...keyColumns, ...valueColumns];

  const handleAddRow = () => {
    const empty: Record<string, string | number> = {};
    allColumns.forEach((c) => (empty[c] = ''));
    setRows([...rows, empty]);
  };

  const handleCellChange = (rowIdx: number, col: string, value: string) => {
    const next = [...rows];
    next[rowIdx] = { ...next[rowIdx], [col]: value };
    setRows(next);
  };

  const handleDeleteRow = (rowIdx: number) => {
    setRows(rows.filter((_, i) => i !== rowIdx));
  };

  const handlePaste = useCallback(
    (e: React.ClipboardEvent) => {
      e.preventDefault();
      const text = e.clipboardData.getData('text/plain');
      const lines = text.split(/\r?\n/).filter((l) => l.trim() !== '');
      const parsed = lines.map((line) => {
        const cells = line.split('\t');
        const row: Record<string, string | number> = {};
        allColumns.forEach((col, idx) => {
          row[col] = cells[idx] ?? '';
        });
        return row;
      });
      setRows([...rows, ...parsed]);
    },
    [rows, allColumns],
  );

  const validate = (): string | null => {
    if (!name.trim()) return '이름을 입력하세요';
    if (keyColumns.length === 0 || keyColumns.some((k) => !k.trim()))
      return '키 컬럼 이름을 모두 입력하세요';
    if (valueColumns.length === 0 || valueColumns.some((v) => !v.trim()))
      return '값 컬럼 이름을 모두 입력하세요';
    // 중복 컬럼명 금지 (키/값 어느 쪽이든)
    const seen = new Set<string>();
    for (const c of allColumns) {
      const t = c.trim();
      if (seen.has(t)) return `컬럼 이름 "${t}" 가 중복됩니다`;
      seen.add(t);
    }
    if (rows.length === 0) return '최소 한 개의 행이 필요합니다';
    for (const [i, r] of rows.entries()) {
      for (const k of keyColumns) {
        if (!String(r[k] ?? '').trim()) return `${i + 1}행: ${k} 가 비어있습니다`;
      }
      for (const v of valueColumns) {
        const parsed = parseNumericInput(String(r[v] ?? ''));
        if (parsed === null) return `${i + 1}행: ${v} 가 숫자가 아닙니다`;
      }
    }
    return null;
  };

  const handleSave = async () => {
    const err = validate();
    if (err) {
      setError(err);
      return;
    }
    setError(null);
    // 직렬화: 키 컬럼 string, 값 컬럼 number (모든 값 컬럼)
    const normalizedRows = rows.map((r) => {
      const out: Record<string, string | number> = {};
      for (const k of keyColumns) out[k] = String(r[k] ?? '').trim();
      for (const v of valueColumns) {
        out[v] = parseNumericInput(String(r[v] ?? ''))!;
      }
      return out;
    });
    await onSave({
      name: name.trim(),
      description: description.trim() || undefined,
      category,
      tags: initialValue?.tags ?? [],
      keyColumns: keyColumns.map((k) => k.trim()),
      valueColumns: valueColumns.map((v) => v.trim()),
      rows: normalizedRows,
    });
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>외부 데이터 LUT 편집</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <Label>이름</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </div>

          <div>
            <Label>설명</Label>
            <Input value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>키 컬럼</Label>
              <div className="flex flex-wrap gap-2">
                {keyColumns.map((k, i) => (
                  <div key={i} className="flex items-center gap-1">
                    <Input
                      value={k}
                      onChange={(e) => {
                        const next = [...keyColumns];
                        next[i] = e.target.value;
                        setKeyColumns(next);
                      }}
                      className="w-32"
                    />
                    {keyColumns.length > 1 && (
                      <button
                        onClick={() => setKeyColumns(keyColumns.filter((_, idx) => idx !== i))}
                        className="text-gray-400 hover:text-red-500"
                        aria-label="키 컬럼 삭제"
                      >
                        <Trash2 size={14} />
                      </button>
                    )}
                  </div>
                ))}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    setKeyColumns([...keyColumns, `키${keyColumns.length + 1}`])
                  }
                >
                  키 컬럼 추가
                </Button>
              </div>
            </div>
            <div>
              <Label>값 컬럼</Label>
              <div className="flex flex-wrap gap-2">
                {valueColumns.map((v, i) => (
                  <div key={i} className="flex items-center gap-1">
                    <Input
                      value={v}
                      onChange={(e) => {
                        const next = [...valueColumns];
                        next[i] = e.target.value;
                        setValueColumns(next);
                      }}
                      className="w-32"
                    />
                    {valueColumns.length > 1 && (
                      <button
                        onClick={() =>
                          setValueColumns(valueColumns.filter((_, idx) => idx !== i))
                        }
                        className="text-gray-400 hover:text-red-500"
                        aria-label="값 컬럼 삭제"
                      >
                        <Trash2 size={14} />
                      </button>
                    )}
                  </div>
                ))}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    setValueColumns([...valueColumns, `값${valueColumns.length + 1}`])
                  }
                >
                  값 컬럼 추가
                </Button>
              </div>
            </div>
          </div>

          <div onPaste={handlePaste}>
            <table className="w-full border-collapse">
              <thead>
                <tr>
                  {allColumns.map((c) => (
                    <th key={c} className="border bg-gray-50 px-2 py-1 text-sm">
                      {c}
                    </th>
                  ))}
                  <th className="w-10 border px-2 py-1"></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, ri) => (
                  <tr key={ri}>
                    {allColumns.map((c) => (
                      <td key={c} className="border p-0">
                        <Input
                          value={String(row[c] ?? '')}
                          onChange={(e) => handleCellChange(ri, c, e.target.value)}
                          className="h-8 rounded-none border-0"
                        />
                      </td>
                    ))}
                    <td className="border text-center">
                      <button
                        onClick={() => handleDeleteRow(ri)}
                        className="text-gray-400 hover:text-red-500"
                        aria-label="행 삭제"
                      >
                        <Trash2 size={14} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="mt-2 flex gap-2">
              <Button variant="outline" size="sm" onClick={handleAddRow}>
                <Plus size={14} className="mr-1" /> 행 추가
              </Button>
              <span className="flex items-center gap-1 self-center text-xs text-gray-500">
                <ClipboardPaste size={12} />
                엑셀 영역을 복사 후 표 위에 붙여넣으면 자동 채워집니다.
              </span>
            </div>
          </div>

          {error && <div className="text-sm text-red-600">{error}</div>}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            취소
          </Button>
          <Button onClick={handleSave}>저장</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
