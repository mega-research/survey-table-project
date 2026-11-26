import { useEffect, useLayoutEffect, useState, type RefObject } from 'react';

import { createTrailingCoalescer } from '@/features/question-renderer/utils/trailing-coalescer';

/**
 * 측정 코얼레싱 창(ms). 응답 페이지 컨테이너의 max-width 전환(300ms)처럼 레이아웃이
 * 프레임마다 바뀌는 구간에서 프레임당 setState 가 나가는 것을 막는다.
 */
const MEASURE_COALESCE_MS = 100;

/** 요소의 clientWidth 를 한 번 재고 ResizeObserver 로 따라간다. 정리 함수를 돌려준다. */
function observeElementWidth(el: HTMLElement, setWidth: (width: number) => void): () => void {
  const measure = () => setWidth(el.clientWidth);
  measure();

  // 폭 전환 중에는 ResizeObserver 가 프레임마다 발화한다. 그대로 흘리면 이 값을 쓰는
  // 표가 매 프레임 리렌더된다. 첫 값은 즉시, 이후는 창당 1회로 접는다.
  const coalescer = createTrailingCoalescer(measure, MEASURE_COALESCE_MS);
  const ro = new ResizeObserver(() => coalescer.notify());
  ro.observe(el);
  return () => {
    ro.disconnect();
    coalescer.cancel();
  };
}

/**
 * 요소의 clientWidth(보이는 가로 폭)를 ResizeObserver로 추적한다.
 *
 * 마운트 직후 측정 전에는 0을 반환하므로, 호출 측에서 0을 "아직 미측정"으로
 * 다뤄 fallback 동작(예: 제한 없음)을 적용한다. 레이아웃 변동·창 크기 변경마다
 * 자동 재측정되어 반응형 계산의 입력으로 쓸 수 있다.
 *
 * @param disabled true면 관찰하지 않고 0을 유지한다 (예: 모바일/sticky 비활성)
 */
export function useElementWidth(
  ref: RefObject<HTMLElement | null>,
  disabled = false,
): number {
  const [width, setWidth] = useState(0);

  useEffect(() => {
    // disabled면 관찰하지 않는다. 직전 측정값은 그대로 두되, 호출 측이 disabled
    // 동안에는 이 값을 쓰지 않도록 가드한다(재활성 시 measure가 즉시 덮어씀).
    if (disabled) return;
    const el = ref.current;
    if (!el) return;
    return observeElementWidth(el, setWidth);
  }, [ref, disabled]);

  return width;
}

/**
 * `useElementWidth` 와 같되 **첫 측정을 그리기 전에** 끝낸다(useLayoutEffect).
 *
 * 측정한 폭으로 열 폭을 정하는 표(조각 한 화면 칸 수)는 측정 전 폭으로 한 번 그려졌다가 바뀌면 칸이 튄다.
 * 레이아웃 이펙트 안의 setState 는 그리기 전에 다시 렌더되므로 응답자는 맞는 폭만 본다. 그 대신 커밋마다
 * 동기 렌더가 한 번 더 들어가니, 폭이 그리기 결과를 바꾸는 자리에만 쓴다.
 */
export function useElementWidthBeforePaint(
  ref: RefObject<HTMLElement | null>,
  disabled = false,
): number {
  const [width, setWidth] = useState(0);

  useLayoutEffect(() => {
    if (disabled) return;
    const el = ref.current;
    if (!el) return;
    return observeElementWidth(el, setWidth);
  }, [ref, disabled]);

  return width;
}
