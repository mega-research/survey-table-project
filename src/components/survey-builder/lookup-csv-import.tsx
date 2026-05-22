'use client';

import { useState, type ChangeEvent } from 'react';

import ExcelJS from 'exceljs';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';

type Step = 'pick-file' | 'map-columns' | 'preview';

interface ImportResult {
  columns: string[];
  rows: Array<Record<string, string | number>>;
}

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onImport: (result: ImportResult) => void;
}

/**
 * 엑셀/CSV 에서 LUT 데이터 가져오기 마법사.
 * 키/값 구분은 이 단계에서 하지 않는다 — 가져온 컬럼을 다 살린 채 LUT 에 저장하고,
 * 조건 에디터에서 어떤 컬럼을 키/값으로 쓸지 결정한다.
 */
export function LookupCsvImport({ isOpen, onClose, onImport }: Props) {
  const [step, setStep] = useState<Step>('pick-file');
  const [headers, setHeaders] = useState<string[]>([]);
  const [rawRows, setRawRows] = useState<string[][]>([]);
  const [selectedColumns, setSelectedColumns] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setStep('pick-file');
    setHeaders([]);
    setRawRows([]);
    setSelectedColumns([]);
    setError(null);
  };

  const handleFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    try {
      let parsed: { headers: string[]; rows: string[][] };
      if (f.name.endsWith('.csv')) {
        const text = await f.text();
        const lines = text.split(/\r?\n/).filter((l) => l.trim());
        parsed = {
          headers: lines[0].split(',').map((s) => s.trim()),
          rows: lines.slice(1).map((l) => l.split(',').map((s) => s.trim())),
        };
      } else {
        const buf = await f.arrayBuffer();
        const wb = new ExcelJS.Workbook();
        await wb.xlsx.load(buf);
        const ws = wb.worksheets[0];
        const allRows: string[][] = [];
        ws.eachRow((row) => {
          allRows.push(
            (row.values as unknown[]).slice(1).map((v) => String(v ?? '').trim()),
          );
        });
        parsed = { headers: allRows[0] ?? [], rows: allRows.slice(1) };
      }
      setHeaders(parsed.headers);
      setRawRows(parsed.rows);
      // 디폴트: 모든 헤더 선택
      setSelectedColumns(parsed.headers);
      setStep('map-columns');
    } catch (err) {
      setError(`파일 읽기 실패: ${(err as Error).message}`);
    }
  };

  const handleConfirmMapping = () => {
    if (selectedColumns.length === 0) {
      setError('컬럼을 1개 이상 선택하세요');
      return;
    }
    setError(null);
    setStep('preview');
  };

  const buildResult = (): ImportResult => {
    const rows: Array<Record<string, string | number>> = [];
    for (const raw of rawRows) {
      const row: Record<string, string | number> = {};
      for (const c of selectedColumns) {
        const idx = headers.indexOf(c);
        row[c] = String(raw[idx] ?? '').trim();
      }
      rows.push(row);
    }
    return { columns: selectedColumns, rows };
  };

  const handleConfirmPreview = () => {
    const result = buildResult();
    onImport(result);
    reset();
    onClose();
  };

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) {
          reset();
          onClose();
        }
      }}
    >
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>엑셀 또는 CSV 에서 LUT 가져오기</DialogTitle>
        </DialogHeader>

        {step === 'pick-file' && (
          <div className="space-y-2">
            <Label>파일 선택 (xlsx 또는 csv)</Label>
            <input type="file" accept=".xlsx,.csv" onChange={handleFile} />
          </div>
        )}

        {step === 'map-columns' && (
          <div className="space-y-3">
            <div>
              <Label>가져올 컬럼 (체크 해제 시 제외)</Label>
              <div className="text-muted-foreground mb-1 text-xs">
                키/값 의미는 조건 표시 편집에서 정합니다. 여기서는 가져올 컬럼만 고르세요.
              </div>
              <div className="mt-1 flex flex-wrap gap-2">
                {headers.map((h) => (
                  <label key={h} className="flex items-center gap-1 text-sm">
                    <input
                      type="checkbox"
                      checked={selectedColumns.includes(h)}
                      onChange={(e) => {
                        setSelectedColumns(
                          e.target.checked
                            ? [...selectedColumns, h]
                            : selectedColumns.filter((c) => c !== h),
                        );
                      }}
                    />
                    {h}
                  </label>
                ))}
              </div>
            </div>
          </div>
        )}

        {step === 'preview' && (
          <div className="space-y-2">
            <Label>미리보기 ({rawRows.length} 행)</Label>
            <table className="w-full border-collapse border text-sm">
              <thead>
                <tr>
                  {selectedColumns.map((c) => (
                    <th key={c} className="border bg-gray-50 px-2 py-1">
                      {c}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rawRows.slice(0, 10).map((r, i) => (
                  <tr key={i}>
                    {selectedColumns.map((c) => (
                      <td key={c} className="border px-2 py-1">
                        {r[headers.indexOf(c)] ?? ''}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
            {rawRows.length > 10 && (
              <div className="text-xs text-gray-500">처음 10행만 표시</div>
            )}
          </div>
        )}

        {error && <div className="text-sm text-red-600">{error}</div>}

        <DialogFooter>
          {step === 'pick-file' && (
            <Button variant="ghost" onClick={onClose}>
              취소
            </Button>
          )}
          {step === 'map-columns' && (
            <>
              <Button variant="ghost" onClick={() => setStep('pick-file')}>
                이전
              </Button>
              <Button onClick={handleConfirmMapping}>다음</Button>
            </>
          )}
          {step === 'preview' && (
            <>
              <Button variant="ghost" onClick={() => setStep('map-columns')}>
                이전
              </Button>
              <Button onClick={handleConfirmPreview}>적용</Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
