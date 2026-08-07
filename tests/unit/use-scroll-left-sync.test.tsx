import { renderHook } from '@testing-library/react';
import { useRef, type RefObject } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { useScrollLeftSync } from '@/hooks/use-scroll-left-sync';

/**
 * useScrollLeftSync 회귀 테스트.
 *
 * 핵심 시나리오(M46): 한쪽 요소(헤더)가 hideColumnLabels 토글로 뒤늦게
 * 마운트될 때, ref 객체와 disabled는 바뀌지 않으므로 effect가 재실행되지
 * 않아 스크롤 동기화 리스너가 영영 붙지 않던 버그. deps 인자로 remount
 * 신호를 전달하면 effect가 재실행되어 리스너가 붙는지 검증한다.
 */
describe('useScrollLeftSync', () => {
  let a: HTMLDivElement;
  let b: HTMLDivElement;

  beforeEach(() => {
    a = document.createElement('div');
    b = document.createElement('div');
    document.body.append(a, b);
  });

  afterEach(() => {
    a.remove();
    b.remove();
  });

  function makeRef(el: HTMLElement | null): RefObject<HTMLElement | null> {
    return { current: el };
  }

  it('두 요소가 모두 존재하면 한쪽 스크롤이 다른 쪽으로 동기화된다', () => {
    renderHook(() => useScrollLeftSync(makeRef(a), makeRef(b)));

    a.scrollLeft = 120;
    a.dispatchEvent(new Event('scroll'));
    expect(b.scrollLeft).toBe(120);

    b.scrollLeft = 55;
    b.dispatchEvent(new Event('scroll'));
    expect(a.scrollLeft).toBe(55);
  });

  it('disabled=true면 리스너를 붙이지 않는다', () => {
    renderHook(() => useScrollLeftSync(makeRef(a), makeRef(b), true));

    a.scrollLeft = 90;
    a.dispatchEvent(new Event('scroll'));
    expect(b.scrollLeft).toBe(0);
  });

  it('한쪽이 뒤늦게 마운트되어도 deps 변경 시 리스너가 재부착된다', () => {
    // 초기엔 헤더(aRef.current)가 null — hideColumnLabels=true 상태 모사.
    // ref 객체 자체는 안정적이므로 동일 객체를 재사용한다(실사용과 동일).
    const aRef = makeRef(null);
    const bRef = makeRef(b);

    const { rerender } = renderHook(
      ({ hideColumnLabels }: { hideColumnLabels: boolean }) =>
        useScrollLeftSync(aRef, bRef, false, [hideColumnLabels]),
      { initialProps: { hideColumnLabels: true } },
    );

    // 헤더 미마운트 상태에서는 동기화 불가(early return).
    b.scrollLeft = 30;
    b.dispatchEvent(new Event('scroll'));
    // aRef.current가 null이므로 a로 전파될 대상이 없음 — 단순히 크래시 없이 통과.

    // hideColumnLabels 토글 off → 헤더 마운트. deps 변경이 effect 재실행을
    // 유발해야 리스너가 붙는다(버그 시에는 재실행되지 않아 동기화 실패).
    aRef.current = a;
    rerender({ hideColumnLabels: false });

    b.scrollLeft = 77;
    b.dispatchEvent(new Event('scroll'));
    expect(a.scrollLeft).toBe(77);

    a.scrollLeft = 200;
    a.dispatchEvent(new Event('scroll'));
    expect(b.scrollLeft).toBe(200);
  });

  it('대입으로 발생한 echo 이벤트는 stale 값을 원본에 되쓰지 않는다 (iOS 모멘텀 킬 회귀)', () => {
    renderHook(() => useScrollLeftSync(makeRef(a), makeRef(b)));

    // 사용자가 a(바디)를 스크롤 → b(헤더)로 전파
    a.scrollLeft = 100;
    a.dispatchEvent(new Event('scroll'));
    expect(b.scrollLeft).toBe(100);

    // 컴포지터가 a를 계속 진행시킴 (이벤트 지연 전달 상황 모사)
    a.scrollLeft = 120;

    // 그 사이 b의 echo 이벤트(값 100)가 늦게 도착 — 과거엔 a를 100으로 되감아
    // 모멘텀/smooth 애니메이션을 죽였다. 이제는 echo 로 판정해 무시해야 한다.
    b.dispatchEvent(new Event('scroll'));
    expect(a.scrollLeft).toBe(120);

    // 반대로 b를 실제로 사용자가 움직인 경우(마지막 기록값과 다름)는 전파된다
    b.scrollLeft = 300;
    b.dispatchEvent(new Event('scroll'));
    expect(a.scrollLeft).toBe(300);
  });

  it('deps 인자를 생략해도(기존 호출부) 기본 동작은 유지된다', () => {
    renderHook(() => {
      const aRef = useRef<HTMLElement | null>(a);
      const bRef = useRef<HTMLElement | null>(b);
      useScrollLeftSync(aRef, bRef);
    });

    a.scrollLeft = 15;
    a.dispatchEvent(new Event('scroll'));
    expect(b.scrollLeft).toBe(15);
  });
});
