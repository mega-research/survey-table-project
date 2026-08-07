import { useCallback, useEffect, useState, type RefObject } from 'react';

interface Options {
  /** 양 끝 임계값(px). 이 값 이내로 스크롤되면 해당 측 섀도우를 숨긴다. */
  threshold?: number;
  /** 내용 변경 시 재측정을 위한 의존값 (예: 행·열 수). */
  deps?: ReadonlyArray<unknown>;
  /** true면 리스너/측정을 건너뛴다 (예: 모바일 모드). */
  disabled?: boolean;
}

/**
 * 가로 스크롤 컨테이너의 좌/우 스크롤 가능 여부를 추적한다.
 *
 * 반환값으로 좌/우 방향 각각 "더 스크롤 여지가 있는지"를 제공하여,
 * 호출 측에서 섀도우/스크롤 버튼의 표시 여부를 결정할 수 있게 한다.
 */
export function useHorizontalScrollIndicators(
  containerRef: RefObject<HTMLElement | null>,
  { threshold = 10, deps = [], disabled = false }: Options = {},
): { canScrollLeft: boolean; canScrollRight: boolean } {
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  const measure = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    const { scrollLeft, scrollWidth, clientWidth } = el;
    setCanScrollLeft(scrollLeft > threshold);
    setCanScrollRight(scrollLeft < scrollWidth - clientWidth - threshold);
  }, [containerRef, threshold]);

  useEffect(() => {
    if (disabled) return;
    const el = containerRef.current;
    if (!el) return;
    measure();
    el.addEventListener('scroll', measure, { passive: true });
    window.addEventListener('resize', measure);

    // 마운트 직후 measure() 1회로는 첫 페인트 시점의 레이아웃이 아직
    // 확정되지 않아 scrollWidth를 0/부정확하게 읽을 수 있다. ResizeObserver는
    // 관찰 시작 시 1회 콜백이 발화되므로 레이아웃 확정 시점에 자동 재측정한다.
    // 컨테이너(clientWidth)와 내부 그리드(scrollWidth) 양쪽 변동을 모두 추적.
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    if (el.firstElementChild) ro.observe(el.firstElementChild);

    return () => {
      el.removeEventListener('scroll', measure);
      window.removeEventListener('resize', measure);
      ro.disconnect();
    };
  }, [measure, disabled, containerRef]);

  // 콘텐츠 크기 변경(행/열 추가·삭제) 후 재측정
  useEffect(() => {
    if (disabled) return;
    measure();
    const id = setTimeout(measure, 100);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [measure, disabled, ...deps]);

  return { canScrollLeft, canScrollRight };
}
