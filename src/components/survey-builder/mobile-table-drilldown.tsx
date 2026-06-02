'use client';

import React, { useMemo, useState } from 'react';

import { CheckCircle2, ChevronLeft, ChevronRight } from 'lucide-react';

import { cn } from '@/lib/utils';
import type { HeaderCell, TableCell, TableColumn, TableRow } from '@/types/survey';
import {
  classifyTable,
  type ClassifiedLeaf,
  type ClassifiedSection,
} from '@/utils/classify-table';

import { InteractiveCell } from './cells';

interface MobileTableDrilldownProps {
  questionId: string;
  displayRows: TableRow[];
  visibleColumns: TableColumn[];
  visibleHeaderGrid?: HeaderCell[][] | null;
  currentResponse: Record<string, unknown>;
  hideColumnLabels: boolean;
  isTestMode: boolean;
  value?: Record<string, unknown>;
  onChange?: (value: Record<string, unknown>) => void;
  // 동적 행 props (drop-in 호환용 — 드릴다운은 이미 필터링된 displayRows 사용)
  hasDynamicRows: boolean;
  selectedRowIds: string[];
  groupConfigMap: Map<string, unknown>;
  onSelectGroup?: (groupId: string) => void;
}

// ── 메인 컴포넌트 ──

export const MobileTableDrilldown = React.memo(function MobileTableDrilldown({
  questionId,
  displayRows,
  visibleColumns,
  visibleHeaderGrid,
  isTestMode,
  value,
  onChange,
}: MobileTableDrilldownProps) {
  const sections = useMemo(
    () =>
      classifyTable({
        tableColumns: visibleColumns,
        tableRowsData: displayRows,
        tableHeaderGrid: visibleHeaderGrid,
      }),
    [visibleColumns, displayRows, visibleHeaderGrid],
  );

  // cell.id → TableCell (입력 셀 렌더용)
  const cellById = useMemo(() => {
    const m = new Map<string, TableCell>();
    for (const row of displayRows) for (const cell of row.cells) m.set(cell.id, cell);
    return m;
  }, [displayRows]);

  const [nav, setNav] = useState<{ sec: number | null; leaf: number | null }>({
    sec: null,
    leaf: null,
  });

  // ── 응답 채움 계산 ──
  // emptyDefault(숫자 셀 첫 진입 시 자동 채워지는 초기값)와 동일한 값은 사용자가
  // 실제로 입력한 게 아니므로 미입력으로 간주한다.
  const filled = (cellId: string) => {
    const v = String(value?.[cellId] ?? '').trim();
    if (v === '') return false;
    const cell = cellById.get(cellId);
    if (cell && typeof cell.emptyDefault === 'number' && v === String(cell.emptyDefault)) {
      return false;
    }
    return true;
  };
  const leafFilled = (l: ClassifiedLeaf) => l.inputCellIds.filter(filled).length;
  const leafDone = (l: ClassifiedLeaf) =>
    l.inputCellIds.length > 0 && leafFilled(l) === l.inputCellIds.length;
  const secFilled = (s: ClassifiedSection) => s.leaves.reduce((a, l) => a + leafFilled(l), 0);
  const totalInputs = sections.reduce((a, s) => a + s.totalInputs, 0);
  const totalFilled = sections.reduce((a, s) => a + secFilled(s), 0);
  const pct = totalInputs ? Math.round((totalFilled / totalInputs) * 100) : 0;

  const renderCell = (cellId: string) => {
    const cell = cellById.get(cellId);
    if (!cell) return null;
    return (
      <InteractiveCell
        cell={cell}
        questionId={questionId}
        isTestMode={isTestMode}
        value={value}
        onChange={onChange}
      />
    );
  };

  const secSubText = (s: ClassifiedSection) =>
    s.kind === 'matrix'
      ? `세부 ${s.leaves.length}개 · 입력 ${s.totalInputs}칸`
      : s.kind === 'list'
        ? `항목 ${s.leaves.length}개`
        : `입력 ${s.leaves.length}개`;

  // ── breadcrumb ──
  const Crumb = ({ label, onBack }: { label: string; onBack: () => void }) => (
    <div className="mb-3 flex items-center gap-2">
      <button
        type="button"
        onClick={onBack}
        className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-gray-100 px-3 py-2 text-sm font-semibold text-gray-600 active:bg-gray-200"
      >
        <ChevronLeft className="h-4 w-4" />
        뒤로
      </button>
      <span className="min-w-0 truncate text-sm font-semibold text-gray-900">{label}</span>
    </div>
  );

  // ── 진행률 바 (+ 섹션 진입 시 목차로 돌아가기) ──
  const ProgressBar = () => (
    <div className="mt-4">
      {nav.sec !== null && (
        <button
          type="button"
          onClick={() => setNav({ sec: null, leaf: null })}
          className="mb-3 flex w-full items-center justify-center gap-1 rounded-xl border border-gray-200 bg-white py-3 text-sm font-semibold text-gray-600 active:bg-gray-50"
        >
          <ChevronLeft className="h-4 w-4" />
          목차로 돌아가기
        </button>
      )}
      <div className="h-1.5 overflow-hidden rounded-full bg-gray-100">
        <div
          className="h-full rounded-full bg-blue-500 transition-all"
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="mt-1.5 flex justify-between text-xs text-gray-500">
        <span>
          전체 <b className="font-semibold text-gray-700">{totalFilled}</b> / {totalInputs}칸
        </span>
        <span className="font-semibold text-gray-700">{pct}%</span>
      </div>
    </div>
  );

  // ── 루트: 섹션 목차 ──
  if (nav.sec === null) {
    return (
      <div>
        <p className="mb-3 px-1 text-sm font-medium text-gray-500">작성할 항목을 선택하세요</p>
        <div className="space-y-2.5">
          {sections.map((s, si) => {
            const f = secFilled(s);
            const full = s.totalInputs > 0 && f === s.totalInputs;
            return (
              <button
                key={si}
                type="button"
                onClick={() => setNav({ sec: si, leaf: null })}
                className="flex w-full items-center gap-3 rounded-xl border border-gray-200 bg-white p-4 text-left active:bg-gray-50"
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-semibold text-gray-900">
                    {s.label || '항목'}
                  </div>
                  <div className="mt-0.5 text-xs text-gray-400">{secSubText(s)}</div>
                </div>
                <span
                  className={cn(
                    'shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold',
                    full ? 'bg-green-100 text-green-600' : 'bg-gray-100 text-gray-500',
                  )}
                >
                  {f}/{s.totalInputs}
                </span>
                <ChevronRight className="h-4 w-4 shrink-0 text-gray-400" />
              </button>
            );
          })}
        </div>
        <ProgressBar />
      </div>
    );
  }

  const s = sections[nav.sec];
  const backToRoot = () => setNav({ sec: null, leaf: null });

  // ── scalar / list 섹션 ──
  if (s.kind === 'scalar' || s.kind === 'list') {
    return (
      <div>
        <Crumb label={s.label || '항목'} onBack={backToRoot} />
        <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
          <div className="border-b bg-gray-50/80 px-4 py-3 text-sm font-semibold text-gray-700">
            {s.label || '입력'}
          </div>
          <div className="divide-y divide-gray-100 px-3 py-1">
            {s.leaves.map((l) => {
              const done = leafDone(l);
              return (
                <div key={l.rowId} className="flex items-center gap-3 py-3">
                  <span
                    className={cn(
                      'min-w-0 flex-1 text-sm font-medium',
                      done ? 'text-green-600' : 'text-gray-900',
                    )}
                  >
                    {l.label}
                  </span>
                  {done && <CheckCircle2 className="h-4 w-4 shrink-0 text-green-500" />}
                  <div className="w-28 shrink-0">{renderCell(l.inputCellIds[0])}</div>
                </div>
              );
            })}
          </div>
        </div>
        <ProgressBar />
      </div>
    );
  }

  // ── matrix 섹션 ──
  if (nav.leaf === null) {
    // 리프 목록 (하위 그룹 구분선)
    let lastSub: string | null = null;
    return (
      <div>
        <Crumb label={s.label || '항목'} onBack={backToRoot} />
        <div className="space-y-2.5">
          {s.leaves.map((l, li) => {
            const showDivider = l.subGroup !== lastSub && !!l.subGroup;
            if (l.subGroup !== lastSub) lastSub = l.subGroup;
            const f = leafFilled(l);
            const full = leafDone(l);
            return (
              <React.Fragment key={l.rowId}>
                {showDivider && (
                  <div className="px-1 pt-1 text-xs font-semibold text-gray-500">{l.subGroup}</div>
                )}
                <button
                  type="button"
                  onClick={() => setNav({ sec: nav.sec, leaf: li })}
                  className="flex w-full items-center gap-3 rounded-xl border border-gray-200 bg-white p-4 text-left active:bg-gray-50"
                >
                  <span className="min-w-0 flex-1 text-sm font-semibold text-gray-900">
                    {l.label}
                  </span>
                  <span
                    className={cn(
                      'shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold',
                      full ? 'bg-green-100 text-green-600' : 'bg-gray-100 text-gray-500',
                    )}
                  >
                    {f}/{l.inputCellIds.length}
                  </span>
                  <ChevronRight className="h-4 w-4 shrink-0 text-gray-400" />
                </button>
              </React.Fragment>
            );
          })}
        </div>
        <ProgressBar />
      </div>
    );
  }

  // matrix 리프 폼 (열 그룹별 입력)
  const leaf = s.leaves[nav.leaf];
  const backToLeaves = () => setNav({ sec: nav.sec, leaf: null });
  let k = 0; // colGroups flat 순서 = leaf.inputCellIds 순서
  return (
    <div>
      <Crumb
        label={
          leaf.subGroup && leaf.subGroup !== leaf.label
            ? `${leaf.subGroup} › ${leaf.label}`
            : leaf.label
        }
        onBack={backToLeaves}
      />
      <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
        <div className="border-b bg-gray-50/80 px-4 py-3 text-sm font-semibold text-gray-700">
          {leaf.label}
        </div>
        <div className="space-y-4 p-4">
          {s.colGroups.map((g, gi) => (
            <div key={gi}>
              {g.label && (
                <div className="mb-2 flex items-center gap-2 text-xs font-semibold text-blue-600">
                  <span className="h-1.5 w-1.5 rounded-full bg-blue-500" />
                  {g.label}
                </div>
              )}
              <div className="space-y-3">
                {g.cols.map((c) => {
                  const cellId = leaf.inputCellIds[k++];
                  const cell = cellById.get(cellId);
                  if (!cell) return null;
                  return (
                    <div key={c.col}>
                      <label className="mb-1 block pl-0.5 text-xs font-medium text-gray-500">
                        {cell.exportLabel?.trim() || c.label}
                      </label>
                      {renderCell(cellId)}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>
      <div className="mt-3 flex gap-2.5">
        <button
          type="button"
          disabled={nav.leaf <= 0}
          onClick={() => setNav({ sec: nav.sec, leaf: (nav.leaf ?? 0) - 1 })}
          className="flex-1 rounded-xl border border-gray-200 bg-white py-3 text-sm font-semibold text-gray-600 disabled:opacity-40"
        >
          ‹ 이전
        </button>
        <button
          type="button"
          disabled={nav.leaf >= s.leaves.length - 1}
          onClick={() => setNav({ sec: nav.sec, leaf: (nav.leaf ?? 0) + 1 })}
          className="flex-1 rounded-xl bg-blue-500 py-3 text-sm font-semibold text-white disabled:opacity-40"
        >
          다음 ›
        </button>
      </div>
      <ProgressBar />
    </div>
  );
});
