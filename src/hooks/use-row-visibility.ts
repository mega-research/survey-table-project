/**
 * IntersectionObserver 기반 행 가시성 (이중 마진)
 *
 * - LOAD: 뷰포트 ±1500px에서 마운트 (보이기 전에 준비)
 * - UNLOAD: 뷰포트 ±3000px 밖이면 언마운트 (캐시 높이로 교체 → 지터 0)
 * - 포커스된 행은 절대 언마운트 안 함
 * - rowspan 병합 범위 확장
 */
import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';

import type { TableRow } from '@/types/survey';

const LOAD_MARGIN = '1500px 0px';
const UNLOAD_MARGIN = '3000px 0px';
const INITIAL_VISIBLE_COUNT = 30;
// 이 행 수 이상에서만 언로드 활성화 (그 미만은 never-unload)
const UNLOAD_THRESHOLD = 500;

interface MergedRange {
  startIdx: number;
  endIdx: number;
}

export interface RowVisibilityResult {
  isVisible(rowIdx: number): boolean;
  sentinelRef(rowIdx: number): (el: HTMLElement | null) => void;
}

function extractMergedRanges(displayRows: TableRow[]): MergedRange[] {
  const ranges: MergedRange[] = [];
  for (let rowIdx = 0; rowIdx < displayRows.length; rowIdx++) {
    const row = displayRows[rowIdx]!;
    for (const cell of row.cells) {
      if (cell.rowspan && cell.rowspan > 1) {
        ranges.push({
          startIdx: rowIdx,
          endIdx: Math.min(rowIdx + cell.rowspan - 1, displayRows.length - 1),
        });
      }
    }
  }
  return ranges;
}

function expandWithMergedRanges(set: Set<number>, ranges: MergedRange[]): void {
  for (const range of ranges) {
    let anyVisible = false;
    for (let i = range.startIdx; i <= range.endIdx; i++) {
      if (set.has(i)) { anyVisible = true; break; }
    }
    if (anyVisible) {
      for (let i = range.startIdx; i <= range.endIdx; i++) set.add(i);
    }
  }
}

export function useRowVisibility(
  displayRows: TableRow[],
  scrollRootRef?: RefObject<HTMLElement | null>,
): RowVisibilityResult {
  const rowCount = displayRows.length;
  const supportsIO = typeof IntersectionObserver !== 'undefined';

  const mergedRangesRef = useRef<MergedRange[]>([]);
  mergedRangesRef.current = extractMergedRanges(displayRows);

  const [visibleSet, setVisibleSet] = useState<Set<number>>(() => {
    const initial = new Set<number>();
    // IO 미지원 환경(SSR/구형 브라우저): 모든 행 마운트
    const count = supportsIO ? Math.min(INITIAL_VISIBLE_COUNT, rowCount) : rowCount;
    for (let i = 0; i < count; i++) initial.add(i);
    return initial;
  });

  const loadObserverRef = useRef<IntersectionObserver | null>(null);
  const unloadObserverRef = useRef<IntersectionObserver | null>(null);
  const sentinelsRef = useRef(new Map<number, HTMLElement>());

  useEffect(() => {
    if (!supportsIO) return;
    // 스크롤 루트: 지정되면 해당 요소(내부 스크롤 컨테이너), 없으면 뷰포트
    const root = scrollRootRef?.current ?? null;

    // 로드 IO: 1500px 마진으로 진입 감지
    loadObserverRef.current = new IntersectionObserver(
      (entries) => {
        const toAdd: number[] = [];
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const idx = Number((entry.target as HTMLElement).dataset['rowIdx']);
          if (!isNaN(idx)) toAdd.push(idx);
        }
        if (toAdd.length === 0) return;

        setVisibleSet((prev) => {
          if (toAdd.every((i) => prev.has(i))) return prev;
          const next = new Set(prev);
          for (const i of toAdd) next.add(i);
          expandWithMergedRanges(next, mergedRangesRef.current);
          return next;
        });
      },
      { root, rootMargin: LOAD_MARGIN },
    );

    // 언로드 IO: 500행+ 에서만 활성화 (그 미만은 never-unload → 깜빡임 0)
    if (rowCount >= UNLOAD_THRESHOLD) {
      unloadObserverRef.current = new IntersectionObserver(
        (entries) => {
          const toRemove: number[] = [];
          for (const entry of entries) {
            if (entry.isIntersecting) continue;
            const el = entry.target as HTMLElement;
            if (el.contains(document.activeElement)) continue;
            const idx = Number(el.dataset['rowIdx']);
            if (!isNaN(idx)) toRemove.push(idx);
          }
          if (toRemove.length === 0) return;

          setVisibleSet((prev) => {
            if (toRemove.every((i) => !prev.has(i))) return prev;
            const next = new Set(prev);
            for (const i of toRemove) next.delete(i);
            expandWithMergedRanges(next, mergedRangesRef.current);
            return next;
          });
        },
        { root, rootMargin: UNLOAD_MARGIN },
      );
    } else {
      // UNLOAD_THRESHOLD 미만에서는 언로드 IO를 새로 만들지 않음.
      // cleanup의 disconnect는 ref를 null화하지 않으므로, 직전 effect에서
      // 만들어진 disconnected observer가 stale 상태로 남아 재관찰되는 것을 차단.
      unloadObserverRef.current = null;
    }

    for (const [, el] of sentinelsRef.current) {
      loadObserverRef.current.observe(el);
      unloadObserverRef.current?.observe(el);
    }

    return () => {
      loadObserverRef.current?.disconnect();
      unloadObserverRef.current?.disconnect();
    };
  }, [rowCount, supportsIO, scrollRootRef]);

  // ref 함수 캐시 — 매 렌더마다 새 함수 생성 방지 (React.memo 보호)
  const sentinelRefCache = useRef(new Map<number, (el: HTMLElement | null) => void>());

  const sentinelRef = useCallback(
    (rowIdx: number) => {
      let cached = sentinelRefCache.current.get(rowIdx);
      if (!cached) {
        cached = (el: HTMLElement | null) => {
          if (el) {
            el.dataset['rowIdx'] = String(rowIdx);
            sentinelsRef.current.set(rowIdx, el);
            loadObserverRef.current?.observe(el);
            if (unloadObserverRef.current) unloadObserverRef.current.observe(el);
          } else {
            const prev = sentinelsRef.current.get(rowIdx);
            if (prev) {
              loadObserverRef.current?.unobserve(prev);
              if (unloadObserverRef.current) unloadObserverRef.current.unobserve(prev);
              sentinelsRef.current.delete(rowIdx);
            }
          }
        };
        sentinelRefCache.current.set(rowIdx, cached);
      }
      return cached;
    },
    [],
  );

  const isVisible = useCallback(
    (rowIdx: number) => (supportsIO ? visibleSet.has(rowIdx) : true),
    [visibleSet, supportsIO],
  );

  return { isVisible, sentinelRef };
}
