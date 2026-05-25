'use client';

import { useCallback, useState } from 'react';

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

type LookupDraft = Pick<
  SavedLookup,
  'name' | 'description' | 'category' | 'tags' | 'columns' | 'rows'
>;

interface Props {
  isOpen: boolean;
  initialValue?: Partial<LookupDraft>;
  onClose: () => void;
  onSave: (draft: LookupDraft) => Promise<void> | void;
}

/**
 * LUT 편집 모달.
 * 컬럼 정의 + 행 데이터만 다룬다. 어떤 컬럼이 키이고 어떤 컬럼이 비교 값인지는
 * 조건 에디터(RightOperand.lookup) 가 결정하므로 여기서는 구분하지 않는다.
 */
export function LookupEditModal({ isOpen, initialValue, onClose, onSave }: Props) {
  const [name, setName] = useState(initialValue?.name ?? '');
  const [description, setDescription] = useState(initialValue?.description ?? '');
  const [category] = useState(initialValue?.category ?? 'custom');
  const [columns, setColumns] = useState<string[]>(
    initialValue?.columns ?? ['컬럼1', '컬럼2'],
  );
  const [rows, setRows] = useState<Array<Record<string, string | number>>>(
    initialValue?.rows ?? [],
  );
  const [error, setError] = useState<string | null>(null);

  const handleAddRow = () => {
    const empty: Record<string, string | number> = {};
    columns.forEach((c) => (empty[c] = ''));
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

  // 컬럼명 변경 시 rows 안의 기존 키도 새 키로 옮겨서 데이터 손실 방지.
  const handleColumnRename = (idx: number, newName: string) => {
    const oldName = columns[idx];
    const next = [...columns];
    next[idx] = newName;
    setColumns(next);
    if (oldName === newName) return;
    setRows(
      rows.map((r) => {
        if (!(oldName in r)) return r;
        const { [oldName]: v, ...rest } = r;
        return { ...rest, [newName]: v };
      }),
    );
  };

  // 컬럼 삭제 시 rows 안의 해당 키도 제거.
  const handleColumnDelete = (idx: number) => {
    const removed = columns[idx];
    setColumns(columns.filter((_, i) => i !== idx));
    setRows(
      rows.map((r) => {
        if (!(removed in r)) return r;
        const next: Record<string, string | number> = { ...r };
        delete next[removed];
        return next;
      }),
    );
  };

  const handleAddColumn = () => {
    setColumns([...columns, `컬럼${columns.length + 1}`]);
  };

  const handlePaste = useCallback(
    (e: React.ClipboardEvent) => {
      e.preventDefault();
      const text = e.clipboardData.getData('text/plain');
      const lines = text.split(/\r?\n/).filter((l) => l.trim() !== '');
      const parsed = lines.map((line) => {
        const cells = line.split('\t');
        const row: Record<string, string | number> = {};
        columns.forEach((col, idx) => {
          row[col] = cells[idx] ?? '';
        });
        return row;
      });
      setRows([...rows, ...parsed]);
    },
    [rows, columns],
  );

  const validate = (): string | null => {
    if (!name.trim()) return '이름을 입력하세요';
    if (columns.length === 0 || columns.some((c) => !c.trim()))
      return '컬럼 이름을 모두 입력하세요';
    // 컬럼명 중복 금지
    const seen = new Set<string>();
    for (const c of columns) {
      const t = c.trim();
      if (seen.has(t)) return `컬럼 이름 "${t}" 가 중복됩니다`;
      seen.add(t);
    }
    if (rows.length === 0) return '최소 한 개의 행이 필요합니다';
    return null;
  };

  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    const err = validate();
    if (err) {
      setError(err);
      return;
    }
    setError(null);
    // 직렬화: 각 셀은 입력한 문자열 그대로 저장 (숫자 파싱은 비교 시점에).
    // 비교 시점에 evaluateRightOperand 에서 Number() 변환.
    const normalizedRows = rows.map((r) => {
      const out: Record<string, string | number> = {};
      for (const c of columns) out[c] = String(r[c] ?? '').trim();
      return out;
    });
    setSaving(true);
    try {
      await onSave({
        name: name.trim(),
        description: description.trim() || undefined,
        category,
        tags: initialValue?.tags ?? [],
        columns: columns.map((c) => c.trim()),
        rows: normalizedRows,
      });
    } catch (e) {
      setError((e as Error).message ?? '저장에 실패했습니다');
    } finally {
      setSaving(false);
    }
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

          <div onPaste={handlePaste}>
            <div className="text-muted-foreground mb-2 text-xs">
              어떤 컬럼이 키(매칭용) 이고 어떤 컬럼이 값(비교 대상) 인지는
              조건 표시 편집에서 정합니다. 여기서는 표 구조만 정의하세요.
            </div>
            <table className="w-full border-collapse">
              <thead>
                <tr>
                  {columns.map((c, ci) => (
                    <th key={ci} className="border bg-gray-50 p-0">
                      <div className="flex items-center gap-1 pr-1">
                        <Input
                          value={c}
                          onChange={(e) => handleColumnRename(ci, e.target.value)}
                          className="h-8 rounded-none border-0 bg-transparent text-sm font-semibold"
                          aria-label={`컬럼 ${ci + 1} 이름`}
                        />
                        {columns.length > 1 && (
                          <button
                            onClick={() => handleColumnDelete(ci)}
                            className="shrink-0 text-gray-400 hover:text-red-500"
                            aria-label="열 삭제"
                          >
                            <Trash2 size={12} />
                          </button>
                        )}
                      </div>
                    </th>
                  ))}
                  <th className="w-10 border px-2 py-1"></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, ri) => (
                  <tr key={ri}>
                    {columns.map((c, ci) => (
                      <td key={ci} className="border p-0">
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
            <div className="mt-2 flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={handleAddColumn}>
                <Plus size={14} className="mr-1" /> 열 추가
              </Button>
              <Button variant="outline" size="sm" onClick={handleAddRow}>
                <Plus size={14} className="mr-1" /> 행 추가
              </Button>
              <span className="ml-2 flex items-center gap-1 text-xs text-gray-500">
                <ClipboardPaste size={12} />
                엑셀 영역을 복사 후 표 위에 붙여넣으면 자동 채워집니다.
              </span>
            </div>
          </div>

          {error && <div className="text-sm text-red-600">{error}</div>}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            취소
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? '저장 중…' : '저장'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
