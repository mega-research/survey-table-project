'use client';

import React, { useCallback, useEffect, useId, useRef, useState } from 'react';

import { ChevronLeft, ChevronRight } from 'lucide-react';

// 헤더 가로 스크롤 컨테이너: 스크롤바 숨김 + 프린트 시 overflow 해제
export const HEADER_SCROLL_CLASS =
  'overflow-x-auto overflow-y-hidden px-4 md:px-0 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden print:overflow-visible';

// ── 가로 스크롤 컨트롤 (버튼 + 진행도 막대) ──
//
// sticky 헤더 셀 위에 별도 행으로 배치되어 페이지 어디서든 조작 가능.
// 진행도 막대는 현재 가시 범위 시각화, 버튼은 클릭 시 "다음 두 열 중앙 정렬" 페이징.
// 리렌더 최소화를 위해 scrollLeft 변화는 상태 대신 DOM을 직접 수정한다.

/**
 * "다음 두 열 중앙 정렬" 페이징의 목표 scrollLeft 계산.
 *
 * ▶: 우측에서 잘려 보이던(또는 경계 뒤에 숨은) 열 + 그다음 열, 두 열을 뷰
 *    가운데에 놓는다. 예: [전혀|별로|보..] → 누르면 [..로|보통|약간|매..] —
 *    새 두 열이 온전히 중앙에 오고 양옆에 이전/다음 열이 대칭으로 살짝 걸려
 *    "양쪽에 더 있다"는 힌트가 된다.
 * ◀: 대칭 — 좌측에서 잘려 있던 열 + 그 이전 열을 뷰 가운데에 놓는다.
 * 두 열 합이 뷰포트보다 넓으면 중앙 정렬 대신 첫 열 좌측(◀는 우측) 경계 정렬,
 * 그마저 제자리면 한 뷰포트 폭 이동 폴백. 결과는 [0, 최대 스크롤]로 클램프.
 *
 * @param columnStops 각 열 좌측 경계 누적 px (0 시작, 마지막 = 전체 너비)
 * @param viewportWidth 스크롤 컨테이너 가시 폭 (clientWidth)
 */
export function computeColumnPageTarget(
  scrollLeft: number,
  direction: -1 | 1,
  columnStops: readonly number[],
  viewportWidth: number,
): number {
  const total = columnStops[columnStops.length - 1] ?? 0;
  const maxScroll = Math.max(0, total - viewportWidth);
  const clamp = (v: number) => Math.min(Math.max(0, v), maxScroll);

  let pairStart: number;
  let pairEnd: number;
  if (direction === 1) {
    const viewEnd = scrollLeft + viewportWidth;
    // 우측 잘린 열의 시작 경계 index (정확히 경계면 그 경계 자체) — ±1px 스냅 오차 허용
    let j = 0;
    for (let i = 0; i < columnStops.length - 1; i++) {
      if ((columnStops[i] ?? 0) <= viewEnd + 1) j = i;
      else break;
    }
    pairStart = columnStops[j] ?? 0;
    pairEnd = columnStops[Math.min(j + 2, columnStops.length - 1)] ?? total;
  } else {
    // 좌측 잘린 열(정렬 상태면 뷰 시작에서 끝나는 열)의 시작 경계 index
    let k = 0;
    for (let i = 0; i < columnStops.length - 1; i++) {
      if ((columnStops[i] ?? 0) <= scrollLeft - 1) k = i;
      else break;
    }
    pairStart = columnStops[Math.max(k - 1, 0)] ?? 0;
    pairEnd = columnStops[k + 1] ?? total;
  }

  const pairWidth = pairEnd - pairStart;
  let target: number;
  if (pairWidth >= viewportWidth) {
    // 두 열이 뷰포트보다 넓으면 중앙 정렬 불가 → 진행 방향 쪽 경계 정렬
    target = direction === 1 ? pairStart : pairEnd - viewportWidth;
  } else {
    target = pairStart - (viewportWidth - pairWidth) / 2;
  }

  // 정렬 목표가 제자리걸음이면(열 폭 극단 케이스) 한 뷰포트 폭 이동 폴백
  target = clamp(target);
  if (direction === 1 && target <= scrollLeft + 1) target = clamp(scrollLeft + viewportWidth);
  if (direction === -1 && target >= scrollLeft - 1) target = clamp(scrollLeft - viewportWidth);
  return target;
}

const SCROLL_STEP_BUTTON_CLASS =
  'flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-gray-300 bg-white text-gray-600 shadow-sm transition-all hover:border-gray-400 hover:bg-gray-50 hover:text-gray-900 active:scale-95 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-gray-300 disabled:hover:bg-white';

function getScrollBehavior(): ScrollBehavior {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';
}

function ScrollStepButton({
  direction,
  onClick,
  ref,
}: {
  direction: 'left' | 'right';
  onClick: () => void;
  ref: React.Ref<HTMLButtonElement>;
}) {
  const Icon = direction === 'left' ? ChevronLeft : ChevronRight;
  // disabled 는 JSX 로 선언하지 않고 update()가 DOM 으로 직접 관리한다 —
  // 스크롤 임계 통과 순간의 상태 플립 리렌더가 iOS 터치 팬을 멈칫하게 하기 때문.
  return (
    <button
      ref={ref}
      type="button"
      onClick={onClick}
      className={SCROLL_STEP_BUTTON_CLASS}
      aria-label={direction === 'left' ? '왼쪽으로 스크롤' : '오른쪽으로 스크롤'}
    >
      <Icon className="h-4 w-4" />
    </button>
  );
}

/** 버튼 활성/페이드와 동일한 양끝 임계값(px) */
const SCROLL_EDGE_THRESHOLD = 10;

export function TableScrollControls({
  scrollRef,
  columnStops,
}: {
  scrollRef: React.RefObject<HTMLElement | null>;
  /** 열 좌측 경계 누적 px (0 시작, 마지막 = 전체 너비). 제공 시 버튼/방향키가
   *  "잘린 열 정렬" 페이징으로 동작하고, 미제공이면 뷰포트 폭 페이징 폴백. */
  columnStops?: readonly number[] | undefined;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const thumbRef = useRef<HTMLDivElement>(null);
  const leftBtnRef = useRef<HTMLButtonElement>(null);
  const rightBtnRef = useRef<HTMLButtonElement>(null);
  const [needsScroll, setNeedsScroll] = useState(false);
  // aria-controls 대상: 스크롤 컨테이너에 id가 없으면 부여
  const scrollAreaId = useId();

  // 현재 가시 범위를 썸 위치·크기로 시각화 (DOM 직접 조작으로 리렌더 0)
  // 의존성에 needsScroll 포함 → false→true 전환 시점에 재실행되어
  // 갓 마운트된 썸에 초기 style을 즉시 반영한다.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (!el.id) el.id = scrollAreaId;

    const update = () => {
      const { scrollLeft, scrollWidth, clientWidth } = el;
      const active = scrollWidth - clientWidth > 1;
      setNeedsScroll((prev) => (prev === active ? prev : active));
      if (!active) return;
      // 버튼 활성화도 리렌더 없이 DOM 직접 갱신 — 임계 통과 순간의 disabled
      // 플립이 React 리렌더를 유발하면 iOS 터치 팬이 멈칫한다 (페이드와 동일 사유)
      if (leftBtnRef.current) {
        leftBtnRef.current.disabled = scrollLeft <= SCROLL_EDGE_THRESHOLD;
      }
      if (rightBtnRef.current) {
        rightBtnRef.current.disabled =
          scrollLeft >= scrollWidth - clientWidth - SCROLL_EDGE_THRESHOLD;
      }
      // aria-valuenow도 썸과 같이 DOM 직접 갱신 (스크롤마다 리렌더 방지)
      trackRef.current?.setAttribute(
        'aria-valuenow',
        String(Math.round((scrollLeft / (scrollWidth - clientWidth)) * 100)),
      );
      const thumb = thumbRef.current;
      if (!thumb) return;
      thumb.style.width = `${(clientWidth / scrollWidth) * 100}%`;
      thumb.style.left = `${(scrollLeft / scrollWidth) * 100}%`;
    };

    update();
    el.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);

    // 첫 페인트 시점엔 scrollWidth/clientWidth가 아직 확정되지 않아 update() 1회로는
    // needsScroll을 false로 잘못 굳힐 수 있다 → 컨트롤이 클릭(scroll 이벤트) 전까지
    // 렌더되지 않는다. ResizeObserver는 관찰 시작 시 1회 + 레이아웃 변동마다 발화하므로
    // 확정 시점에 자동 재측정한다. (use-horizontal-scroll-indicators 훅과 동일 패턴)
    const ro = new ResizeObserver(update);
    ro.observe(el);
    if (el.firstElementChild) ro.observe(el.firstElementChild);

    return () => {
      el.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
      ro.disconnect();
    };
  }, [scrollRef, needsScroll, scrollAreaId]);

  const scrollByStep = useCallback(
    (direction: -1 | 1) => {
      const el = scrollRef.current;
      if (!el) return;
      const left =
        columnStops && columnStops.length > 1
          ? computeColumnPageTarget(el.scrollLeft, direction, columnStops, el.clientWidth)
          : el.scrollLeft + direction * el.clientWidth;
      el.scrollTo({ left, behavior: getScrollBehavior() });
    },
    [scrollRef, columnStops],
  );

  // 트랙 클릭 → 클릭 지점이 썸 중앙이 되도록 스무스 점프
  const handleTrackClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (e.target !== e.currentTarget) return; // 썸 드래그 이벤트 분리
      const el = scrollRef.current;
      const track = trackRef.current;
      if (!el || !track) return;
      const rect = track.getBoundingClientRect();
      const ratio = (e.clientX - rect.left) / rect.width;
      el.scrollTo({
        left: ratio * el.scrollWidth - el.clientWidth / 2,
        behavior: getScrollBehavior(),
      });
    },
    [scrollRef],
  );

  const handleTrackKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      const el = scrollRef.current;
      if (!el) return;
      let left: number | undefined;
      const step = (direction: -1 | 1) =>
        columnStops && columnStops.length > 1
          ? computeColumnPageTarget(el.scrollLeft, direction, columnStops, el.clientWidth)
          : el.scrollLeft + direction * el.clientWidth;
      if (event.key === 'ArrowLeft') left = step(-1);
      if (event.key === 'ArrowRight') left = step(1);
      if (event.key === 'Home') left = 0;
      if (event.key === 'End') left = Math.max(0, el.scrollWidth - el.clientWidth);
      if (left === undefined) return;
      event.preventDefault();
      el.scrollTo({ left, behavior: getScrollBehavior() });
    },
    [scrollRef, columnStops],
  );

  // 썸 드래그 → 트랙 대비 이동 비율로 scrollLeft 직접 갱신 (RAF throttle)
  const handleThumbMouseDown = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      e.preventDefault();
      e.stopPropagation();
      const el = scrollRef.current;
      const track = trackRef.current;
      if (!el || !track) return;

      const startX = e.clientX;
      const startScrollLeft = el.scrollLeft;
      const ratio = el.scrollWidth / track.getBoundingClientRect().width;
      const prevUserSelect = document.body.style.userSelect;
      document.body.style.userSelect = 'none';

      let pendingX = startX;
      let rafId = 0;
      const apply = () => {
        rafId = 0;
        el.scrollLeft = startScrollLeft + (pendingX - startX) * ratio;
      };

      const onMove = (ev: MouseEvent) => {
        pendingX = ev.clientX;
        if (!rafId) rafId = requestAnimationFrame(apply);
      };
      const onUp = () => {
        if (rafId) cancelAnimationFrame(rafId);
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        document.body.style.userSelect = prevUserSelect;
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    },
    [scrollRef],
  );

  if (!needsScroll) return null;

  return (
    <div className="flex items-center gap-2 bg-white px-2 py-1 print:hidden">
      <ScrollStepButton ref={leftBtnRef} direction="left" onClick={() => scrollByStep(-1)} />
      <div
        ref={trackRef}
        role="scrollbar"
        aria-orientation="horizontal"
        aria-label="가로 스크롤"
        aria-controls={scrollAreaId}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={0}
        tabIndex={0}
        onClick={handleTrackClick}
        onKeyDown={handleTrackKeyDown}
        className="relative h-1.5 flex-1 cursor-pointer rounded-full bg-gray-200 focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 focus-visible:outline-none"
      >
        <div
          ref={thumbRef}
          onMouseDown={handleThumbMouseDown}
          className="absolute inset-y-0 cursor-grab rounded-full bg-gray-400 transition-colors hover:bg-gray-500 active:cursor-grabbing active:bg-gray-600"
        />
      </div>
      <ScrollStepButton ref={rightBtnRef} direction="right" onClick={() => scrollByStep(1)} />
    </div>
  );
}
