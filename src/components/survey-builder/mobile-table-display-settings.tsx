'use client';

import { Check } from 'lucide-react';

import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import type { MobileTableDisplayMode } from '@/types/mobile-table-display';
import { clampMobileDrilldownOmitLeadingColumns } from '@/utils/mobile-table-display-mode';

interface MobileTableDisplaySettingsProps {
  mode: MobileTableDisplayMode;
  omitLeadingColumns: number;
  columnCount: number;
  onChange: (value: { mode: MobileTableDisplayMode; omitLeadingColumns: number }) => void;
}

const OPTIONS: Array<{ value: MobileTableDisplayMode; label: string; description: string }> = [
  { value: 'auto', label: '자동 카드', description: '표 구조에 따라 카드 또는 드릴다운으로 표시합니다.' },
  {
    value: 'drilldown-original-row',
    label: '드릴다운 후 선택 행 원본',
    description: '항목을 고른 뒤 선택한 행만 원본 열 배치로 표시합니다.',
  },
  { value: 'original', label: '전체 원본 표', description: '모바일에서도 표 전체를 가로 스크롤로 표시합니다.' },
];

export function MobileTableDisplaySettings({
  mode,
  omitLeadingColumns,
  columnCount,
  onChange,
}: MobileTableDisplaySettingsProps) {
  const normalizedCount = clampMobileDrilldownOmitLeadingColumns(omitLeadingColumns, columnCount);

  return (
    <div className="space-y-3 rounded-lg border border-gray-200 p-4">
      <div>
        <div id="mobile-table-display-mode-label" className="text-sm font-medium">
          모바일 표시 방식
        </div>
        <p className="text-xs text-gray-500">
          원본 배치가 중요한 척도형 표의 모바일 탐색 방식을 선택합니다.
        </p>
      </div>
      <div
        role="radiogroup"
        aria-labelledby="mobile-table-display-mode-label"
        className="grid gap-2 sm:grid-cols-3"
      >
        {OPTIONS.map((option) => {
          const selected = mode === option.value;

          return (
            <label
              key={option.value}
              className={cn(
                'cursor-pointer rounded-lg border p-3 text-left has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-blue-500 has-[:focus-visible]:ring-offset-2',
                selected ? 'border-blue-500 bg-blue-50' : 'border-gray-200 bg-white',
              )}
            >
              <input
                type="radio"
                name="mobile-table-display-mode"
                value={option.value}
                aria-label={option.label}
                checked={selected}
                onChange={() => onChange({
                  mode: option.value,
                  omitLeadingColumns: normalizedCount,
                })}
                className="sr-only"
              />
              <span className="block text-sm font-semibold text-gray-900">{option.label}</span>
              <span className="mt-1 block text-xs text-gray-500">{option.description}</span>
              <span
                aria-hidden="true"
                className="mt-2 inline-flex min-h-5 items-center gap-1 text-xs font-semibold text-blue-700"
              >
                {selected ? (
                  <>
                    <Check className="h-3.5 w-3.5" />
                    선택됨
                  </>
                ) : null}
              </span>
            </label>
          );
        })}
      </div>
      {mode === 'drilldown-original-row' ? (
        <div className="max-w-xs space-y-1.5">
          <Label htmlFor="mobile-drilldown-omit-leading">상세에서 제외할 앞쪽 열 수</Label>
          <Input
            id="mobile-drilldown-omit-leading"
            type="number"
            min={0}
            max={Math.max(0, columnCount - 1)}
            value={normalizedCount}
            onChange={(event) => onChange({
              mode,
              omitLeadingColumns: clampMobileDrilldownOmitLeadingColumns(
                Number(event.target.value),
                columnCount,
              ),
            })}
          />
        </div>
      ) : null}
    </div>
  );
}
