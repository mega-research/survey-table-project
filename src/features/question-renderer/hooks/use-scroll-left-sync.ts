import { type RefObject, useEffect } from 'react';

/**
 * 두 요소의 `scrollLeft`를 상호 동기화한다.
 *
 * 한쪽 스크롤 → 다른 쪽 값이 다를 때만 대입. 대입으로 발생한 반대편 scroll
 * 이벤트(echo)는 "마지막으로 우리가 쓴 값"과 비교해 소비하고 전파하지 않는다.
 *
 * echo 차단이 필수인 이유: 데스크톱은 이벤트가 프레임과 동기라 값-동일 비교만으로
 * 루프가 끊기지만, iOS/Android 는 스크롤이 컴포지터 스레드에서 진행되고 scroll
 * 이벤트가 메인 스레드에 지연 전달된다. 그 사이 원본이 더 이동해 있으면 echo
 * 핸들러가 "이미 낡은 값"을 원본에 되써서 진행 중인 모멘텀/smooth 애니메이션을
 * 즉시 중단시킨다 (아이폰에서 스크롤 버튼이 2px 만 움직이던 버그).
 * ±1px 허용: 대입 후 브라우저 픽셀 스냅으로 읽기 값이 미세하게 달라질 수 있다.
 *
 * @param disabled true면 리스너를 붙이지 않는다 (예: 모바일 카드 모드,
 *   단일 컨테이너 모드)
 * @param deps 한쪽 요소가 조건부로 뒤늦게 마운트되는 경우(예: hideColumnLabels
 *   토글로 헤더가 나중에 렌더) 재부착을 트리거하기 위한 의존값. ref 객체와
 *   disabled가 동일해도 이 값이 바뀌면 effect가 다시 실행되어 리스너를 붙인다.
 *   원시값만 넘길 것 — 문자열 키로 접어 비교하므로 객체는 변경을 감지하지 못한다.
 */
export function useScrollLeftSync(
  aRef: RefObject<HTMLElement | null>,
  bRef: RefObject<HTMLElement | null>,
  disabled = false,
  deps: ReadonlyArray<unknown> = [],
): void {
  // 원시값 배열을 문자열 키로 접는다 — 요소별 Object.is 비교와 같은 시점에 바뀌므로
  // 재부착 횟수는 spread 시절과 동일하다.
  const depsKey = deps.join('|');
  useEffect(() => {
    if (disabled) return;
    const a = aRef.current;
    const b = bRef.current;
    if (!a || !b) return;

    let lastWrittenA = Number.NaN;
    let lastWrittenB = Number.NaN;

    const onA = () => {
      const x = a.scrollLeft;
      if (Math.abs(x - lastWrittenA) <= 1) return; // 우리가 쓴 echo — 전파 금지
      if (b.scrollLeft !== x) {
        lastWrittenB = x;
        b.scrollLeft = x;
      }
    };
    const onB = () => {
      const x = b.scrollLeft;
      if (Math.abs(x - lastWrittenB) <= 1) return;
      if (a.scrollLeft !== x) {
        lastWrittenA = x;
        a.scrollLeft = x;
      }
    };
    a.addEventListener('scroll', onA, { passive: true });
    b.addEventListener('scroll', onB, { passive: true });
    return () => {
      a.removeEventListener('scroll', onA);
      b.removeEventListener('scroll', onB);
    };
  }, [aRef, bRef, disabled, depsKey]);
}
