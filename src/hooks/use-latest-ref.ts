import { useEffect, useLayoutEffect, useRef, type MutableRefObject } from 'react';

const useIsomorphicLayoutEffect =
  typeof window === 'undefined' ? useEffect : useLayoutEffect;

/**
 * 안정적인 ref 객체에 최신 값을 보관한다.
 *
 * render 중 ref 쓰기를 피해야 React Compiler가 순수 렌더로 판단할 수 있다.
 */
export function useLatestRef<T>(value: T): MutableRefObject<T> {
  const ref = useRef(value);

  useSyncLatestRef(ref, value);

  return ref;
}

/**
 * 호출자가 만든 안정적인 ref 객체에 최신 값을 동기화한다.
 */
export function useSyncLatestRef<T>(ref: MutableRefObject<T>, value: T): void {
  useIsomorphicLayoutEffect(() => {
    ref.current = value;
  }, [ref, value]);
}
