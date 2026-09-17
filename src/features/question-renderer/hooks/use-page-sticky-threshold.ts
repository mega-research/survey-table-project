import { type RefObject, useEffect, useState } from 'react';

// 히스테리시스 밴드: 진입/해제 기준을 벌려 모바일 주소창 등으로 인한
// innerHeight 출렁임, 단일 컨테이너 모드의 헤더 포함 높이 오차(수십 px)로
// 구조가 플립-플랍하는 것을 막는다.
const STICKY_ENTER_RATIO = 0.7;
const STICKY_EXIT_RATIO = 0.5;

/** 소프트 키보드가 떠 있을 가능성이 높은 상태 — 편집 요소 포커스 중.
 *  키보드로 innerHeight 가 일시 축소된 순간(안드로이드) 측정하면 짧은 표가
 *  입력 도중 sticky 로 플립되므로 측정을 보류한다 (blur 시 focusout 재측정). */
function isEditingElementFocused(): boolean {
  const ae = document.activeElement as HTMLElement | null;
  return (
    !!ae &&
    (ae.tagName === 'INPUT' ||
      ae.tagName === 'TEXTAREA' ||
      ae.tagName === 'SELECT' ||
      ae.isContentEditable)
  );
}

/**
 * 표 페이지 sticky 헤더(이중 스크롤 컨테이너) 구조를 쓸지 결정한다.
 *
 * sticky 헤더의 가치는 "행을 보는 동안 헤더가 화면 밖에 있는 스크롤 구간"의
 * 길이, 즉 표 높이에 비례한다. 짧은 표는 고정 이득이 없는데도 스크롤 중
 * 헤더 블록이 뷰포트 상단에 잠깐 얼어붙었다 튕겨 나가는 턱 걸림만 생기므로,
 * 관찰 대상 높이가 뷰포트의 70%를 넘을 때만 true(진입), 50% 미만이면
 * false(해제)로 전환한다.
 *
 * 재측정 트리거: ResizeObserver(표 높이 변화) + window resize(뷰포트 높이
 * 변화 — 창 리사이즈·화면 회전) + focusout(키보드 닫힘 후 보류분 반영).
 *
 * @param targetRef 높이를 관찰할 요소 (표 가로 스크롤 컨테이너 — 모드 전환과
 *   무관하게 마운트가 유지되는 요소여야 ResizeObserver 가 끊기지 않는다)
 * @param disabled true 면 측정 없이 항상 false (예: 모바일 카드 모드)
 * @param forced true 면 측정 없이 항상 true (예: 가상화 표 — 본문 전체가
 *   렌더되지 않아 실측이 무의미하고, 행 수 기준으로 이미 충분히 길다)
 * @param deps 대상 요소가 조건부로 뒤늦게 마운트되는 경우(예: 빈 표 → 행
 *   채워짐) effect 재실행으로 관찰을 재개하기 위한 의존값. ref/disabled/forced
 *   가 동일해도 이 값이 바뀌면 리스너를 다시 붙인다. 원시값만 넘길 것.
 */
export function usePageStickyThreshold(
  targetRef: RefObject<HTMLElement | null>,
  { disabled = false, forced = false }: { disabled?: boolean; forced?: boolean } = {},
  deps: ReadonlyArray<unknown> = [],
): boolean {
  const [sticky, setSticky] = useState(false);
  // 원시값 배열을 문자열 키로 접는다 — 재부착 시점은 spread deps 시절과 동일하다.
  const depsKey = deps.join('|');

  useEffect(() => {
    if (disabled || forced) return;
    const el = targetRef.current;
    if (!el) return;

    const measure = () => {
      if (isEditingElementFocused()) return;
      const viewport = window.innerHeight;
      if (!viewport) return;
      const ratio = el.offsetHeight / viewport;
      setSticky((prev) => (prev ? ratio > STICKY_EXIT_RATIO : ratio > STICKY_ENTER_RATIO));
    };

    measure();
    // 동적 행 확장/이미지 로드 등으로 표 높이가 나중에 변하는 케이스 추적.
    // 관찰 시작 시 1회 발화하므로 첫 레이아웃 확정 시점 재측정도 겸한다.
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    window.addEventListener('resize', measure);
    window.addEventListener('focusout', measure);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', measure);
      window.removeEventListener('focusout', measure);
    };
  }, [targetRef, disabled, forced, depsKey]);

  if (disabled) return false;
  return forced ? true : sticky;
}
