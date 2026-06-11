'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { Check, ChevronLeft, ChevronRight, ListChecks } from 'lucide-react';

import { useColumnSectionMap, useRowGroups } from '@/hooks/use-row-groups';
import { cn } from '@/lib/utils';
import type { HeaderCell, TableColumn, TableRow } from '@/types/survey';
import { isTableRowCompleted } from '@/utils/table-row-completion';

import { MobileRowCard } from './mobile-row-card';

// ── 상수 ──

const SMALL_TABLE_THRESHOLD = 15;

// ── 타입: 사전선택 Phase ──
type StepperPhase = 'group-select' | 'row-select' | 'detail';

// ── 타입 ──

interface MobileTableStepperProps {
  questionId: string;
  displayRows: TableRow[];
  visibleColumns: TableColumn[];
  visibleHeaderGrid?: HeaderCell[][] | null | undefined;
  currentResponse: Record<string, unknown>;
  hideColumnLabels: boolean;
  isTestMode: boolean;
  value?: Record<string, unknown> | undefined;
  onChange?: (value: Record<string, unknown>) => void;
  // 동적 행
  hasDynamicRows: boolean;
  selectedRowIds: string[];
  groupConfigMap: Map<string, unknown>;
  onSelectGroup?: (groupId: string) => void;
}

// ── 유틸 ──

function getRowShortLabel(row: TableRow, idx: number): string {
  const radioCell = row.cells.find(
    (c) => c.type === 'radio' && !c.isHidden && c.radioOptions?.length === 1,
  );
  if (radioCell?.radioOptions?.[0]?.label) {
    const label = radioCell.radioOptions[0].label;
    const match = label.match(/^[①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳]/);
    return match ? match[0] : `${idx + 1}`;
  }
  if (row.label) {
    return row.label.length > 12 ? row.label.slice(0, 12) + '…' : row.label;
  }
  return `${idx + 1}`;
}

// ── 메인 컴포넌트 ──

export const MobileTableStepper = React.memo(function MobileTableStepper({
  questionId,
  displayRows,
  visibleColumns,
  visibleHeaderGrid,
  currentResponse,
  hideColumnLabels,
  isTestMode,
  value,
  onChange,
  hasDynamicRows,
  selectedRowIds,
  groupConfigMap,
  onSelectGroup,
}: MobileTableStepperProps) {
  // ── 내부에서 훅으로 계산 (props drilling 제거) ──
  const rowGroups = useRowGroups(displayRows);
  const columnSectionMap = useColumnSectionMap(visibleHeaderGrid);

  const rowCompletionMap = useMemo(() => {
    const map = new Map<string, boolean>();
    for (const row of displayRows) {
      map.set(row.id, isTableRowCompleted(row, currentResponse));
    }
    return map;
  }, [displayRows, currentResponse]);

  const [currentGroupIdx, setCurrentGroupIdx] = useState(0);
  const [currentRowInGroup, setCurrentRowInGroup] = useState(0);
  const groupPillsRef = useRef<HTMLDivElement>(null);
  const rowPillsRef = useRef<HTMLDivElement>(null);

  // ── 인덱스 clamp ──
  useEffect(() => {
    if (rowGroups.length === 0) return;
    if (currentGroupIdx >= rowGroups.length) {
      setCurrentGroupIdx(rowGroups.length - 1);
      setCurrentRowInGroup(0);
      return;
    }
    const group = rowGroups[currentGroupIdx];
    if (!group) return;
    if (currentRowInGroup >= group.rows.length) {
      setCurrentRowInGroup(group.rows.length - 1);
    }
  }, [rowGroups, currentGroupIdx, currentRowInGroup]);

  // ── pill 자동 스크롤 ──
  useEffect(() => {
    const el = groupPillsRef.current?.children[currentGroupIdx] as HTMLElement | undefined;
    el?.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
  }, [currentGroupIdx]);

  useEffect(() => {
    const el = rowPillsRef.current?.children[currentRowInGroup] as HTMLElement | undefined;
    el?.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
  }, [currentRowInGroup]);

  // ── 네비게이션 ──
  const hasGroups = rowGroups.length > 1;

  const goPrev = useCallback(() => {
    if (currentRowInGroup > 0) {
      setCurrentRowInGroup((c) => c - 1);
    } else if (hasGroups && currentGroupIdx > 0) {
      const prevGroup = rowGroups[currentGroupIdx - 1];
      if (!prevGroup) return;
      setCurrentGroupIdx((c) => c - 1);
      setCurrentRowInGroup(prevGroup.rows.length - 1);
    }
  }, [currentRowInGroup, currentGroupIdx, hasGroups, rowGroups]);

  const goNext = useCallback(() => {
    const group = rowGroups[currentGroupIdx];
    if (!group) return;
    if (currentRowInGroup < group.rows.length - 1) {
      setCurrentRowInGroup((c) => c + 1);
    } else if (hasGroups && currentGroupIdx < rowGroups.length - 1) {
      setCurrentGroupIdx((c) => c + 1);
      setCurrentRowInGroup(0);
    }
  }, [currentRowInGroup, currentGroupIdx, hasGroups, rowGroups]);

  const isFirst = currentRowInGroup === 0 && currentGroupIdx === 0;
  const isLast =
    rowGroups.length > 0 &&
    currentGroupIdx === rowGroups.length - 1 &&
    currentRowInGroup === (rowGroups[rowGroups.length - 1]?.rows.length ?? 1) - 1;

  // ── 사전선택 Phase 상태 ──
  // displayCondition이 없는 테이블 → 사전선택 적용 (이미 필터링된 테이블은 스킵)
  // 이 시점 displayRows.length 는 항상 SMALL_TABLE_THRESHOLD 초과 (작은 케이스는 위에서 단순 카드로 반환됨)
  const hasRowFiltering = displayRows.some((r) => r.displayCondition != null);
  const needsPreSelect = !hasDynamicRows && !hasRowFiltering;
  const skipGroupSelect = rowGroups.length <= 1;
  const initialPhase: StepperPhase = needsPreSelect
    ? skipGroupSelect ? 'row-select' : 'group-select'
    : 'detail';

  const [phase, setPhase] = useState<StepperPhase>(initialPhase);
  const [preSelectedGroupIndices, setPreSelectedGroupIndices] = useState<Set<number>>(new Set());
  const [preSelectedRowIds, setPreSelectedRowIds] = useState<Set<string>>(new Set());

  // ── displayRows 변경에 따른 사전선택 상태 재동기화 ──
  // phase/preSelected* 는 최초 마운트 시 한 번만 seed 되지만, 부모는 key 없이
  // 이 컴포넌트를 리렌더(리마운트 아님)하므로 선행 질문 응답으로 displayRows 가
  // 바뀌면 stale 상태가 남는다(예: 분류가 detail↔group-select 로 뒤집히거나,
  // 사라진 행 id 가 preSelectedRowIds 에 남아 filteredRows 가 빈 집합이 됨).
  useEffect(() => {
    // 더 이상 존재하지 않는 행 id 를 사전선택 집합에서 제거
    const rowIdSet = new Set(displayRows.map((r) => r.id));
    setPreSelectedRowIds((prev) => {
      let changed = false;
      const next = new Set<string>();
      for (const id of prev) {
        if (rowIdSet.has(id)) next.add(id);
        else changed = true;
      }
      return changed ? next : prev;
    });
    // 유효 범위를 벗어난 그룹 인덱스를 제거
    setPreSelectedGroupIndices((prev) => {
      let changed = false;
      const next = new Set<number>();
      for (const idx of prev) {
        if (idx < rowGroups.length) next.add(idx);
        else changed = true;
      }
      return changed ? next : prev;
    });
    // 현재 분류와 모순되는 phase 만 보정 (정상 phase 는 사용자 네비게이션 보존)
    setPhase((prev) => {
      if (!needsPreSelect) return prev === 'detail' ? prev : 'detail';
      if (prev === 'group-select' && skipGroupSelect) return 'row-select';
      // detail 진입 후 사전선택 행이 전부 사라지면 선택 단계로 복귀
      if (prev === 'detail' && !displayRows.some((r) => preSelectedRowIds.has(r.id))) {
        return skipGroupSelect ? 'row-select' : 'group-select';
      }
      return prev;
    });
  }, [displayRows, rowGroups, needsPreSelect, skipGroupSelect, preSelectedRowIds]);

  const toggleGroupIndex = useCallback((idx: number) => {
    setPreSelectedGroupIndices((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) {
        next.delete(idx);
        // 해당 그룹의 행도 해제
        const group = rowGroups[idx];
        if (group) group.rows.forEach((r) => setPreSelectedRowIds((p) => { const n = new Set(p); n.delete(r.id); return n; }));
      } else {
        next.add(idx);
        // 해당 그룹의 행을 전체 선택
        const group = rowGroups[idx];
        if (group) group.rows.forEach((r) => setPreSelectedRowIds((p) => new Set(p).add(r.id)));
      }
      return next;
    });
  }, [rowGroups]);

  const toggleRowId = useCallback((rowId: string) => {
    setPreSelectedRowIds((prev) => {
      const next = new Set(prev);
      if (next.has(rowId)) next.delete(rowId);
      else next.add(rowId);
      return next;
    });
  }, []);

  // 사전선택된 행만 필터링 (Phase 3에서 사용)
  const filteredRows = useMemo(() => {
    if (!needsPreSelect || phase !== 'detail') return displayRows;
    return displayRows.filter((r) => preSelectedRowIds.has(r.id));
  }, [needsPreSelect, phase, displayRows, preSelectedRowIds]);

  if (displayRows.length <= SMALL_TABLE_THRESHOLD) {
    return (
      <div className="space-y-4">
        {displayRows.map((row) => (
          <MobileRowCard
            key={row.id}
            row={row}
            visibleColumns={visibleColumns}
            columnSectionMap={columnSectionMap}
            completed={rowCompletionMap.get(row.id) ?? false}
            hideColumnLabels={hideColumnLabels}
            questionId={questionId}
            isTestMode={isTestMode}
            value={value}
            onChange={onChange}
          />
        ))}
      </div>
    );
  }

  // ── 사전선택 Phase 1: 그룹 선택 ──
  if (phase === 'group-select') {
    return (
      <div className="space-y-2">
        <p className="text-sm font-medium text-gray-700">응답할 항목을 선택하세요</p>
        {rowGroups.map((group, idx) => (
          <label
            key={idx}
            className={cn(
              'flex cursor-pointer items-center gap-3 rounded-xl border p-4 transition-all',
              preSelectedGroupIndices.has(idx)
                ? 'border-blue-400 bg-blue-50/50'
                : 'border-gray-200 bg-white',
            )}
          >
            <input
              type="checkbox"
              checked={preSelectedGroupIndices.has(idx)}
              onChange={() => toggleGroupIndex(idx)}
              className="h-5 w-5 rounded border-gray-300 text-blue-600"
            />
            <span className="flex-1 text-sm font-medium text-gray-900">{group.label}</span>
            <span className="text-xs text-gray-400">{group.rows.length}개</span>
          </label>
        ))}
        <button
          disabled={preSelectedGroupIndices.size === 0}
          onClick={() => setPhase('row-select')}
          className="mt-2 flex w-full items-center justify-center gap-1 rounded-xl bg-blue-600 py-3.5 text-sm font-semibold text-white transition-colors hover:bg-blue-700 disabled:bg-gray-200 disabled:text-gray-400"
        >
          상세 입력 ({preSelectedGroupIndices.size}개 선택) <ChevronRight className="h-4 w-4" />
        </button>
      </div>
    );
  }

  // ── 사전선택 Phase 2: 행 선택 ──
  if (phase === 'row-select') {
    const selectedGroups = skipGroupSelect
      ? rowGroups
      : rowGroups.filter((_, idx) => preSelectedGroupIndices.has(idx));

    return (
      <div className="space-y-3">
        <p className="text-sm font-medium text-gray-700">세부 항목을 선택하세요</p>
        {selectedGroups.map((group) => (
          // key는 group.startIndex 사용 — group.label은 같은 선두 텍스트를 가진
          // 두 rowspan 섹션 간 충돌 가능(중복 key → React reconciliation 오류)
          <div key={group.startIndex}>
            {!skipGroupSelect && (
              <h3 className="mb-1.5 text-xs font-semibold text-gray-500">{group.label}</h3>
            )}
            <div className="space-y-1.5">
              {group.rows.map((row) => {
                const label = row.label || row.cells.find((c) => c.type === 'text' && !c.isHidden)?.content || row.id;
                return (
                  <label
                    key={row.id}
                    className={cn(
                      'flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2.5 transition-all',
                      preSelectedRowIds.has(row.id)
                        ? 'border-blue-400 bg-blue-50/50'
                        : 'border-gray-200 bg-white',
                    )}
                  >
                    <input
                      type="checkbox"
                      checked={preSelectedRowIds.has(row.id)}
                      onChange={() => toggleRowId(row.id)}
                      className="h-4 w-4 rounded border-gray-300 text-blue-600"
                    />
                    <span className="text-sm text-gray-900">{label}</span>
                  </label>
                );
              })}
            </div>
          </div>
        ))}
        <div className="flex gap-2 pt-1">
          {!skipGroupSelect && (
            <button
              onClick={() => setPhase('group-select')}
              className="flex items-center gap-1 rounded-lg border border-gray-200 bg-white px-4 py-2.5 text-sm font-medium text-gray-600"
            >
              <ChevronLeft className="h-4 w-4" /> 그룹
            </button>
          )}
          <button
            disabled={preSelectedRowIds.size === 0}
            onClick={() => { setPhase('detail'); setCurrentGroupIdx(0); setCurrentRowInGroup(0); }}
            className="flex flex-1 items-center justify-center gap-1 rounded-lg bg-blue-600 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-blue-700 disabled:bg-gray-200 disabled:text-gray-400"
          >
            상세 입력 ({preSelectedRowIds.size}개 선택) <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>
    );
  }

  // ── 사전선택 Phase 3: 상세 입력 (선택된 행만) ──
  if (needsPreSelect && phase === 'detail' && filteredRows.length > 0) {
    const detailIdx = currentRowInGroup;
    const detailRow = filteredRows[detailIdx] || filteredRows[0];
    if (!detailRow) return null;

    const detailIsFirst = detailIdx === 0;
    const detailIsLast = detailIdx === filteredRows.length - 1;
    const detailCompletedCount = filteredRows.filter((r) => rowCompletionMap.get(r.id)).length;

    return (
      <div className="space-y-3">
        <button
          onClick={() => setPhase(skipGroupSelect ? 'row-select' : 'row-select')}
          className="flex items-center gap-1 text-sm font-medium text-blue-600 transition-colors hover:text-blue-800"
        >
          <ChevronLeft className="h-4 w-4" /> 항목 선택으로 돌아가기
        </button>

        <div className="flex items-center justify-between text-xs text-gray-400">
          <span>{detailIdx + 1} / {filteredRows.length}</span>
          <span>{detailCompletedCount} / {filteredRows.length} 완료</span>
        </div>

        <MobileRowCard
          row={detailRow}
          visibleColumns={visibleColumns}
          columnSectionMap={columnSectionMap}
          completed={rowCompletionMap.get(detailRow.id) ?? false}
          hideColumnLabels={hideColumnLabels}
          questionId={questionId}
          isTestMode={isTestMode}
          value={value}
          onChange={onChange}
        />

        <div className="flex gap-2 pt-1">
          <button
            onClick={() => setCurrentRowInGroup((c) => Math.max(0, c - 1))}
            disabled={detailIsFirst}
            className="flex flex-1 items-center justify-center gap-1 rounded-lg border border-gray-200 bg-white py-3 text-sm font-medium text-gray-600 transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <ChevronLeft className="h-4 w-4" /> 이전
          </button>
          <button
            onClick={() => setCurrentRowInGroup((c) => Math.min(filteredRows.length - 1, c + 1))}
            disabled={detailIsLast}
            className="flex flex-1 items-center justify-center gap-1 rounded-lg bg-blue-600 py-3 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-gray-200 disabled:text-gray-400"
          >
            다음 <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>
    );
  }

  // ── 기존 스테퍼 (사전선택 불필요 or dynamicRows) ──
  const currentGroup = rowGroups[currentGroupIdx] || rowGroups[0];
  if (!currentGroup) return null;
  const currentRow = currentGroup.rows[currentRowInGroup];
  if (!currentRow) return null;

  const groupCompletedCount = currentGroup.rows.filter(
    (r) => rowCompletionMap.get(r.id),
  ).length;

  return (
    <div className="space-y-3">
      {hasDynamicRows && onSelectGroup && (
        <button
          onClick={() => {
            const firstGroupId = Array.from(groupConfigMap.keys())[0];
            if (firstGroupId) onSelectGroup(firstGroupId);
          }}
          className="flex w-full items-center justify-between rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm font-medium text-blue-700 transition-colors hover:bg-blue-100"
        >
          <div className="flex items-center gap-2">
            <ListChecks className="h-4 w-4" />
            <span>항목 선택</span>
          </div>
          <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs">
            {selectedRowIds.length}개 선택됨
          </span>
        </button>
      )}

      {hasGroups && (
        <div
          ref={groupPillsRef}
          className="flex gap-1.5 overflow-x-auto pb-1"
          style={{ scrollbarWidth: 'none' }}
        >
          {rowGroups.map((group, idx) => {
            const isActive = idx === currentGroupIdx;
            const allDone = group.rows.every((r) => rowCompletionMap.get(r.id));
            return (
              <button
                key={idx}
                onClick={() => {
                  setCurrentGroupIdx(idx);
                  setCurrentRowInGroup(0);
                }}
                className={cn(
                  'flex shrink-0 items-center gap-1 rounded-full px-3 py-1.5 text-xs font-medium transition-all',
                  isActive
                    ? 'bg-blue-600 text-white shadow-sm'
                    : allDone
                      ? 'bg-green-50 text-green-700 ring-1 ring-green-300'
                      : 'bg-gray-100 text-gray-500 hover:bg-gray-200',
                )}
              >
                {allDone && !isActive && <Check className="h-3 w-3" />}
                <span className="max-w-[180px] truncate">{group.label}</span>
              </button>
            );
          })}
        </div>
      )}

      {currentGroup.rows.length > 1 && (
        <div
          ref={rowPillsRef}
          className="flex gap-1 overflow-x-auto pb-1"
          style={{ scrollbarWidth: 'none' }}
        >
          {currentGroup.rows.map((row, idx) => {
            const isActive = idx === currentRowInGroup;
            const isDone = rowCompletionMap.get(row.id) ?? false;
            const rowLabel = getRowShortLabel(row, idx);
            return (
              <button
                key={row.id}
                onClick={() => setCurrentRowInGroup(idx)}
                className={cn(
                  'shrink-0 rounded-full px-2.5 py-1 text-xs font-medium transition-all',
                  isActive
                    ? 'bg-gray-800 text-white'
                    : isDone
                      ? 'bg-green-50 text-green-600'
                      : 'bg-gray-100 text-gray-400',
                )}
              >
                {isDone && !isActive ? '✓' : ''}
                {rowLabel}
              </button>
            );
          })}
        </div>
      )}

      <div className="flex items-center justify-between text-xs text-gray-400">
        <span>
          {hasGroups && <span className="font-medium text-gray-600">{currentGroup.label}</span>}
          {hasGroups && ' · '}
          {currentRowInGroup + 1} / {currentGroup.rows.length}
        </span>
        <span>
          {groupCompletedCount} / {currentGroup.rows.length} 완료
        </span>
      </div>

      <MobileRowCard
        row={currentRow}
        visibleColumns={visibleColumns}
        columnSectionMap={columnSectionMap}
        completed={rowCompletionMap.get(currentRow.id) ?? false}
        hideColumnLabels={hideColumnLabels}
        questionId={questionId}
        isTestMode={isTestMode}
        value={value}
        onChange={onChange}
      />

      <div className="flex gap-2 pt-1">
        <button
          onClick={goPrev}
          disabled={isFirst}
          className="flex flex-1 items-center justify-center gap-1 rounded-lg border border-gray-200 bg-white py-3 text-sm font-medium text-gray-600 transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <ChevronLeft className="h-4 w-4" /> 이전
        </button>
        <button
          onClick={goNext}
          disabled={isLast}
          className="flex flex-1 items-center justify-center gap-1 rounded-lg bg-blue-600 py-3 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-gray-200 disabled:text-gray-400"
        >
          다음 <ChevronRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
});
