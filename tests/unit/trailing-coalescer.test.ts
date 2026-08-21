import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createTrailingCoalescer } from '@/features/question-renderer/utils/trailing-coalescer';

// max-width 가 애니메이션되면 ResizeObserver 가 프레임마다 발화한다. 매 발화를 setState 로
// 흘리면 표가 수십 번 리렌더된다. leading + trailing 으로 접어 2회로 줄이는 것이 목적.
describe('createTrailingCoalescer', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('첫 호출은 즉시 실행한다', () => {
    const run = vi.fn();
    const c = createTrailingCoalescer(run, 100);

    c.notify();

    expect(run).toHaveBeenCalledTimes(1);
  });

  it('창 안의 연속 호출은 즉시 실행하지 않는다', () => {
    const run = vi.fn();
    const c = createTrailingCoalescer(run, 100);

    c.notify();
    c.notify();
    c.notify();

    expect(run).toHaveBeenCalledTimes(1);
  });

  it('창보다 짧은 다발은 2회로 접는다', () => {
    const run = vi.fn();
    const c = createTrailingCoalescer(run, 100);

    for (let i = 0; i < 5; i++) {
      c.notify();
      vi.advanceTimersByTime(16);
    }
    vi.advanceTimersByTime(200);

    // leading 1회 + 정착 후 trailing 1회
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('창보다 긴 다발은 창당 1회로 스로틀한다', () => {
    const run = vi.fn();
    const c = createTrailingCoalescer(run, 100);

    // 300ms 전환 ≈ 60fps 18프레임(288ms). 창(100ms)을 넘으므로 중간 값도 반영된다 —
    // 전환 내내 옛 폭에 머무르지 않게 하려는 의도적 동작.
    for (let i = 0; i < 18; i++) {
      c.notify();
      vi.advanceTimersByTime(16);
    }
    vi.advanceTimersByTime(200);

    // leading 1회 + 100ms 창마다 1회. 18회 발화가 4회 실행으로 접힌다.
    expect(run).toHaveBeenCalledTimes(4);
  });

  it('조용해진 뒤의 호출은 다시 즉시 실행한다', () => {
    const run = vi.fn();
    const c = createTrailingCoalescer(run, 100);

    c.notify();
    vi.advanceTimersByTime(500);
    run.mockClear();

    c.notify();

    expect(run).toHaveBeenCalledTimes(1);
  });

  it('창 안에 호출이 없었으면 trailing 을 실행하지 않는다', () => {
    const run = vi.fn();
    const c = createTrailingCoalescer(run, 100);

    c.notify();
    vi.advanceTimersByTime(500);

    expect(run).toHaveBeenCalledTimes(1);
  });

  it('cancel 하면 대기 중 trailing 이 실행되지 않는다', () => {
    const run = vi.fn();
    const c = createTrailingCoalescer(run, 100);

    c.notify();
    c.notify();
    c.cancel();
    vi.advanceTimersByTime(500);

    // 언마운트 후 setState 를 막는다
    expect(run).toHaveBeenCalledTimes(1);
  });
});
