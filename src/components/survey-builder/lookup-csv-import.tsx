'use client';

import { useState, type ChangeEvent } from 'react';
import ExcelJS from 'exceljs';

import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { parseNumericInput } from '@/utils/numeric-input';

type Step = 'pick-file' | 'map-columns' | 'preview' | 'done';

interface ImportResult {
  keyColumns: string[];
  valueColumns: string[];
  rows: Array<Record<string, string | number>>;
}

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onImport: (result: ImportResult) => void;
}

export function LookupCsvImport({ isOpen, onClose, onImport }: Props) {
  const [step, setStep] = useState<Step>('pick-file');
  const [headers, setHeaders] = useState<string[]>([]);
  const [rawRows, setRawRows] = useState<string[][]>([]);
  const [selectedKeys, setSelectedKeys] = useState<string[]>([]);
  const [selectedValues, setSelectedValues] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setStep('pick-file');
    setHeaders([]); setRawRows([]);
    setSelectedKeys([]); setSelectedValues([]);
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
          allRows.push((row.values as unknown[]).slice(1).map((v) => String(v ?? '').trim()));
        });
        parsed = { headers: allRows[0] ?? [], rows: allRows.slice(1) };
      }
      setHeaders(parsed.headers);
      setRawRows(parsed.rows);
      setStep('map-columns');
    } catch (err) {
      setError(`파일 읽기 실패: ${(err as Error).message}`);
    }
  };

  const handleConfirmMapping = () => {
    if (selectedKeys.length === 0) { setError('키 컬럼을 1개 이상 선택하세요'); return; }
    if (selectedValues.length === 0) { setError('값 컬럼을 1개 이상 선택하세요'); return; }
    const overlap = selectedValues.find((v) => selectedKeys.includes(v));
    if (overlap) { setError(`"${overlap}" 는 키 컬럼이면서 값 컬럼이 될 수 없습니다`); return; }
    setError(null);
    setStep('preview');
  };

  const buildResult = (): ImportResult | null => {
    const rows: Array<Record<string, string | number>> = [];
    for (const [i, raw] of rawRows.entries()) {
      const row: Record<string, string | number> = {};
      for (const k of selectedKeys) {
        const idx = headers.indexOf(k);
        const v = String(raw[idx] ?? '').trim();
        if (!v) { setError(`${i + 1}행: 키 ${k} 가 비어있습니다`); return null; }
        row[k] = v;
      }
      for (const v of selectedValues) {
        const vIdx = headers.indexOf(v);
        const numeric = parseNumericInput(String(raw[vIdx] ?? ''));
        if (numeric === null) { setError(`${i + 1}행: ${v} 가 숫자가 아닙니다`); return null; }
        row[v] = numeric;
      }
      rows.push(row);
    }
    return { keyColumns: selectedKeys, valueColumns: selectedValues, rows };
  };

  const handleConfirmPreview = () => {
    const result = buildResult();
    if (!result) return;
    onImport(result);
    reset();
    onClose();
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => { if (!open) { reset(); onClose(); } }}>
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
              <Label>키 컬럼 (다중 선택)</Label>
              <div className="flex flex-wrap gap-2 mt-1">
                {headers.map((h) => (
                  <label key={h} className="flex items-center gap-1 text-sm">
                    <input
                      type="checkbox"
                      checked={selectedKeys.includes(h)}
                      onChange={(e) => {
                        setSelectedKeys(
                          e.target.checked
                            ? [...selectedKeys, h]
                            : selectedKeys.filter((k) => k !== h),
                        );
                      }}
                    />
                    {h}
                  </label>
                ))}
              </div>
            </div>
            <div>
              <Label>값 컬럼 (다중 선택)</Label>
              <div className="flex flex-wrap gap-2 mt-1">
                {headers.map((h) => (
                  <label key={h} className="flex items-center gap-1 text-sm">
                    <input
                      type="checkbox"
                      checked={selectedValues.includes(h)}
                      onChange={(e) => {
                        setSelectedValues(
                          e.target.checked
                            ? [...selectedValues, h]
                            : selectedValues.filter((v) => v !== h),
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
            <table className="w-full text-sm border-collapse border">
              <thead>
                <tr>
                  {[...selectedKeys, ...selectedValues].map((c) => (
                    <th key={c} className="border px-2 py-1 bg-gray-50">{c}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rawRows.slice(0, 10).map((r, i) => (
                  <tr key={i}>
                    {[...selectedKeys, ...selectedValues].map((c) => (
                      <td key={c} className="border px-2 py-1">{r[headers.indexOf(c)] ?? ''}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
            {rawRows.length > 10 && <div className="text-xs text-gray-500">처음 10행만 표시</div>}
          </div>
        )}

        {error && <div className="text-red-600 text-sm">{error}</div>}

        <DialogFooter>
          {step === 'pick-file' && <Button variant="ghost" onClick={onClose}>취소</Button>}
          {step === 'map-columns' && (
            <>
              <Button variant="ghost" onClick={() => setStep('pick-file')}>이전</Button>
              <Button onClick={handleConfirmMapping}>다음</Button>
            </>
          )}
          {step === 'preview' && (
            <>
              <Button variant="ghost" onClick={() => setStep('map-columns')}>이전</Button>
              <Button onClick={handleConfirmPreview}>적용</Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
