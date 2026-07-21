'use client';

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
        <Label className="text-sm font-medium">모바일 표시 방식</Label>
        <p className="text-xs text-gray-500">
          원본 배치가 중요한 척도형 표의 모바일 탐색 방식을 선택합니다.
        </p>
      </div>
      <div className="grid gap-2 sm:grid-cols-3">
        {OPTIONS.map((option) => (
          <button
            key={option.value}
            type="button"
            aria-label={option.label}
            aria-pressed={mode === option.value}
            onClick={() => onChange({ mode: option.value, omitLeadingColumns: normalizedCount })}
            className={cn(
              'rounded-lg border p-3 text-left',
              mode === option.value ? 'border-blue-500 bg-blue-50' : 'border-gray-200 bg-white',
            )}
          >
            <span className="block text-sm font-semibold text-gray-900">{option.label}</span>
            <span className="mt-1 block text-xs text-gray-500">{option.description}</span>
          </button>
        ))}
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
