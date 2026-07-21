'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';

import { ChevronLeft, ChevronRight } from 'lucide-react';

import { cn } from '@/lib/utils';
import type { ClassifiedLeaf, ClassifiedSection } from '@/utils/classify-table';

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
  footer?: React.ReactNode;
  onLeaveLeafForward?: (leaf: ClassifiedLeaf) => void;
  onLeaveSection?: (section: ClassifiedSection) => void;
  onReturnToRoot?: () => void;
}

function getSectionIdentity(section: ClassifiedSection): string {
  return section.labelSourceCellId
    ?? `${section.kind}:${section.label}`;
}

export function MobileDrilldownShell({
  sections,
  leafNavigation,
  overallStatus,
  getSectionStatus,
  getLeafStatus,
  renderLeafDetail,
  renderLegacySection,
  footer,
  onLeaveLeafForward,
  onLeaveSection,
  onReturnToRoot,
}: MobileDrilldownShellProps) {
  const [nav, setNav] = useState<{ sectionId: string | null; leafId: string | null }>({
    sectionId: null,
    leafId: null,
  });
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
  }, [leafMissing, nav.leafId, nav.sectionId, sectionMissing]);

  const rootRef = useRef<HTMLDivElement>(null);
  const isFirstNav = useRef(true);
  useEffect(() => {
    if (isFirstNav.current) {
      isFirstNav.current = false;
      return;
    }
    rootRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
  }, [nav.sectionId, nav.leafId]);

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

  const goToRoot = () => {
    if (section) onLeaveSection?.(section);
    setNav({ sectionId: null, leafId: null });
    onReturnToRoot?.();
  };

  const goToNextSection = (sectionIndex: number, section: ClassifiedSection) => {
    onLeaveSection?.(section);
    enterSection(sectionIndex + 1);
  };

  const secSubText = (section: ClassifiedSection) =>
    section.kind === 'matrix'
      ? `세부 ${section.leaves.length}개 · 입력 ${section.totalInputs}칸`
      : section.kind === 'list'
        ? `항목 ${section.leaves.length}개`
        : `입력 ${section.leaves.length}개`;

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
      <span className="min-w-0 truncate text-sm font-semibold text-gray-900">{label}</span>
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
            <button
              type="button"
              onClick={goToRoot}
              className="flex flex-1 items-center justify-center gap-1 rounded-xl border border-gray-200 bg-white py-3 text-sm font-semibold text-gray-600 active:bg-gray-50"
            >
              <ChevronLeft className="h-4 w-4" />
              목차로
            </button>
            {sectionIndex < sections.length - 1 && (
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

  if (nav.sectionId === null || !section || sectionIndex === null) {
    return (
      <div ref={rootRef}>
        <p className="mb-3 px-1 text-sm font-medium text-gray-500">작성할 항목을 선택하세요</p>
        <div className="space-y-2.5">
          {sections.map((section, sectionIndex) => {
            const status = getSectionStatus(section);
            const full = status.total > 0 && status.completed === status.total;
            return (
              <button
                key={getSectionIdentity(section)}
                type="button"
                onClick={() => enterSection(sectionIndex)}
                className="flex w-full items-center gap-3 rounded-xl border border-gray-200 bg-white p-4 text-left active:bg-gray-50"
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-semibold text-gray-900">
                    {section.label || '항목'}
                  </div>
                  <div className="mt-0.5 text-xs text-gray-400">{secSubText(section)}</div>
                </div>
                <span
                  className={cn(
                    'shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold',
                    full ? 'bg-green-100 text-green-600' : 'bg-gray-100 text-gray-500',
                  )}
                >
                  {status.completed}/{status.total}
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
                  <span className="min-w-0 flex-1 text-sm font-semibold text-gray-900">
                    {leaf.label}
                  </span>
                  <span
                    className={cn(
                      'shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold',
                      full ? 'bg-green-100 text-green-600' : 'bg-gray-100 text-gray-500',
                    )}
                  >
                    {status.completed}/{status.total}
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

  const usesLeafList = requiresLeafList(section);
  const isFirstLeaf = leafIndex <= 0;
  const isLastLeaf = leafIndex >= section.leaves.length - 1;
  const hasNextSection = sectionIndex < sections.length - 1;
  const onlyRootExit = isFirstLeaf && isLastLeaf && !hasNextSection;
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
          {isFirstLeaf ? (
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
