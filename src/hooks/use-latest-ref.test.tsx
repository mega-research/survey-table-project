import { renderHook } from '@testing-library/react';
import { useRef } from 'react';
import { describe, expect, it } from 'vitest';

import { useLatestRef, useSyncLatestRef } from '@/hooks/use-latest-ref';

describe('useLatestRef', () => {
  it('rerender 후에도 같은 ref 객체에 최신 값을 보관한다', () => {
    const { result, rerender } = renderHook(
      ({ value }: { value: string }) => useLatestRef(value),
      { initialProps: { value: '처음' } },
    );
    const firstRef = result.current;

    expect(firstRef.current).toBe('처음');

    rerender({ value: '갱신' });

    expect(result.current).toBe(firstRef);
    expect(result.current.current).toBe('갱신');
  });

  it('호출자가 만든 ref 객체를 최신 값으로 동기화한다', () => {
    const { result, rerender } = renderHook(
      ({ value }: { value: string }) => {
        const ref = useRef(value);
        useSyncLatestRef(ref, value);
        return ref;
      },
      { initialProps: { value: '처음' } },
    );
    const firstRef = result.current;

    rerender({ value: '갱신' });

    expect(result.current).toBe(firstRef);
    expect(result.current.current).toBe('갱신');
  });
});
