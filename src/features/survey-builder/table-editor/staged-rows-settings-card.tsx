'use client';

import { useMemo, useState } from 'react';

import { ListPlus } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  DEFAULT_STAGED_ROWS_ADD_LABEL,
  isStagedRowsActive,
  validateStagedRows,
} from '@/features/question-renderer/utils/staged-rows';
import type { StagedRowsConfig, TableRow } from '@/types/survey';

interface StagedRowsSettingsCardProps {
  /** 편집기의 현재 행 (행 반복의 2벌 이후를 포함한 펼친 상태) */
  rows: TableRow[];
  config?: StagedRowsConfig | null | undefined;
  /** null 을 주면 끈다 — 행은 그대로이고 가리던 것만 풀린다 */
  onChange?: ((config: StagedRowsConfig | null) => void) | undefined;
}

/**
 * 행 차례로 열기 설정 — 저작자가 만들어 둔 연속 행 묶음과 처음 보이는 행 수를 정한다.
 *
 * 행 반복과 달리 구조를 건드리지 않는다. 켜고 끄는 것은 응답 화면에서 행을 가릴지 말지뿐이라
 * 끌 때 확인을 받지 않는다(사라지는 행도 값도 없다).
 */
export function StagedRowsSettingsCard({ rows, config, onChange }: StagedRowsSettingsCardProps) {
  const enabled = isStagedRowsActive(config);
  // 행 반복의 2벌 이후는 편집 표에도 없는 행이다 — 고를 대상이 아니다.
  const selectableRows = useMemo(
    () => rows.filter((row) => (row.repeatIndex ?? 1) <= 1),
    [rows],
  );

  // 범위·행 수는 켠 뒤에도 고칠 수 있어야 한다. 활성 설정을 밑그림 삼되 사람이 고르는 동안은
  // 초안이 이긴다 (행 반복 설정 카드와 같은 규칙).
  const activeRange = enabled
    ? {
        start: config.rowIds[0] ?? '',
        end: config.rowIds[config.rowIds.length - 1] ?? '',
      }
    : { start: '', end: '' };
  const activeCount = enabled ? config.initialVisibleCount : 1;
  const activeKey = `${activeRange.start}|${activeRange.end}|${activeCount}`;
  const [draft, setDraft] = useState<{ start: string; end: string } | null>(null);
  const [draftCount, setDraftCount] = useState<number | null>(null);
  const [syncedKey, setSyncedKey] = useState(activeKey);
  // 바깥에서 설정이 바뀌면(끄기·되돌리기·다른 질문) 초안을 버리고 새 설정을 따른다.
  if (activeKey !== syncedKey) {
    setSyncedKey(activeKey);
    setDraft(null);
    setDraftCount(null);
  }

  const startId = draft?.start ?? activeRange.start;
  const endId = draft?.end ?? activeRange.end;
  const initialVisibleCount = draftCount ?? activeCount;

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
        : validateStagedRows(selectableRows, { rowIds: selectedRowIds, initialVisibleCount }),
    [selectableRows, selectedRowIds, initialVisibleCount],
  );

  const canApply = selectedRowIds.length > 0 && violations.length === 0;
  const rangeChanged = enabled && selectedRowIds.join(',') !== config.rowIds.join(',');

  const emit = (patch: Partial<StagedRowsConfig>) => {
    if (!onChange) return;
    setDraft(null);
    setDraftCount(null);
    onChange({
      enabled: true,
      rowIds: selectedRowIds,
      initialVisibleCount,
      ...(config?.addLabel !== undefined ? { addLabel: config.addLabel } : {}),
      ...patch,
    });
  };

  const changeCount = (value: number) => {
    setDraftCount(value);
    // 켜진 상태에서는 고치는 즉시 반영한다 — 단 범위가 아직 적용 전이거나 값이 범위를
    // 벗어나면 초안으로만 두고 위반을 보인다(깨진 설정을 올려 보내지 않는다).
    if (!enabled || rangeChanged) return;
    const next = validateStagedRows(selectableRows, {
      rowIds: selectedRowIds,
      initialVisibleCount: value,
    });
    if (next.length === 0) emit({ initialVisibleCount: value });
  };

  const rowLabel = (row: TableRow, index: number) =>
    `${index + 1}행${row.label?.trim() ? ` · ${row.label.trim()}` : ''}`;

  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ListPlus className="h-4 w-4 text-sky-600" />
            <span className="text-sm font-medium text-gray-700">행 차례로 열기</span>
            {enabled && (
              <span className="rounded-full bg-sky-100 px-2 py-0.5 text-xs text-sky-700">
                처음 {config.initialVisibleCount}행 · 최대 {config.rowIds.length}행
              </span>
            )}
          </div>
          {enabled && (
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs"
              onClick={() => onChange?.(null)}
            >
              차례로 열기 끄기
            </Button>
          )}
        </div>

        <p className="text-xs text-gray-500">
          만들어 둔 행을 처음 몇 행만 보이고, 응답자가 + 로 다음 행을 하나씩 엽니다. 행 반복과 달리
          행을 복제하지 않습니다 — 최대 행 수만큼 행을 직접 만들어 두세요. 선택 칸·합계 제약이 든
          행도 묶을 수 있고, 내보내기 열은 열림 여부와 무관하게 항상 나갑니다.
        </p>

        <div className="flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-1 text-xs text-gray-600">
            묶음 시작 행
            <select
              className="h-8 rounded-md border border-gray-300 px-2 text-sm"
              value={startId}
              onChange={(e) => {
                const start = e.target.value;
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
            묶음 끝 행
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
            처음 보이는 행 수
            <Input
              type="number"
              min={1}
              className="h-8 w-24 text-sm"
              value={initialVisibleCount}
              onChange={(e) => changeCount(Number(e.target.value))}
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-gray-600">
            열기 버튼 문구
            <Input
              className="h-8 w-40 text-sm"
              placeholder={DEFAULT_STAGED_ROWS_ADD_LABEL}
              value={config?.addLabel ?? ''}
              onChange={(e) => {
                if (!enabled) return;
                emit({ addLabel: e.target.value });
              }}
              disabled={!enabled}
            />
          </label>
          {!enabled && (
            <Button size="sm" className="h-8 text-xs" disabled={!canApply} onClick={() => emit({})}>
              차례로 열기 켜기
            </Button>
          )}
          {rangeChanged && canApply && (
            <Button size="sm" className="h-8 text-xs" onClick={() => emit({})}>
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
