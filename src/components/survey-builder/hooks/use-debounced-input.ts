import { useCallback, useEffect, useRef, useState } from 'react';

import { useSyncLatestRef } from '@/hooks/use-latest-ref';

/**
 * 대량 테이블 에디터용 debounced input 훅.
 * 로컬 state로 즉각적인 UI 반응을 유지하면서,
 * 부모 콜백 호출은 debounce하여 불필요한 재렌더를 방지.
 */
export function useDebouncedInput(
  externalValue: string,
  onCommit: (value: string) => void,
  delay: number = 150,
) {
  const [localValue, setLocalValue] = useState(externalValue);
  const lastCommittedRef = useRef(externalValue);
  const pendingValueRef = useRef<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onCommitRef = useRef(onCommit);
  useSyncLatestRef(onCommitRef, onCommit);

  // 외부 값이 변경되었을 때 (사용자 타이핑이 아닌 경우에만) 로컬 동기화
  useEffect(() => {
    if (externalValue !== lastCommittedRef.current) {
      setLocalValue(externalValue);
      lastCommittedRef.current = externalValue;
    }
  }, [externalValue]);

  const handleChange = useCallback(
    (value: string) => {
      setLocalValue(value);
      pendingValueRef.current = value;
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        pendingValueRef.current = null;
        lastCommittedRef.current = value;
        onCommitRef.current(value);
      }, delay);
    },
    [delay],
  );

  const flushPending = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
      if (pendingValueRef.current !== null) {
        onCommitRef.current(pendingValueRef.current);
      }
    }
  }, []);

  // unmount 시 pending debounce flush (데이터 유실 방지)
  useEffect(() => {
    return flushPending;
  }, [flushPending]);

  return [localValue, handleChange] as const;
}
