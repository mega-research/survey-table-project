'use client';

import { Plus, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { EMPTY_LOOKUPS } from '@/features/survey-builder/lookup/lookup-shared';
import { LookupSelector } from '@/features/survey-builder/lookup/lookup-selector';
import { useSurveyBuilderStore } from '@/features/survey-builder/stores/survey-store';
import type { CellLookupFill, CellLookupSearch, TableRow } from '@/types/survey';

import { listLookupFillTargets } from './utils/lookup-fill-targets';

const EMPTY_FILLS: CellLookupFill[] = [];

/**
 * 입력 칸 「목록에서 찾기」 설정 — 참조표·표시 열·함께 채울 칸.
 * 응답 화면 동작은 features/question-renderer/utils/lookup-search.
 */
export function LookupSearchFields({
  value,
  onChange,
  rows,
  cellId,
  locked,
}: {
  value: CellLookupSearch | null;
  onChange: (next: CellLookupSearch | null) => void;
  /** 이 칸이 속한 표의 행 — 채울 칸 후보 */
  rows: readonly TableRow[];
  cellId: string;
  /** 숫자·형식 모드 — 평문 칸에서만 동작한다 */
  locked: boolean;
}) {
  const lookups = useSurveyBuilderStore((s) => s.currentSurvey.lookups) ?? EMPTY_LOOKUPS;
  const enabled = value !== null;
  const lookup = value ? lookups.find((l) => l.id === value.lookupId) : undefined;
  const columns = lookup?.columns ?? [];
  const fills = value?.fills ?? EMPTY_FILLS;
  const targets = listLookupFillTargets(rows, cellId);

  const update = (patch: Partial<CellLookupSearch>) => {
    if (!value) return;
    onChange({ ...value, ...patch });
  };
  const updateFill = (index: number, patch: Partial<CellLookupFill>) =>
    update({ fills: fills.map((fill, i) => (i === index ? { ...fill, ...patch } : fill)) });

  return (
    <div className="space-y-3 rounded-md border border-gray-200 p-3">
      <div className="flex items-start justify-between gap-4">
        <div>
          <Label htmlFor="input-lookup-search" className="text-sm font-medium">
            목록에서 찾기
          </Label>
          <p className="mt-0.5 text-xs text-gray-500">
            응답자가 글자를 치면 참조표(LUT)에서 후보를 띄우고, 고르면 이 칸과 아래에 지정한 칸을
            채웁니다. 목록에 없는 값도 직접 적을 수 있습니다
          </p>
          {locked && (
            <p className="mt-1 text-xs text-amber-700">
              숫자·입력 형식 칸에서는 쓸 수 없습니다. 입력 형식을 일반 텍스트로 두세요
            </p>
          )}
        </div>
        <Switch
          id="input-lookup-search"
          checked={enabled}
          disabled={locked && !enabled}
          onCheckedChange={(on) =>
            onChange(on ? { lookupId: '', labelColumn: '', fills: [] } : null)
          }
        />
      </div>

      {enabled && value && (
        <div className="space-y-3">
          <div className="space-y-1">
            <Label className="text-xs text-gray-600">참조표</Label>
            <LookupSelector
              value={value.lookupId}
              // 다른 참조표로 바꾸면 열 이름이 달라지므로 열 선택을 비운다
              onChange={(id) => onChange({ lookupId: id, labelColumn: '', fills: [] })}
            />
          </div>

          {lookup && (
            <>
              <div className="space-y-1">
                <Label className="text-xs text-gray-600">후보로 보일 열 (이 칸에 들어갈 값)</Label>
                <Select
                  value={value.labelColumn}
                  onValueChange={(column) => update({ labelColumn: column })}
                >
                  <SelectTrigger aria-label="후보로 보일 열">
                    <SelectValue placeholder="열 선택" />
                  </SelectTrigger>
                  <SelectContent>
                    {columns.map((column) => (
                      <SelectItem key={column} value={column}>
                        {column}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label className="text-xs text-gray-600">함께 채울 칸 (같은 표의 입력 칸)</Label>
                {fills.map((fill, index) => (
                  <div key={index} className="flex items-center gap-2">
                    <Select
                      value={fill.column}
                      onValueChange={(column) => updateFill(index, { column })}
                    >
                      <SelectTrigger className="flex-1" aria-label={`채울 값 ${index + 1}`}>
                        <SelectValue placeholder="참조표 열" />
                      </SelectTrigger>
                      <SelectContent>
                        {columns.map((column) => (
                          <SelectItem key={column} value={column}>
                            {column}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <span className="text-xs text-gray-400">→</span>
                    <Select
                      value={fill.cellId}
                      onValueChange={(target) => updateFill(index, { cellId: target })}
                    >
                      <SelectTrigger className="flex-1" aria-label={`채울 칸 ${index + 1}`}>
                        <SelectValue placeholder="채울 칸" />
                      </SelectTrigger>
                      <SelectContent>
                        {targets.map((target) => (
                          <SelectItem key={target.cellId} value={target.cellId}>
                            {target.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      aria-label={`채울 칸 ${index + 1} 삭제`}
                      onClick={() => update({ fills: fills.filter((_, i) => i !== index) })}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => update({ fills: [...fills, { column: '', cellId: '' }] })}
                >
                  <Plus className="mr-1 h-4 w-4" />
                  채울 칸 추가
                </Button>
                <p className="text-xs text-gray-500">
                  고를 때마다 덮어씁니다. 참조표 값이 비어 있으면 칸을 비웁니다. 번호 형식 칸은
                  형식대로 정돈됩니다
                </p>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
