import { useEffect, useState, type RefObject } from 'react';

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

    const measure = () => setWidth(el.clientWidth);
    measure();

    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref, disabled]);

  return width;
}
