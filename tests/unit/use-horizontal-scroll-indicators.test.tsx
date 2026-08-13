import type { RefObject } from 'react';

import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useHorizontalScrollIndicators } from '@/hooks/use-horizontal-scroll-indicators';

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

function makeRef(element: HTMLElement): RefObject<HTMLElement | null> {
  return { current: element };
}

describe('useHorizontalScrollIndicators', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('ResizeObserver', ResizeObserverStub);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('터치 스크롤이 진행되는 동안에는 페이드 상태를 바꾸지 않고 스크롤이 멈춘 뒤 갱신한다', () => {
    const element = document.createElement('div');
    Object.defineProperties(element, {
      clientWidth: { configurable: true, value: 320 },
      scrollWidth: { configurable: true, value: 960 },
      scrollLeft: { configurable: true, writable: true, value: 0 },
    });

    const { result } = renderHook(() => useHorizontalScrollIndicators(makeRef(element)));
    expect(result.current).toEqual({
      canScrollLeft: false,
      canScrollRight: true,
    });

    act(() => {
      element.dispatchEvent(new Event('touchstart'));
      element.scrollLeft = 40;
      element.dispatchEvent(new Event('scroll'));
      vi.runOnlyPendingTimers();
    });

    // iOS WebKit에서는 진행 중인 pan에서 페이드 레이어가 바뀌면
    // 해당 제스처의 모멘텀이 끊긴다. 스크롤 이벤트 직후에는 DOM을 안정적으로 유지한다.
    expect(result.current.canScrollLeft).toBe(false);

    act(() => {
      element.dispatchEvent(new Event('touchend'));
      vi.runOnlyPendingTimers();
    });
    expect(result.current.canScrollLeft).toBe(true);
  });
});
