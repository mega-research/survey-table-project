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
  const [draft, setDraft] = useState(() => ({ source: externalValue, value: externalValue }));
  const pendingValueRef = useRef<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onCommitRef = useRef(onCommit);
  useSyncLatestRef(onCommitRef, onCommit);
  const localValue = draft.source === externalValue ? draft.value : externalValue;

  const handleChange = useCallback(
    (value: string) => {
      setDraft({ source: externalValue, value });
      pendingValueRef.current = value;
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        pendingValueRef.current = null;
        onCommitRef.current(value);
      }, delay);
    },
    [delay, externalValue],
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
