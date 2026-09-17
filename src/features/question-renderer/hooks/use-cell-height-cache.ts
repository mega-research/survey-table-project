/**
 * DOM 실측 높이 캐시
 *
 * 행이 뷰포트에 렌더된 후 실제 높이를 측정하여 캐시.
 * 뷰포트 이탈 시 이 캐시된 높이로 placeholder를 표시하면
 * 레이아웃 시프트가 0이 됨.
 */
import { useCallback, useEffect, useRef } from 'react';

import type { TableRow } from '@/types/survey';

export interface CellHeightCache {
  get(rowId: string): number | undefined;
  has(rowId: string): boolean;
  /** 행의 첫 셀 div에 연결 — 마운트 시 자동 측정 */
  measureRef(rowId: string): (el: HTMLElement | null) => void;
  /** 전체 캐시 클리어 (리사이즈, 모드 전환 등) */
  clear(): void;
}

export function useCellHeightCache(
  displayRows: TableRow[],
  columnWidths: number[],
): CellHeightCache {
  const cache = useRef(new Map<string, number>());
  const elements = useRef(new Map<string, HTMLElement>());

  // 열 너비 변경 → 캐시 무효화
  const prevWidthsRef = useRef(columnWidths);
  useEffect(() => {
    const prev = prevWidthsRef.current;
    if (prev.length !== columnWidths.length || prev.some((w, i) => w !== columnWidths[i])) {
      cache.current.clear();
      prevWidthsRef.current = columnWidths;
    }
  }, [columnWidths]);

  // 테스트 모드 전환: 캐시 유지 (행 높이는 모드와 무관)

  // displayRows 변경 → 없어진 행의 캐시 정리
  useEffect(() => {
    const currentIds = new Set(displayRows.map((r) => r.id));
    for (const cachedId of cache.current.keys()) {
      if (!currentIds.has(cachedId)) {
        cache.current.delete(cachedId);
        elements.current.delete(cachedId);
      }
    }
  }, [displayRows]);

  // ref 함수 캐시 — 매 렌더마다 새 함수 생성 방지 (React.memo 보호)
  const measureRefCache = useRef(new Map<string, (el: HTMLElement | null) => void>());

  const measureRef = useCallback(
    (rowId: string) => {
      let cached = measureRefCache.current.get(rowId);
      if (!cached) {
        cached = (el: HTMLElement | null) => {
          if (el) {
            elements.current.set(rowId, el);
            requestAnimationFrame(() => {
              if (el.isConnected) {
                cache.current.set(rowId, el.getBoundingClientRect().height);
              }
            });
          } else {
            elements.current.delete(rowId);
          }
        };
        measureRefCache.current.set(rowId, cached);
      }
      return cached;
    },
    [],
  );

  const get = useCallback((rowId: string) => cache.current.get(rowId), []);
  const has = useCallback((rowId: string) => cache.current.has(rowId), []);
  const clear = useCallback(() => cache.current.clear(), []);

  return { get, has, measureRef, clear };
}
