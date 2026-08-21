import type { RefObject } from 'react';

import { renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { usePageStickyThreshold } from '@/hooks/use-page-sticky-threshold';

const observed: Element[] = [];
class ResizeObserverStub {
  observe(el: Element) {
    observed.push(el);
  }
  unobserve() {}
  disconnect() {}
}

/** 대상 요소가 뒤늦게 마운트돼도 deps 변경이 effect 를 재실행해 관찰을 붙인다. */
describe('usePageStickyThreshold deps 재부착', () => {
  beforeEach(() => {
    observed.length = 0;
    vi.stubGlobal('ResizeObserver', ResizeObserverStub);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('빈 표(ref null) → 행 채워짐(deps 변경) 전환 시 관찰을 시작하고, 같은 deps 재렌더에는 재부착하지 않는다', () => {
    const ref: RefObject<HTMLElement | null> = { current: null };
    const { rerender } = renderHook(({ empty }) => usePageStickyThreshold(ref, {}, [empty]), {
      initialProps: { empty: true },
    });
    expect(observed).toHaveLength(0);

    ref.current = document.createElement('div');
    rerender({ empty: false });
    expect(observed).toHaveLength(1);

    rerender({ empty: false });
    expect(observed).toHaveLength(1);
  });
});
