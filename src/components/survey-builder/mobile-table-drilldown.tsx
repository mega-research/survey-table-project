'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';

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

  const [nav, setNav] = useState<{ sec: number | null; leaf: number | null }>({
    sec: null,
    leaf: null,
  });

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

  // 리프가 1개뿐인 matrix 섹션은 "리프 목록" 군더더기 단계를 건너뛰고 바로 입력 폼으로 진입한다.
  // (scalar/list 섹션은 원래 목록 없이 바로 폼이라 leaf:null 그대로 둔다.)
  const enterSection = (si: number) => {
    const sec = sections[si];
    if (!sec) return;
    const direct = sec.kind === 'matrix' && sec.leaves.length === 1;
    setNav({ sec: si, leaf: direct ? 0 : null });
  };

  // 섹션/리프 이동 시(다음 섹션·목차로·뒤로·진입) 본문 컨테이너 상단으로 올린다.
  // window 최상단(설문 헤더)까지 올리지 않고, 드릴다운 root 만 화면 상단에 맞춘다.
  const rootRef = useRef<HTMLDivElement>(null);
  const isFirstNav = useRef(true);
  useEffect(() => {
    // 최초 마운트(섹션 진입 직후)에는 스크롤하지 않는다 — step 전환 시 이미 상단 정렬됨.
    if (isFirstNav.current) {
      isFirstNav.current = false;
      return;
    }
    rootRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [nav.sec, nav.leaf]);

  // 들어갔던 섹션을 빠져나오는 순간(다음 섹션·목차로·다른 섹션 진입) 그 섹션의 모든
  // 입력 칸을 거쳐간 것으로 확정한다. 나가는 경로와 무관하게 nav.sec 변화 한 곳에서 처리하므로
  // "다음 섹션" 버튼이 없는 마지막 섹션도 목차로 빠져나올 때 100%까지 채워진다.
  // 단, TOC→섹션 첫 진입(이전 sec이 null)과 뒤로 가기는 확정하지 않는다(앞으로 나아간 게 아님).
  const prevSecRef = useRef<number | null>(null);
  useEffect(() => {
    const prev = prevSecRef.current;
    if (prev !== null && prev !== nav.sec && sections[prev]) {
      ackCells(sections[prev].leaves.flatMap((l) => l.inputCellIds));
    }
    prevSecRef.current = nav.sec;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nav.sec, sections]);

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
  const leafFilled = (l: ClassifiedLeaf) => l.inputCellIds.filter(counted).length;
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
      <div className={cn(errorCellIds?.has(cellId) && 'ring-2 ring-inset ring-red-300')}>
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

  const secSubText = (s: ClassifiedSection) =>
    s.kind === 'matrix'
      ? `세부 ${s.leaves.length}개 · 입력 ${s.totalInputs}칸`
      : s.kind === 'list'
        ? `항목 ${s.leaves.length}개`
        : `입력 ${s.leaves.length}개`;

  // ── breadcrumb ──
  // 컴포넌트(<Crumb/>)가 아니라 렌더 함수로 호출한다. JSX 엘리먼트로 쓰면 부모 리렌더(셀 입력 등)
  // 마다 함수 정체성이 새로 생겨 React가 서브트리를 remount 한다 — 직접 호출은 부모에 인라인된다.
  const renderCrumb = ({ label, onBack }: { label: string; onBack: () => void }) => (
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

  // ── 진행률 바 (+ 섹션 진입 시 목차로 / 다음 섹션 네비) ──
  // Crumb 과 동일 이유로 컴포넌트가 아닌 렌더 함수로 호출한다(remount 회피).
  const renderProgressBar = () => {
    const sec = nav.sec;
    return (
      <div className="mt-4">
        {sec !== null && nav.leaf === null && (
          <div className="mb-3 flex gap-2.5">
            <button
              type="button"
              onClick={() => setNav({ sec: null, leaf: null })}
              className="flex flex-1 items-center justify-center gap-1 rounded-xl border border-gray-200 bg-white py-3 text-sm font-semibold text-gray-600 active:bg-gray-50"
            >
              <ChevronLeft className="h-4 w-4" />
              목차로
            </button>
            {sec < sections.length - 1 && (
              <button
                type="button"
                onClick={() => enterSection(sec + 1)}
                className="flex flex-1 items-center justify-center gap-1 rounded-xl border border-blue-200 bg-blue-50 py-3 text-sm font-semibold text-blue-600 active:bg-blue-100"
              >
                다음 섹션
                <ChevronRight className="h-4 w-4" />
              </button>
            )}
          </div>
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
  };

  // ── 루트: 섹션 목차 ──
  if (nav.sec === null) {
    return (
      <div ref={rootRef}>
        <p className="mb-3 px-1 text-sm font-medium text-gray-500">작성할 항목을 선택하세요</p>
        <div className="space-y-2.5">
          {sections.map((s, si) => {
            const f = secFilled(s);
            const full = s.totalInputs > 0 && f === s.totalInputs;
            return (
              <button
                key={si}
                type="button"
                onClick={() => enterSection(si)}
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
        {renderProgressBar()}
      </div>
    );
  }

  const s = sections[nav.sec];
  const backToRoot = () => setNav({ sec: null, leaf: null });

  if (!s) return null;

  // ── scalar / list 섹션 ──
  if (s.kind === 'scalar' || s.kind === 'list') {
    return (
      <div ref={rootRef}>
        {renderCrumb({ label: s.label || '항목', onBack: backToRoot })}
        <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
          <div className="border-b bg-gray-50/80 px-4 py-3 text-sm font-semibold text-gray-700">
            {s.label || '입력'}
          </div>
          <div className="divide-y divide-gray-100 px-3 py-1">
            {s.leaves.map((l) => {
              const done = leafDone(l);
              return (
                <div key={l.rowId} className="py-3">
                  <div className="mb-1.5 flex items-center gap-1.5">
                    <span
                      className={cn(
                        'text-sm font-medium',
                        done ? 'text-green-600' : 'text-gray-900',
                      )}
                    >
                      {l.label}
                    </span>
                    {done && <CheckCircle2 className="h-4 w-4 shrink-0 text-green-500" />}
                  </div>
                  {l.inputCellIds[0] != null && renderCell(l.inputCellIds[0])}
                </div>
              );
            })}
          </div>
        </div>
        {renderProgressBar()}
      </div>
    );
  }

  // ── matrix 섹션 ──
  if (nav.leaf === null) {
    // 리프 목록 (하위 그룹 구분선)
    let lastSub: string | null = null;
    return (
      <div ref={rootRef}>
        {renderCrumb({ label: s.label || '항목', onBack: backToRoot })}
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
        {renderProgressBar()}
      </div>
    );
  }

  // matrix 리프 폼 (열 그룹별 입력)
  const leaf = s.leaves[nav.leaf];
  if (!leaf) return null;
  // 리프 1개 섹션은 enterSection 이 목차→폼으로 직행시킨 경우라, '뒤로'도 리프 목록이 아닌
  // 목차로 보낸다. enterSection 의 직행 판정과 동일 기준(matrix·리프 1개)으로 맞춘다.
  // (이 경로는 scalar/list 가 위에서 early-return 되어 항상 matrix)
  const isSingleLeaf = s.leaves.length === 1;
  const backToLeaves = () => (isSingleLeaf ? backToRoot() : setNav({ sec: nav.sec, leaf: null }));
  // 하단 네비: disabled 로 죽이지 않고 위치별로 라벨·이동을 바꿔 항상 빠져나갈 길을 둔다.
  const leafIdx = nav.leaf;
  const secIdx = nav.sec;
  const isFirstLeaf = leafIdx <= 0;
  const isLastLeaf = leafIdx >= s.leaves.length - 1;
  const hasNextSection = secIdx < sections.length - 1;
  // 리프 1개 + 마지막 섹션: 좌·우 모두 '목차로'가 되어 중복 → 단일 버튼으로 합친다.
  const onlyRootExit = isFirstLeaf && isLastLeaf && !hasNextSection;
  const navGray =
    'flex flex-1 items-center justify-center gap-1 rounded-xl border border-gray-200 bg-white py-3 text-sm font-semibold text-gray-600 active:bg-gray-50';
  const navBlue =
    'flex flex-1 items-center justify-center gap-1 rounded-xl border border-blue-200 bg-blue-50 py-3 text-sm font-semibold text-blue-600 active:bg-blue-100';
  return (
    <div ref={rootRef}>
      {renderCrumb({
        label: isSingleLeaf
          ? s.label || '항목'
          : leaf.subGroup && leaf.subGroup !== leaf.label
            ? `${leaf.subGroup} › ${leaf.label}`
            : leaf.label,
        onBack: backToLeaves,
      })}
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
                  // 실제 열 인덱스(c.col)로 이 리프의 입력 셀을 찾는다. 비대칭 matrix 에서
                  // 행마다 채운 열이 달라도 셀이 올바른 열 라벨 아래 렌더된다.
                  const cellId = leaf.cellByCol[c.col];
                  if (cellId == null) return null;
                  const cell = cellById.get(cellId);
                  if (!cell) return null;
                  // 일반 테이블 카드(mobile-row-card)와 동일한 라벨 위계:
                  // 파란 점 불릿 + text-sm gray-900. 라벨이 주, 문항(cell.content)이 보조.
                  const label = cell.exportLabel?.trim() || c.label || '';
                  return (
                    <div key={c.col} className="space-y-1">
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
      {onlyRootExit ? (
        <div className="mt-3">
          <button type="button" onClick={backToRoot} className={cn(navGray, 'w-full')}>
            <ChevronLeft className="h-4 w-4" />
            목차로
          </button>
        </div>
      ) : (
        <div className="mt-3 flex gap-2.5">
          {isFirstLeaf ? (
            <button type="button" onClick={backToRoot} className={navGray}>
              <ChevronLeft className="h-4 w-4" />
              목차로
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setNav({ sec: nav.sec, leaf: leafIdx - 1 })}
              className={navGray}
            >
              <ChevronLeft className="h-4 w-4" />
              이전 항목
            </button>
          )}
          {!isLastLeaf ? (
            <button
              type="button"
              onClick={() => {
                ackCells(leaf.inputCellIds);
                setNav({ sec: nav.sec, leaf: leafIdx + 1 });
              }}
              className={navBlue}
            >
              다음 항목
              <ChevronRight className="h-4 w-4" />
            </button>
          ) : hasNextSection ? (
            <button
              type="button"
              onClick={() => enterSection(secIdx + 1)}
              className={navBlue}
            >
              다음 섹션
              <ChevronRight className="h-4 w-4" />
            </button>
          ) : (
            <button type="button" onClick={backToRoot} className={navBlue}>
              목차로
              <ChevronRight className="h-4 w-4" />
            </button>
          )}
        </div>
      )}
      {renderProgressBar()}
    </div>
  );
});
