import { createRef } from 'react';

import { fireEvent, render, screen } from '@testing-library/react';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import { TableScrollControls } from '@/components/survey-builder/table-scroll-controls';

beforeAll(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
});

function renderControls() {
  const scrollRef = createRef<HTMLDivElement>();
  render(
    <>
      <div ref={scrollRef} />
      <TableScrollControls
        scrollRef={scrollRef}
        canScrollLeft
        canScrollRight
      />
    </>,
  );
  const element = scrollRef.current;
  if (!element) throw new Error('스크롤 요소가 없습니다.');
  Object.defineProperties(element, {
    clientWidth: { configurable: true, value: 200 },
    scrollWidth: { configurable: true, value: 1000 },
    scrollLeft: { configurable: true, writable: true, value: 100 },
  });
  const scrollTo = vi.fn();
  element.scrollTo = scrollTo as unknown as typeof element.scrollTo;
  fireEvent(window, new Event('resize'));
  return { element, scrollTo };
}

describe('TableScrollControls keyboard', () => {
  it('스크롤 트랙에 포커스와 Arrow/Home/End 키 조작을 제공한다', () => {
    const { scrollTo } = renderControls();
    const scrollbar = screen.getByRole('scrollbar', { name: '가로 스크롤' });
    expect(scrollbar).toHaveAttribute('tabindex', '0');

    fireEvent.keyDown(scrollbar, { key: 'ArrowRight' });
    expect(scrollTo).toHaveBeenLastCalledWith(
      expect.objectContaining({ left: 500 }),
    );
    fireEvent.keyDown(scrollbar, { key: 'Home' });
    expect(scrollTo).toHaveBeenLastCalledWith(
      expect.objectContaining({ left: 0 }),
    );
    fireEvent.keyDown(scrollbar, { key: 'End' });
    expect(scrollTo).toHaveBeenLastCalledWith(
      expect.objectContaining({ left: 800 }),
    );
  });
});
