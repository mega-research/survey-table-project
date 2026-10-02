'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';

import { ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react';

import { cn } from '@/lib/utils';
import type { ClassifiedLeaf, ClassifiedSection } from '@/features/question-renderer/utils/classify-table';

export interface DrilldownStatus {
  completed: number;
  total: number;
  unit: '칸' | '개 항목' | '개 선택';
}

interface MobileDrilldownShellProps {
  sections: ClassifiedSection[];
  leafNavigation: 'matrix-only' | 'always';
  overallStatus?: DrilldownStatus | undefined;
  getSectionStatus: (section: ClassifiedSection) => DrilldownStatus;
  getLeafStatus: (leaf: ClassifiedLeaf) => DrilldownStatus;
  renderLeafDetail: (leaf: ClassifiedLeaf, section: ClassifiedSection) => React.ReactNode;
  renderLegacySection?: (section: ClassifiedSection) => React.ReactNode;
  /** 묶음 머리·계산 전용 요약의 값 줄(계산 셀들). 없으면 그 섹션들도 종전처럼 누르는 카드로 그린다. */
  renderSummary?: ((section: ClassifiedSection) => React.ReactNode) | undefined;
  /** 리프의 설명 셀 — 'card' 는 목차 카드 안(자세히=첫 줄, 바로표시=전문), 'full' 은 전문. 없으면 null. */
  renderDescription?:
    | ((leaf: ClassifiedLeaf, variant: 'card' | 'full') => React.ReactNode)
    | undefined;
  footer?: React.ReactNode;
  onLeaveLeafForward?: (leaf: ClassifiedLeaf) => void;
  onLeaveSection?: (section: ClassifiedSection) => void;
  onReturnToRoot?: () => void;
  /** 외부(오류 배너 "위치로 이동" 등)에서 특정 섹션/리프로 이동시키는 imperative 통로.
   *  마운트 시 이동 함수를 심고 언마운트 시 비운다. */
  navigateRef?: React.MutableRefObject<
    ((target: { sectionId: string | null; leafId: string | null }) => void) | null
  > | undefined;
}

export function getSectionIdentity(section: ClassifiedSection): string {
  return section.identity
    ?? section.labelSourceCellId
    ?? `${section.kind}:${section.label}`;
}

/** 묶음 머리·계산 전용 요약의 「설명 보기」 — 제목 줄 아래에 설명 전문을 펼친다. */
function GroupHeadDescription({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="inline-flex shrink-0 items-center gap-0.5 text-xs font-semibold text-blue-600"
      >
        설명 보기
        <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', open && 'rotate-180')} />
      </button>
      {open && <div className="basis-full rounded-lg bg-white/70 p-3">{children}</div>}
    </>
  );
}

export function MobileDrilldownShell({
  sections,
  leafNavigation,
  overallStatus,
  getSectionStatus,
  getLeafStatus,
  renderLeafDetail,
  renderLegacySection,
  renderSummary,
  renderDescription,
  footer,
  onLeaveLeafForward,
  onLeaveSection,
  onReturnToRoot,
  navigateRef,
}: MobileDrilldownShellProps) {
  const [nav, setNav] = useState<{ sectionId: string | null; leafId: string | null }>({
    sectionId: null,
    leafId: null,
  });

  useEffect(() => {
    if (!navigateRef) return;
    navigateRef.current = (target) => setNav(target);
    return () => {
      navigateRef.current = null;
    };
  }, [navigateRef]);
  const sectionEntries = useMemo(
    () => sections.map((section, index) => ({ id: getSectionIdentity(section), index, section })),
    [sections],
  );
  const selectedSectionEntry = nav.sectionId === null
    ? undefined
    : sectionEntries.find((entry) => entry.id === nav.sectionId);
  const section = selectedSectionEntry?.section;
  const sectionIndex = selectedSectionEntry?.index ?? null;
  const leafIndex = section && nav.leafId !== null
    ? section.leaves.findIndex((leaf) => leaf.rowId === nav.leafId)
    : null;
  const leaf = section && leafIndex != null && leafIndex >= 0
    ? section.leaves[leafIndex]
    : undefined;
  const sectionMissing = nav.sectionId !== null && !section;
  const leafMissing = section != null && nav.leafId !== null && !leaf;

  useEffect(() => {
    if (!sectionMissing && !leafMissing) return;

    const timeoutId = window.setTimeout(() => {
      if (sectionMissing) {
        // 조건부 표시 변경으로 현재 section이 사라진 경우도 명시적 목차 복귀와 같은
        // 수명주기다. 상세별 공유 상태(scroll 등)를 정확히 한 번 초기화한다.
        onReturnToRoot?.();
      }
      setNav((current) => {
        if (sectionMissing && current.sectionId === nav.sectionId) {
          return { sectionId: null, leafId: null };
        }
        if (
          leafMissing
          && current.sectionId === nav.sectionId
          && current.leafId === nav.leafId
        ) {
          return { sectionId: current.sectionId, leafId: null };
        }
        return current;
      });
    }, 0);

    return () => window.clearTimeout(timeoutId);
  }, [leafMissing, nav.leafId, nav.sectionId, onReturnToRoot, sectionMissing]);

  const rootRef = useRef<HTMLDivElement>(null);
  // 드릴다운 내부 이동(섹션 진입/목차 복귀) 시에만 상단을 화면에 맞춘다.
  // "첫 실행 스킵" ref 가드는 StrictMode(dev)의 이펙트 2회 실행에 뚫려
  // 페이지 입장만으로 스크롤이 튀므로, 이전 nav 와 실제로 달라졌는지 비교한다.
  const prevNav = useRef(nav);
  useEffect(() => {
    if (
      prevNav.current.sectionId === nav.sectionId &&
      prevNav.current.leafId === nav.leafId
    ) {
      return;
    }
    prevNav.current = nav;
    rootRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
  }, [nav]);

  const requiresLeafList = (section: ClassifiedSection) =>
    section.leaves.length === 0 ||
    (leafNavigation === 'always'
      ? section.leaves.length > 1
      : section.kind === 'matrix' && section.leaves.length > 1);

  const enterSection = (sectionIndex: number) => {
    const entry = sectionEntries[sectionIndex];
    if (!entry) return;
    if (leafNavigation === 'matrix-only' && entry.section.kind !== 'matrix') {
      setNav({ sectionId: entry.id, leafId: null });
      return;
    }
    setNav({
      sectionId: entry.id,
      leafId: requiresLeafList(entry.section) ? null : (entry.section.leaves[0]?.rowId ?? null),
    });
  };

  // 목차에서 들어갈 수 있는 섹션 — 묶음 머리·계산 전용 요약은 값만 보이는 블록이라 건너뛴다.
  const isEnterable = (target: ClassifiedSection) => !renderSummary || target.role === 'default';
  const adjacentEnterableIndex = (from: number, step: 1 | -1): number | null => {
    for (let i = from + step; i >= 0 && i < sections.length; i += step) {
      const candidate = sections[i];
      if (candidate && isEnterable(candidate)) return i;
    }
    return null;
  };

  const goToRoot = () => {
    if (section) onLeaveSection?.(section);
    setNav({ sectionId: null, leafId: null });
    onReturnToRoot?.();
  };

  const goToNextSection = (sectionIndex: number, section: ClassifiedSection) => {
    onLeaveSection?.(section);
    const next = adjacentEnterableIndex(sectionIndex, 1);
    if (next !== null) enterSection(next);
  };

  // 부제의 개수는 진행 뱃지·진행바와 같은 분모(입력이 있는 행)를 쓴다.
  // 계산 전용 행(합계 표시)은 상세 화면에는 보이지만 채울 것이 아니므로 세지 않는다 —
  // 여기 포함시키면 "입력 N개" 문구와 카운트 뱃지의 분모가 어긋난다.
  const inputLeafCount = (section: ClassifiedSection) =>
    section.leaves.filter((leaf) => leaf.inputCellIds.length > 0).length;
  const secSubText = (section: ClassifiedSection, status: DrilldownStatus) => {
    const inputs = inputLeafCount(section);
    // 계산 전용 섹션(합계 블록 등) — "입력 0개" 대신 표시 전용임을 그대로 알린다
    if (inputs === 0) return `표시 ${section.leaves.length}개`;
    return section.kind === 'matrix'
      ? // 선택형(choice) 테이블은 셀이 입력 칸이 아니라 선택지다 — "입력 6칸"으로 쓰면
        // 그룹당 1개만 고르면 되는 rad 그룹에서 6개를 다 채워야 하는 것처럼 읽힌다
        status.unit === '개 선택'
        ? `세부 ${inputs}개 · 선택지 ${section.totalInputs}개`
        : `세부 ${inputs}개 · 입력 ${section.totalInputs}칸`
      : section.kind === 'list'
        ? `항목 ${inputs}개`
        : `입력 ${inputs}개`;
  };

  const renderCrumb = ({ label, onBack }: { label: string; onBack: () => void }) => (
    <div className="mb-3 flex items-center gap-2">
      <button
        type="button"
        onClick={onBack}
        className="inline-flex min-h-11 shrink-0 items-center gap-1 rounded-lg bg-gray-100 px-3 py-2 text-sm font-semibold text-gray-600 active:bg-gray-200"
      >
        <ChevronLeft className="h-4 w-4" />
        뒤로
      </button>
      {/* key={label}: 라벨이 바뀔 때 리마운트되어 플래시 애니메이션 재생 — 섹션 전환 인지용 */}
      <span
        key={label}
        className="line-clamp-2 min-w-0 rounded-lg px-2.5 py-1 text-sm leading-snug font-semibold break-keep text-gray-900 animate-[drilldown-crumb-flash_1s_ease-out]"
      >
        {label}
      </span>
    </div>
  );

  const renderProgressBar = () => {
    const completed = overallStatus?.completed ?? 0;
    const total = overallStatus?.total ?? 0;
    const pct = total ? Math.round((completed / total) * 100) : 0;
    const showSectionNavigation = sectionIndex !== null && (nav.leafId === null || leafMissing);

    if (!showSectionNavigation && !overallStatus && !footer) return null;

    return (
      <div className="mt-4">
        {showSectionNavigation && (
          <div className="mb-3 flex gap-2.5">
            {/* 앞에 들어갈 섹션이 있으면 그리로 — 목차 복귀는 위의 「뒤로」가 맡는다 */}
            <button
              type="button"
              onClick={() => {
                const previous = adjacentEnterableIndex(sectionIndex, -1);
                if (previous !== null) enterSection(previous);
                else goToRoot();
              }}
              className="flex flex-1 items-center justify-center gap-1 rounded-xl border border-gray-200 bg-white py-3 text-sm font-semibold text-gray-600 active:bg-gray-50"
            >
              <ChevronLeft className="h-4 w-4" />
              {adjacentEnterableIndex(sectionIndex, -1) !== null ? '이전 섹션' : '목차로'}
            </button>
            {adjacentEnterableIndex(sectionIndex, 1) !== null && (
              <button
                type="button"
                onClick={() => {
                  const currentSection = sections[sectionIndex];
                  if (currentSection) goToNextSection(sectionIndex, currentSection);
                }}
                className="flex flex-1 items-center justify-center gap-1 rounded-xl border border-blue-200 bg-blue-50 py-3 text-sm font-semibold text-blue-600 active:bg-blue-100"
              >
                다음 섹션
                <ChevronRight className="h-4 w-4" />
              </button>
            )}
          </div>
        )}
        {overallStatus && (
          <>
            <div className="h-1.5 overflow-hidden rounded-full bg-gray-100">
              <div
                className="h-full rounded-full bg-blue-500 transition-all"
                style={{ width: `${pct}%` }}
              />
            </div>
            <div className="mt-1.5 flex justify-between text-xs text-gray-500">
              <span>
                전체 <b className="font-semibold text-gray-700">{completed}</b> / {total}
                {overallStatus.unit}
              </span>
              <span className="font-semibold text-gray-700">{pct}%</span>
            </div>
          </>
        )}
        {footer}
      </div>
    );
  };

  const renderSectionCard = (index: number) => {
    const cardSection = sections[index];
    if (!cardSection) return null;
    const status = getSectionStatus(cardSection);
    const full = status.total > 0 && status.completed === status.total;
    // 설명은 리프(행)의 것이라 한 행짜리 섹션의 카드에만 붙인다. 있으면 개수 부제 자리를 대신한다.
    const soleLeaf = cardSection.leaves.length === 1 ? cardSection.leaves[0] : undefined;
    const description = soleLeaf ? renderDescription?.(soleLeaf, 'card') : null;
    return (
      <button
        key={getSectionIdentity(cardSection)}
        type="button"
        onClick={() => enterSection(index)}
        className="flex w-full items-center gap-3 rounded-xl border border-gray-200 bg-white p-4 text-left active:bg-gray-50"
      >
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold text-gray-900">
            {cardSection.label || '항목'}
          </div>
          {description ? (
            <div className="mt-0.5">{description}</div>
          ) : (
            <div className="mt-0.5 text-xs text-gray-400">{secSubText(cardSection, status)}</div>
          )}
        </div>
        {/* total 0 = 전부 표시 전용(계산 셀만 있는 섹션) — 카운트 뱃지 생략 */}
        {status.total > 0 && (
          <span
            className={cn(
              'shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold',
              full ? 'bg-green-100 text-green-600' : 'bg-gray-100 text-gray-500',
            )}
          >
            {status.completed}/{status.total}
          </span>
        )}
        <ChevronRight className="h-4 w-4 shrink-0 text-gray-400" />
      </button>
    );
  };

  // 목차 블록 — 묶음 머리는 바로 뒤에 이어지는 자기 하위 섹션들을 품는다.
  type RootBlock =
    | { kind: 'card'; index: number }
    | { kind: 'summary'; index: number }
    | { kind: 'group'; index: number; children: number[] };
  const rootBlocks: RootBlock[] = [];
  sections.forEach((rootSection, index) => {
    // 묶음 소속을 역할보다 먼저 본다 — 묶음 안의 계산 전용 하위 행도 묶음을 끊지 않고 그 안에 남는다.
    const last = rootBlocks[rootBlocks.length - 1];
    const head = last?.kind === 'group' ? sections[last.index] : undefined;
    if (
      last?.kind === 'group' &&
      rootSection.role !== 'group-head' &&
      rootSection.groupHeadRowId !== undefined &&
      head?.groupHeadRowId === rootSection.groupHeadRowId
    ) {
      last.children.push(index);
      return;
    }
    if (isEnterable(rootSection)) rootBlocks.push({ kind: 'card', index });
    else if (rootSection.role === 'group-head') rootBlocks.push({ kind: 'group', index, children: [] });
    else rootBlocks.push({ kind: 'summary', index });
  });

  // 누르지 않는 블록의 제목 줄 — 제목 + (설명이 있으면) 「설명 보기」
  const renderBlockTitle = (blockSection: ClassifiedSection, className?: string) => {
    const headLeaf = blockSection.leaves[0];
    const description = headLeaf ? renderDescription?.(headLeaf, 'full') : null;
    return (
      <div className={cn('flex flex-wrap items-center gap-x-2 gap-y-2', className)}>
        <div className="min-w-0 flex-1 text-sm font-semibold text-gray-900">
          {blockSection.label || '항목'}
        </div>
        {description && <GroupHeadDescription>{description}</GroupHeadDescription>}
      </div>
    );
  };
  const renderSummaryBlock = (index: number) => {
    const blockSection = sections[index];
    if (!blockSection) return null;
    return (
      <div
        key={getSectionIdentity(blockSection)}
        role="group"
        aria-label={blockSection.label || '항목'}
        className="rounded-xl border border-gray-200 bg-gray-50 p-4"
      >
        {renderBlockTitle(blockSection)}
        <div className="mt-2">{renderSummary?.(blockSection)}</div>
      </div>
    );
  };

  if (nav.sectionId === null || !section || sectionIndex === null) {
    return (
      <div ref={rootRef}>
        <p className="mb-3 px-1 text-sm font-medium text-gray-500">작성할 항목을 선택하세요</p>
        <div className="space-y-2.5">
          {rootBlocks.map((block) => {
            if (block.kind === 'card') return renderSectionCard(block.index);
            if (block.kind === 'summary') return renderSummaryBlock(block.index);
            const blockSection = sections[block.index];
            if (!blockSection) return null;
            return (
              <div
                key={getSectionIdentity(blockSection)}
                role="group"
                aria-label={blockSection.label || '항목'}
                className="space-y-2.5 rounded-xl border border-blue-100 bg-blue-50/40 p-3"
              >
                {renderBlockTitle(blockSection, 'px-1')}
                <div>{renderSummary?.(blockSection)}</div>
                {block.children.map((childIndex) => {
                  const child = sections[childIndex];
                  return child && isEnterable(child)
                    ? renderSectionCard(childIndex)
                    : renderSummaryBlock(childIndex);
                })}
              </div>
            );
          })}
        </div>
        {renderProgressBar()}
      </div>
    );
  }

  if (leafNavigation === 'matrix-only' && section.kind !== 'matrix') {
    return (
      <div ref={rootRef}>
        {renderCrumb({ label: section.label || '항목', onBack: goToRoot })}
        {renderLegacySection?.(section)}
        {renderProgressBar()}
      </div>
    );
  }

  if (nav.leafId === null || !leaf || leafIndex === null || leafIndex < 0) {
    return (
      <div ref={rootRef}>
        {renderCrumb({ label: section.label || '항목', onBack: goToRoot })}
        <div className="space-y-2.5">
          {section.leaves.map((leaf, leafIndex) => {
            const previousSubGroup = section.leaves[leafIndex - 1]?.subGroup ?? null;
            const showDivider = leaf.subGroup !== previousSubGroup && !!leaf.subGroup;
            const status = getLeafStatus(leaf);
            const full = status.total > 0 && status.completed === status.total;
            return (
              <React.Fragment key={leaf.rowId}>
                {showDivider && (
                  <div className="px-1 pt-1 text-xs font-semibold text-gray-500">
                    {leaf.subGroup}
                  </div>
                )}
                <button
                  type="button"
                  onClick={() => setNav({ sectionId: nav.sectionId, leafId: leaf.rowId })}
                  className="flex w-full items-center gap-3 rounded-xl border border-gray-200 bg-white p-4 text-left active:bg-gray-50"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-semibold text-gray-900">{leaf.label}</span>
                    {renderDescription?.(leaf, 'card')}
                  </span>
                  {/* total 0 = 채울 것이 없는 표시 전용 행(계산 셀만 있는 행) — 카운트 뱃지 생략 */}
                  {status.total > 0 && (
                    <span
                      className={cn(
                        'shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold',
                        full ? 'bg-green-100 text-green-600' : 'bg-gray-100 text-gray-500',
                      )}
                    >
                      {status.completed}/{status.total}
                    </span>
                  )}
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

  const usesLeafList = requiresLeafList(section);
  const isFirstLeaf = leafIndex <= 0;
  const isLastLeaf = leafIndex >= section.leaves.length - 1;
  const hasNextSection = adjacentEnterableIndex(sectionIndex, 1) !== null;
  const previousSectionIndex = adjacentEnterableIndex(sectionIndex, -1);
  const onlyRootExit =
    isFirstLeaf && isLastLeaf && !hasNextSection && previousSectionIndex === null;
  const navGray =
    'flex flex-1 items-center justify-center gap-1 rounded-xl border border-gray-200 bg-white py-3 text-sm font-semibold text-gray-600 active:bg-gray-50';
  const navBlue =
    'flex flex-1 items-center justify-center gap-1 rounded-xl border border-blue-200 bg-blue-50 py-3 text-sm font-semibold text-blue-600 active:bg-blue-100';
  const backToLeaves = () =>
    (usesLeafList
      ? setNav({ sectionId: nav.sectionId, leafId: null })
      : goToRoot());

  return (
    <div ref={rootRef}>
      {renderCrumb({
        label: !usesLeafList
          ? section.label || '항목'
          : leaf.subGroup && leaf.subGroup !== leaf.label
            ? `${leaf.subGroup} › ${leaf.label}`
            : leaf.label,
        onBack: backToLeaves,
      })}
      {renderLeafDetail(leaf, section)}
      {onlyRootExit ? (
        <div className="mt-3">
          <button type="button" onClick={goToRoot} className={cn(navGray, 'w-full')}>
            <ChevronLeft className="h-4 w-4" />
            목차로
          </button>
        </div>
      ) : (
        <div className="mt-3 flex gap-2.5">
          {isFirstLeaf && previousSectionIndex !== null ? (
            // 앞 섹션으로 — 목차 복귀는 위의 「뒤로」가 맡는다. 뒤로 가는 이동은 빈 칸을 확정하지 않는다.
            <button
              type="button"
              onClick={() => enterSection(previousSectionIndex)}
              className={navGray}
            >
              <ChevronLeft className="h-4 w-4" />
              이전 섹션
            </button>
          ) : isFirstLeaf ? (
            <button type="button" onClick={goToRoot} className={navGray}>
              <ChevronLeft className="h-4 w-4" />
              목차로
            </button>
          ) : (
            <button
              type="button"
              onClick={() =>
                setNav({
                  sectionId: nav.sectionId,
                  leafId: section.leaves[leafIndex - 1]?.rowId ?? null,
                })
              }
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
                onLeaveLeafForward?.(leaf);
                setNav({
                  sectionId: nav.sectionId,
                  leafId: section.leaves[leafIndex + 1]?.rowId ?? null,
                });
              }}
              className={navBlue}
            >
              다음 항목
              <ChevronRight className="h-4 w-4" />
            </button>
          ) : hasNextSection ? (
            <button
              type="button"
              onClick={() => goToNextSection(sectionIndex, section)}
              className={navBlue}
            >
              다음 섹션
              <ChevronRight className="h-4 w-4" />
            </button>
          ) : (
            <button type="button" onClick={goToRoot} className={navBlue}>
              목차로
              <ChevronRight className="h-4 w-4" />
            </button>
          )}
        </div>
      )}
      {renderProgressBar()}
    </div>
  );
}
