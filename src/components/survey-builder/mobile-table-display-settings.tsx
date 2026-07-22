'use client';

import { useEffect, useState } from 'react';

import { Check } from 'lucide-react';

import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import type { MobileTableDisplayMode } from '@/types/mobile-table-display';
import {
  formatMobileDrilldownRepeatHeaderRange,
  parseMobileDrilldownRepeatHeaderText,
  resolveMobileDrilldownRepeatHeaderRange,
} from '@/utils/mobile-drilldown-repeat-header';
import { clampMobileDrilldownOmitLeadingColumns } from '@/utils/mobile-table-display-mode';

interface MobileTableDisplaySettingsValue {
  mode: MobileTableDisplayMode;
  omitLeadingColumns: number;
  repeatHeaderStartRow: number | null;
  repeatHeaderEndRow: number | null;
}

interface MobileTableDisplaySettingsProps {
  mode: MobileTableDisplayMode;
  omitLeadingColumns: number;
  columnCount: number;
  repeatHeaderStartRow?: number | null | undefined;
  repeatHeaderEndRow?: number | null | undefined;
  onChange: (value: MobileTableDisplaySettingsValue) => void;
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
  repeatHeaderStartRow,
  repeatHeaderEndRow,
  onChange,
}: MobileTableDisplaySettingsProps) {
  const normalizedCount = clampMobileDrilldownOmitLeadingColumns(omitLeadingColumns, columnCount);
  const committedRange = resolveMobileDrilldownRepeatHeaderRange({
    mobileDrilldownRepeatHeaderStartRow: repeatHeaderStartRow,
    mobileDrilldownRepeatHeaderEndRow: repeatHeaderEndRow,
  });
  const committedText = formatMobileDrilldownRepeatHeaderRange(committedRange);
  const [repeatHeaderDraft, setRepeatHeaderDraft] = useState(committedText);

  useEffect(() => {
    setRepeatHeaderDraft(committedText);
  }, [committedText]);

  const emit = (next: Partial<MobileTableDisplaySettingsValue>) => onChange({
    mode,
    omitLeadingColumns: normalizedCount,
    repeatHeaderStartRow: committedRange?.startRow ?? null,
    repeatHeaderEndRow: committedRange?.endRow ?? null,
    ...next,
  });

  const commitRepeatHeaderDraft = () => {
    const parsed = parseMobileDrilldownRepeatHeaderText(repeatHeaderDraft);
    if (!parsed.ok) {
      setRepeatHeaderDraft(committedText);
      return;
    }
    const nextText = formatMobileDrilldownRepeatHeaderRange(parsed.value);
    setRepeatHeaderDraft(nextText);
    emit({
      repeatHeaderStartRow: parsed.value?.startRow ?? null,
      repeatHeaderEndRow: parsed.value?.endRow ?? null,
    });
  };

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
                onChange={() => emit({ mode: option.value })}
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
        <div className="grid max-w-xl gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="mobile-drilldown-omit-leading">상세에서 제외할 앞쪽 열 수</Label>
            <Input
              id="mobile-drilldown-omit-leading"
              type="number"
              min={0}
              max={Math.max(0, columnCount - 1)}
              value={normalizedCount}
              onChange={(event) => emit({
                omitLeadingColumns: clampMobileDrilldownOmitLeadingColumns(
                  Number(event.target.value),
                  columnCount,
                ),
              })}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="mobile-drilldown-repeat-header">상세에서 반복할 헤더 행</Label>
            <Input
              id="mobile-drilldown-repeat-header"
              type="text"
              inputMode="text"
              value={repeatHeaderDraft}
              onChange={(event) => setRepeatHeaderDraft(event.target.value)}
              onBlur={commitRepeatHeaderDraft}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  commitRepeatHeaderDraft();
                }
              }}
            />
            <p className="text-xs text-gray-500">
              비우면 반복하지 않습니다. 0은 진짜 헤더이며, 3 또는 0-2처럼 입력합니다.
            </p>
          </div>
        </div>
      ) : null}
    </div>
  );
}
