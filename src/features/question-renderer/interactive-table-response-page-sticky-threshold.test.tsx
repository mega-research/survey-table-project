import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { InteractiveTableResponse } from '@/features/question-renderer/interactive-table-response';
import type { TableColumn, TableRow } from '@/types/survey';

// 페이지 sticky 헤더 임계 분기 검증.
// - 짧은 표(기본 jsdom: offsetHeight=0): 단일 컨테이너 — 헤더가 본문 스크롤
//   컨테이너 안에 있고 sticky 래퍼 클래스가 없다.
// - 긴 표(offsetHeight 모킹으로 뷰포트 70% 초과): 이중 컨테이너 — 헤더가
//   sticky 래퍼 안에 별도 스크롤 컨테이너로 분리된다.

const columns: TableColumn[] = [
  { id: 'c1', label: '전혀 의향 없음' },
  { id: 'c2', label: '별로 의향 없음' },
];

const rows: TableRow[] = [
  {
    id: 'r1',
    label: '',
    cells: [
      { id: 'cell-1', type: 'radio', content: '' },
      { id: 'cell-2', type: 'radio', content: '' },
    ],
  },
];

// ResizeObserver 콜백 수집 — 높이 변경을 수동 발화시키기 위함
let roCallbacks: (() => void)[] = [];

beforeAll(() => {
  class ResizeObserverStub {
    constructor(cb: () => void) {
      roCallbacks.push(cb);
    }
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  globalThis.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver;
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: () => ({
      matches: false,
      addEventListener() {},
      removeEventListener() {},
    }),
  });
});

beforeEach(() => {
  roCallbacks = [];
});

afterEach(() => {
  cleanup();
});

function renderTable() {
  return render(
    <InteractiveTableResponse questionId="q1" columns={columns} rows={rows} />,
  );
}

function getScrollContainer(): HTMLElement {
  // 본문 가로 스크롤 컨테이너 (overflow-x-auto)
  const grid = screen.getByRole('grid');
  const container = grid.querySelector('.overflow-x-auto');
  if (!container) throw new Error('scroll container not found');
  return container as HTMLElement;
}

describe('표 페이지 sticky 임계 분기', () => {
  it('짧은 표는 단일 컨테이너 — 헤더가 본문 스크롤 컨테이너 안에 있고 sticky 가 없다', () => {
    renderTable();

    const container = getScrollContainer();
    const header = screen.getByRole('columnheader', { name: '전혀 의향 없음' });
    expect(container.contains(header)).toBe(true);

    const grid = screen.getByRole('grid');
    expect(grid.querySelector('.sticky.top-0')).toBeNull();
  });

  it('본문이 뷰포트 70% 를 넘으면 이중 컨테이너로 전환 — 헤더가 sticky 래퍼로 분리된다', () => {
    renderTable();
    const container = getScrollContainer();

    // 뷰포트 768(jsdom 기본) 대비 70% 초과 높이로 모킹 후 ResizeObserver 발화
    Object.defineProperty(container, 'offsetHeight', { configurable: true, value: 700 });
    act(() => {
      for (const cb of roCallbacks) cb();
    });

    const grid = screen.getByRole('grid');
    expect(grid.querySelector('.sticky.top-0')).not.toBeNull();
    const header = screen.getByRole('columnheader', { name: '전혀 의향 없음' });
    expect(container.contains(header)).toBe(false);

    // 히스테리시스: 50% 미만으로 줄어들 때까지는 sticky 유지
    Object.defineProperty(container, 'offsetHeight', { configurable: true, value: 450 });
    act(() => {
      for (const cb of roCallbacks) cb();
    });
    expect(grid.querySelector('.sticky.top-0')).not.toBeNull();

    // 50% 미만 → 단일 컨테이너 복귀
    Object.defineProperty(container, 'offsetHeight', { configurable: true, value: 300 });
    act(() => {
      for (const cb of roCallbacks) cb();
    });
    expect(grid.querySelector('.sticky.top-0')).toBeNull();
    expect(container.contains(screen.getByRole('columnheader', { name: '전혀 의향 없음' }))).toBe(
      true,
    );
  });

  it('빈 표 → 행 채워짐 전환 시에도 측정이 붙어 긴 표는 sticky 로 전환된다', () => {
    // 빈 표는 컨테이너 자체가 마운트되지 않는다 (early return)
    const { rerender } = render(
      <InteractiveTableResponse questionId="q1" columns={[]} rows={[]} />,
    );
    expect(screen.queryByRole('grid')).toBeNull();

    // 채워진 뒤 마운트되는 모든 요소가 큰 높이를 갖도록 프로토타입 모킹
    const proto = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight');
    Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
      configurable: true,
      get: () => 700,
    });
    try {
      rerender(<InteractiveTableResponse questionId="q1" columns={columns} rows={rows} />);
      // deps 변화로 effect 재실행 → 직접 measure → 700/768 > 0.7 → sticky
      const grid = screen.getByRole('grid');
      expect(grid.querySelector('.sticky.top-0')).not.toBeNull();
    } finally {
      if (proto) Object.defineProperty(HTMLElement.prototype, 'offsetHeight', proto);
      else Reflect.deleteProperty(HTMLElement.prototype, 'offsetHeight');
    }
  });

  it('표 높이 그대로 뷰포트 높이만 변해도 window resize 로 재판정한다', () => {
    renderTable();
    const container = getScrollContainer();
    Object.defineProperty(container, 'offsetHeight', { configurable: true, value: 400 });

    // 뷰포트 768 → ratio 0.52, 진입(0.7) 미달 → 단일 컨테이너 유지
    act(() => {
      window.dispatchEvent(new Event('resize'));
    });
    const grid = screen.getByRole('grid');
    expect(grid.querySelector('.sticky.top-0')).toBeNull();

    // 뷰포트 500 → ratio 0.8 → sticky 진입 (요소 높이 변화 없음 = RO 미발화 상황)
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 500 });
    act(() => {
      window.dispatchEvent(new Event('resize'));
    });
    expect(grid.querySelector('.sticky.top-0')).not.toBeNull();

    // 뷰포트 1000 → ratio 0.4 → 해제
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 1000 });
    act(() => {
      window.dispatchEvent(new Event('resize'));
    });
    expect(grid.querySelector('.sticky.top-0')).toBeNull();

    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 768 });
  });

  it('편집 요소 포커스 중(소프트 키보드) 리사이즈는 보류하고 blur 후 반영한다', () => {
    renderTable();
    const container = getScrollContainer();
    Object.defineProperty(container, 'offsetHeight', { configurable: true, value: 400 });

    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();

    // 키보드로 뷰포트 축소 (400/450 = 0.89 > 0.7 이지만 포커스 중 → 보류)
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 450 });
    act(() => {
      window.dispatchEvent(new Event('resize'));
    });
    const grid = screen.getByRole('grid');
    expect(grid.querySelector('.sticky.top-0')).toBeNull();

    // 키보드 닫힘: 뷰포트 복원 + blur → focusout 재측정 (0.52 → 여전히 비-sticky)
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 768 });
    act(() => {
      input.blur();
      window.dispatchEvent(new Event('focusout'));
    });
    expect(grid.querySelector('.sticky.top-0')).toBeNull();
    input.remove();
  });
});
