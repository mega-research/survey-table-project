export interface TrailingCoalescer {
  /** 실행을 요청한다. 첫 요청은 즉시, 창 안의 연속 요청은 정착 후 1회로 접힌다. */
  notify(): void;
  /** 대기 중인 trailing 실행을 취소한다 (언마운트 정리용). */
  cancel(): void;
}

/**
 * leading + trailing 디바운서.
 *
 * 첫 호출은 즉시 실행하고, 그 뒤 delayMs 창 안의 연속 호출은 창이 끝난 뒤 1회로 접는다.
 * 창 안에 추가 호출이 없었으면 trailing 은 실행하지 않는다.
 *
 * 용도: max-width 전환처럼 레이아웃이 프레임마다 바뀌는 구간에서 ResizeObserver 콜백이
 * 매 프레임 setState 를 일으켜 무거운 컴포넌트를 수십 번 리렌더시키는 것을 막는다.
 * 첫 값은 즉시 반영해 초기 렌더가 늦지 않게 하고, 최종 값은 정착 후 한 번 더 반영한다.
 */
export function createTrailingCoalescer(run: () => void, delayMs: number): TrailingCoalescer {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pending = false;

  const onWindowEnd = () => {
    timer = null;
    if (!pending) return;
    pending = false;
    run();
    // 정착 직후 또 변동이 오는 경우를 위해 창을 다시 연다.
    timer = setTimeout(onWindowEnd, delayMs);
  };

  return {
    notify() {
      if (timer !== null) {
        pending = true;
        return;
      }
      run();
      timer = setTimeout(onWindowEnd, delayMs);
    },
    cancel() {
      if (timer !== null) clearTimeout(timer);
      timer = null;
      pending = false;
    },
  };
}
