import { useEffect, type RefObject } from 'react';

/**
 * 두 요소의 `scrollLeft`를 상호 동기화한다.
 *
 * 한쪽 스크롤 → 다른 쪽 값이 다를 때만 대입. 대입으로 인해 반대편 scroll
 * 이벤트가 발생해도 값이 이미 같아 skip되므로 루프가 자연스레 끊긴다.
 * RAF 지연 없이 모든 프레임을 즉시 반영하기 때문에 smooth 스크롤 애니메이션
 * 중에도 두 컨테이너가 어긋나 보이지 않는다.
 *
 * @param disabled true면 리스너를 붙이지 않는다 (예: 모바일)
 * @param deps 한쪽 요소가 조건부로 뒤늦게 마운트되는 경우(예: hideColumnLabels
 *   토글로 헤더가 나중에 렌더) 재부착을 트리거하기 위한 의존값. ref 객체와
 *   disabled가 동일해도 이 값이 바뀌면 effect가 다시 실행되어 리스너를 붙인다.
 */
export function useScrollLeftSync(
  aRef: RefObject<HTMLElement | null>,
  bRef: RefObject<HTMLElement | null>,
  disabled = false,
  deps: ReadonlyArray<unknown> = [],
): void {
  useEffect(() => {
    if (disabled) return;
    const a = aRef.current;
    const b = bRef.current;
    if (!a || !b) return;

    const onA = () => {
      if (b.scrollLeft !== a.scrollLeft) b.scrollLeft = a.scrollLeft;
    };
    const onB = () => {
      if (a.scrollLeft !== b.scrollLeft) a.scrollLeft = b.scrollLeft;
    };
    a.addEventListener('scroll', onA, { passive: true });
    b.addEventListener('scroll', onB, { passive: true });
    return () => {
      a.removeEventListener('scroll', onA);
      b.removeEventListener('scroll', onB);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aRef, bRef, disabled, ...deps]);
}
