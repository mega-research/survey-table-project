import { useEffect, type RefObject } from 'react';

interface Options {
  /** 양 끝 임계값(px). 이 값 이내로 스크롤되면 해당 측 페이드를 숨긴다. */
  threshold?: number;
  /** 내용 변경 시 재측정·재부착을 위한 의존값 (예: 행·열 수, sticky 모드 전환). */
  deps?: ReadonlyArray<unknown>;
  /** true면 리스너/측정을 건너뛴다 (예: 모바일 카드 모드). */
  disabled?: boolean;
}

/**
 * 가로 스크롤 컨테이너의 좌/우 페이드([data-scroll-fade="left"|"right"])
 * 표시를 React 상태 없이 DOM opacity 로 직접 갱신한다.
 *
 * 상태 기반(setState → 리렌더 → 클래스 스왑)으로 하면 스크롤 임계 통과
 * 순간 표 전체가 리렌더되는데, iOS WebKit 은 터치 팬 중 이 메인 스레드
 * 작업에 걸려 스와이프가 그라데이션 등장과 함께 멈칫하는 문제가 있었다.
 * 페이드는 상시 마운트(초기 opacity-0) 전제이며, 이 훅은 스크롤/리사이즈
 * 시점에 opacity 값만 만진다 — 리렌더 0, DOM 구조 불변.
 *
 * 페이드 탐색 범위는 컨테이너에서 가장 가까운 [role="grid"] (헤더/바디
 * 양쪽 페이드가 그 안에 있다). 매 갱신마다 querySelectorAll 로 다시 찾아
 * sticky 모드 전환으로 헤더 페이드가 늦게 마운트되는 경우도 자연 수용한다.
 */
export function useHorizontalScrollFades(
  containerRef: RefObject<HTMLElement | null>,
  { threshold = 10, deps = [], disabled = false }: Options = {},
): void {
  useEffect(() => {
    if (disabled) return;
    const el = containerRef.current;
    if (!el) return;
    const scope = el.closest('[role="grid"]') ?? el.parentElement;
    if (!scope) return;

    const apply = () => {
      const { scrollLeft, scrollWidth, clientWidth } = el;
      const canLeft = scrollLeft > threshold;
      const canRight = scrollLeft < scrollWidth - clientWidth - threshold;
      for (const fade of scope.querySelectorAll<HTMLElement>('[data-scroll-fade]')) {
        const show = fade.dataset['scrollFade'] === 'left' ? canLeft : canRight;
        fade.style.opacity = show ? '1' : '0';
      }
    };

    apply();
    el.addEventListener('scroll', apply, { passive: true });
    window.addEventListener('resize', apply);
    // 레이아웃 확정/콘텐츠 크기 변경 시 재측정 (관찰 시작 시 1회 발화 포함)
    const ro = new ResizeObserver(apply);
    ro.observe(el);
    if (el.firstElementChild) ro.observe(el.firstElementChild);

    return () => {
      el.removeEventListener('scroll', apply);
      window.removeEventListener('resize', apply);
      ro.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [containerRef, threshold, disabled, ...deps]);
}
