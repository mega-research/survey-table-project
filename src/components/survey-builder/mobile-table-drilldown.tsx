'use client';

import React, { useMemo, useState } from 'react';

import { CheckCircle2 } from 'lucide-react';

import { cn } from '@/lib/utils';
import type { HeaderCell, TableCell, TableColumn, TableRow } from '@/types/survey';
import { type ClassifiedLeaf, type ClassifiedSection, classifyTable } from '@/utils/classify-table';

import { InteractiveCell } from './cells';
import { MobileDrilldownShell } from './mobile-drilldown-shell';

interface MobileTableDrilldownProps {
  questionId: string;
  displayRows: TableRow[];
  visibleColumns: TableColumn[];
  visibleHeaderGrid?: HeaderCell[][] | null | undefined;
  currentResponse: Record<string, unknown>;
  hideColumnLabels: boolean;
  isTestMode: boolean;
  value?: Record<string, unknown> | undefined;
  onChange?: (value: Record<string, unknown>) => void;
  // 동적 행 props (drop-in 호환용 — 드릴다운은 이미 필터링된 displayRows 사용)
  hasDynamicRows: boolean;
  selectedRowIds: string[];
  groupConfigMap: Map<string, unknown>;
  onSelectGroup?: (groupId: string) => void;
  /** 차단형 검증 위반 셀 (빨간 ring 하이라이트) */
  errorCellIds?: Set<string> | undefined;
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
  errorCellIds,
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

  // 사용자가 거쳐가며 비워둔 입력 칸(빈 응답으로 확정) 집합.
  // 값이 없어도 이 집합에 들면 진행률·완료 표시에서 "채운 것"으로 카운트한다.
  // 컴포넌트 로컬 상태라 새로고침 시 초기화된다(실제 입력값은 value에 보존).
  const [acknowledged, setAcknowledged] = useState<Set<string>>(new Set());
  const ackCells = (cellIds: string[]) =>
    setAcknowledged((prev) => {
      const next = new Set(prev);
      for (const id of cellIds) next.add(id);
      return next;
    });

  // ── 응답 채움 계산 ──
  // emptyDefault(숫자 셀 첫 진입 시 자동 채워지는 초기값)와 동일한 값은 사용자가
  // 실제로 입력한 게 아니므로 미입력으로 간주한다.
  const hasValue = (cellId: string) => {
    const v = String(value?.[cellId] ?? '').trim();
    if (v === '') return false;
    const cell = cellById.get(cellId);
    if (cell && typeof cell.emptyDefault === 'number' && v === String(cell.emptyDefault)) {
      return false;
    }
    return true;
  };
  // 실제 입력했거나(hasValue) 거쳐가며 비워둔(acknowledged) 칸을 "채운 것"으로 본다.
  const counted = (cellId: string) => hasValue(cellId) || acknowledged.has(cellId);
  const leafFilled = (leaf: ClassifiedLeaf) => leaf.inputCellIds.filter(counted).length;
  const leafDone = (leaf: ClassifiedLeaf) =>
    leaf.inputCellIds.length > 0 && leafFilled(leaf) === leaf.inputCellIds.length;
  const secFilled = (section: ClassifiedSection) =>
    section.leaves.reduce((total, leaf) => total + leafFilled(leaf), 0);
  const totalInputs = sections.reduce((total, section) => total + section.totalInputs, 0);
  const totalFilled = sections.reduce((total, section) => total + secFilled(section), 0);

  const renderCell = (cellId: string) => {
    const cell = cellById.get(cellId);
    if (!cell) return null;
    return (
      <div className={cn(errorCellIds?.has(cellId) && 'rounded-lg ring-2 ring-red-300')}>
        <InteractiveCell
          cell={cell}
          questionId={questionId}
          isTestMode={isTestMode}
          value={value}
          onChange={onChange}
        />
      </div>
    );
  };

  const renderScalarOrListSection = (section: ClassifiedSection) => (
    <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
      <div className="border-b bg-gray-50/80 px-4 py-3 text-sm font-semibold text-gray-700">
        {section.label || '입력'}
      </div>
      <div className="divide-y divide-gray-100 px-3 py-1">
        {section.leaves.map((leaf) => {
          const done = leafDone(leaf);
          return (
            <div key={leaf.rowId} className="py-3">
              <div className="mb-1.5 flex items-center gap-1.5">
                <span
                  className={cn('text-sm font-medium', done ? 'text-green-600' : 'text-gray-900')}
                >
                  {leaf.label}
                </span>
                {done && <CheckCircle2 className="h-4 w-4 shrink-0 text-green-500" />}
              </div>
              {leaf.inputCellIds[0] != null && renderCell(leaf.inputCellIds[0])}
            </div>
          );
        })}
      </div>
    </div>
  );

  const renderMatrixLeafDetail = (leaf: ClassifiedLeaf, section: ClassifiedSection) => (
    <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
      <div className="border-b bg-gray-50/80 px-4 py-3 text-sm font-semibold text-gray-700">
        {leaf.label}
      </div>
      <div className="space-y-4 p-4">
        {section.colGroups.map((group, groupIndex) => (
          <div key={groupIndex}>
            {group.label && (
              <div className="mb-2 flex items-center gap-2 text-xs font-semibold text-blue-600">
                <span className="h-1.5 w-1.5 rounded-full bg-blue-500" />
                {group.label}
              </div>
            )}
            <div className="space-y-3">
              {group.cols.map((column) => {
                // 실제 열 인덱스(column.col)로 이 리프의 입력 셀을 찾는다. 비대칭 matrix 에서
                // 행마다 채운 열이 달라도 셀이 올바른 열 라벨 아래 렌더된다.
                const cellId = leaf.cellByCol[column.col];
                if (cellId == null) return null;
                const cell = cellById.get(cellId);
                if (!cell) return null;
                // 일반 테이블 카드(mobile-row-card)와 동일한 라벨 위계:
                // 파란 점 불릿 + text-sm gray-900. 라벨이 주, 문항(cell.content)이 보조.
                const label = cell.exportLabel?.trim() || column.label || '';
                return (
                  <div key={column.col} className="space-y-1">
                    {label && (
                      <div className="flex items-start gap-1.5">
                        <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-blue-500" />
                        <span className="line-clamp-2 text-sm font-medium text-gray-900">
                          {label}
                        </span>
                      </div>
                    )}
                    {renderCell(cellId)}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );

  return (
    <MobileDrilldownShell
      sections={sections}
      leafNavigation="matrix-only"
      overallStatus={{ completed: totalFilled, total: totalInputs, unit: '칸' }}
      getSectionStatus={(section) => ({
        completed: secFilled(section),
        total: section.totalInputs,
        unit: '칸',
      })}
      getLeafStatus={(leaf) => ({
        completed: leafFilled(leaf),
        total: leaf.inputCellIds.length,
        unit: '칸',
      })}
      renderLegacySection={renderScalarOrListSection}
      renderLeafDetail={renderMatrixLeafDetail}
      onLeaveLeafForward={(leaf) => ackCells(leaf.inputCellIds)}
      onLeaveSection={(section) => ackCells(section.leaves.flatMap((leaf) => leaf.inputCellIds))}
    />
  );
});
