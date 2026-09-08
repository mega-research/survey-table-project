'use client';

import { useMemo, useState } from 'react';

import { Repeat2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import {
  DEFAULT_ROW_REPEAT_ADD_LABEL,
  DEFAULT_ROW_REPEAT_MAX,
  ROW_REPEAT_MAX,
  clampMaxRepeats,
  collapseRepeatRows,
  isRowRepeatActive,
  validateRowRepeatTemplate,
} from '@/lib/question/row-repeat';
import type {
  RowRepeatConfig,
  SumConstraint,
  TableRow,
  TableValidationRule,
} from '@/types/survey';

interface RowRepeatSettingsCardProps {
  /** 편집기의 현재 행 (2벌 이후를 포함한 펼친 상태) */
  rows: TableRow[];
  config?: RowRepeatConfig | null | undefined;
  sumConstraints?: SumConstraint[] | null | undefined;
  tableValidationRules?: TableValidationRule[] | undefined;
  onChange?: ((config: RowRepeatConfig | null) => void) | undefined;
}

/**
 * 행 반복 설정 — 반복 단위가 될 연속 행 묶음과 최대 벌 수를 정한다.
 *
 * 편집 표는 1벌만 그리고, 2벌 이후는 저장 구조에만 존재한다. 최대 벌 수를 줄이거나
 * 반복을 끄면 뒤쪽 벌이 구조에서 걷히므로, 이미 수집된 응답이 있으면 그 벌의 값이
 * 사라진다 — 확인을 한 번 받는다.
 */
export function RowRepeatSettingsCard({
  rows,
  config,
  sumConstraints,
  tableValidationRules,
  onChange,
}: RowRepeatSettingsCardProps) {
  const enabled = isRowRepeatActive(config);
  // 지정 후보는 접힌 행 목록 — 2벌 이후는 사람이 고를 대상이 아니다.
  const selectableRows = useMemo(() => collapseRepeatRows(rows), [rows]);

  // 범위는 켠 뒤에도 고칠 수 있어야 한다. 활성 설정을 밑그림 삼되 사람이 고르는 동안은
  // 초안이 이긴다 — 활성 설정에서 곧장 값을 뽑으면 고른 즉시 원래 값으로 튕긴다.
  const activeRange = enabled
    ? {
        start: config!.templateRowIds[0] ?? '',
        end: config!.templateRowIds[config!.templateRowIds.length - 1] ?? '',
      }
    : { start: '', end: '' };
  const activeKey = `${activeRange.start}|${activeRange.end}`;
  const [draft, setDraft] = useState<{ start: string; end: string } | null>(null);
  const [syncedKey, setSyncedKey] = useState(activeKey);
  // 바깥에서 설정이 바뀌면(끄기·되돌리기·다른 질문) 초안을 버리고 새 설정을 따른다.
  if (activeKey !== syncedKey) {
    setSyncedKey(activeKey);
    setDraft(null);
  }

  const startId = draft?.start ?? activeRange.start;
  const endId = draft?.end ?? activeRange.end;

  const selectedRowIds = useMemo(() => {
    if (!startId || !endId) return [];
    const from = selectableRows.findIndex((row) => row.id === startId);
    const to = selectableRows.findIndex((row) => row.id === endId);
    if (from === -1 || to === -1) return [];
    const [lo, hi] = from <= to ? [from, to] : [to, from];
    return selectableRows.slice(lo, hi + 1).map((row) => row.id);
  }, [selectableRows, startId, endId]);

  const violations = useMemo(
    () =>
      selectedRowIds.length === 0
        ? []
        : validateRowRepeatTemplate(
            {
              tableRowsData: selectableRows,
              ...(sumConstraints ? { sumConstraints } : {}),
              ...(tableValidationRules ? { tableValidationRules } : {}),
            },
            selectedRowIds,
          ),
    [selectableRows, selectedRowIds, sumConstraints, tableValidationRules],
  );

  const maxRepeats = clampMaxRepeats(config?.maxRepeats ?? DEFAULT_ROW_REPEAT_MAX);
  const canApply = selectedRowIds.length > 0 && violations.length === 0;

  const apply = (patch: Partial<RowRepeatConfig>) => {
    if (!onChange) return;
    setDraft(null);
    onChange({
      enabled: true,
      templateRowIds: selectedRowIds,
      maxRepeats,
      ...(config?.addLabel !== undefined ? { addLabel: config.addLabel } : {}),
      ...patch,
    });
  };

  const rowLabel = (row: TableRow, index: number) =>
    `${index + 1}행${row.label?.trim() ? ` · ${row.label.trim()}` : ''}`;

  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Repeat2 className="h-4 w-4 text-emerald-600" />
            <span className="text-sm font-medium text-gray-700">행 반복</span>
            {enabled && (
              <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs text-emerald-700">
                최대 {maxRepeats}벌
              </span>
            )}
          </div>
          {enabled && (
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs"
              onClick={() => {
                if (
                  window.confirm(
                    '반복을 끄면 2벌 이후 행이 구조에서 사라집니다. 이미 수집된 응답이 그 행을 쓰고 있으면 값이 사라집니다. 끄시겠습니까?',
                  )
                ) {
                  onChange?.(null);
                }
              }}
            >
              반복 끄기
            </Button>
          )}
        </div>

        <p className="text-xs text-gray-500">
          응답자가 같은 모양의 행 묶음을 필요한 만큼 늘립니다. 편집 화면에는 1벌만 보이고,
          응답 시 최대 {maxRepeats}벌까지 늘어납니다.
        </p>

        <div className="flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-1 text-xs text-gray-600">
            시작 행
            <select
              className="h-8 rounded-md border border-gray-300 px-2 text-sm"
              value={startId}
              onChange={(e) => {
                const start = e.target.value;
                // 시작만 고른 상태에서는 한 행짜리 묶음으로 본다 — 끝을 따로 고르지 않아도
                // 곧바로 켤 수 있게.
                setDraft({ start, end: endId || start });
              }}
            >
              <option value="">선택</option>
              {selectableRows.map((row, index) => (
                <option key={row.id} value={row.id}>
                  {rowLabel(row, index)}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs text-gray-600">
            끝 행
            <select
              className="h-8 rounded-md border border-gray-300 px-2 text-sm"
              value={endId}
              onChange={(e) => setDraft({ start: startId, end: e.target.value })}
            >
              <option value="">선택</option>
              {selectableRows.map((row, index) => (
                <option key={row.id} value={row.id}>
                  {rowLabel(row, index)}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs text-gray-600">
            최대 벌 수
            <Input
              type="number"
              min={1}
              max={ROW_REPEAT_MAX}
              className="h-8 w-24 text-sm"
              value={maxRepeats}
              onChange={(e) => {
                const next = clampMaxRepeats(Number(e.target.value));
                if (!enabled) return;
                if (
                  next < maxRepeats &&
                  !window.confirm(
                    `최대 벌 수를 ${next}벌로 줄이면 그 뒤 행이 구조에서 사라집니다. 이미 수집된 응답이 그 행을 쓰고 있으면 값이 사라집니다. 줄이시겠습니까?`,
                  )
                ) {
                  return;
                }
                apply({ maxRepeats: next });
              }}
              disabled={!enabled}
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-gray-600">
            추가 버튼 문구
            <Input
              className="h-8 w-40 text-sm"
              placeholder={DEFAULT_ROW_REPEAT_ADD_LABEL}
              value={config?.addLabel ?? ''}
              onChange={(e) => {
                if (!enabled) return;
                apply({ addLabel: e.target.value });
              }}
              disabled={!enabled}
            />
          </label>
          {!enabled && (
            <Button size="sm" className="h-8 text-xs" disabled={!canApply} onClick={() => apply({})}>
              반복 켜기
            </Button>
          )}
          {enabled && canApply && selectedRowIds.join(',') !== config!.templateRowIds.join(',') && (
            <Button size="sm" className="h-8 text-xs" onClick={() => apply({})}>
              범위 적용
            </Button>
          )}
        </div>

        {violations.length > 0 && (
          <ul className="space-y-1 rounded-md bg-red-50 p-2 text-xs text-red-600">
            {violations.map((violation) => (
              <li key={violation.kind}>{violation.message}</li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
