import { useSyncExternalStore } from 'react';

/**
 * matchMedia 기반 반응형 감지 훅.
 * - resize 이벤트 대신 matchMedia 'change' 이벤트만 구독 → 레이아웃 reflow 루프 방지
 * - SSR에서는 기본값(false) 반환, 클라이언트 mount 후 실제 값으로 전환
 */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onStoreChange) => {
      if (typeof window === 'undefined') return () => undefined;
      const mql = window.matchMedia(query);
      mql.addEventListener('change', onStoreChange);
      return () => mql.removeEventListener('change', onStoreChange);
    },
    () => (typeof window === 'undefined' ? false : window.matchMedia(query).matches),
    () => false,
  );
}

/** 768px 미만 = 모바일 (md 브레이크포인트). 태블릿은 데스크탑과 동일 취급 */
export function useMobileView(): boolean {
  return useMediaQuery('(max-width: 767px)');
}
