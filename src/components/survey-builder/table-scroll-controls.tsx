'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';

import { ChevronLeft, ChevronRight } from 'lucide-react';

// 헤더 가로 스크롤 컨테이너: 스크롤바 숨김 + 프린트 시 overflow 해제
export const HEADER_SCROLL_CLASS =
  'overflow-x-auto overflow-y-hidden px-4 md:px-0 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden print:overflow-visible';

// ── 가로 스크롤 컨트롤 (버튼 + 진행도 막대) ──
//
// sticky 헤더 셀 위에 별도 행으로 배치되어 페이지 어디서든 조작 가능.
// 진행도 막대는 현재 가시 범위 시각화, 버튼은 클릭 시 일정 step 스크롤.
// 리렌더 최소화를 위해 scrollLeft 변화는 상태 대신 DOM을 직접 수정한다.

const SCROLL_BUTTON_STEP = 400;

const SCROLL_STEP_BUTTON_CLASS =
  'flex h-5 w-5 shrink-0 items-center justify-center rounded border border-gray-300 bg-white text-gray-600 shadow-sm transition-all hover:border-gray-400 hover:bg-gray-50 hover:text-gray-900 active:scale-95 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-gray-300 disabled:hover:bg-white';

function ScrollStepButton({
  direction,
  disabled,
  onClick,
}: {
  direction: 'left' | 'right';
  disabled: boolean;
  onClick: () => void;
}) {
  const Icon = direction === 'left' ? ChevronLeft : ChevronRight;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={SCROLL_STEP_BUTTON_CLASS}
      aria-label={direction === 'left' ? '왼쪽으로 스크롤' : '오른쪽으로 스크롤'}
    >
      <Icon className="h-3 w-3" />
    </button>
  );
}

export function TableScrollControls({
  scrollRef,
  canScrollLeft,
  canScrollRight,
}: {
  scrollRef: React.RefObject<HTMLElement | null>;
  canScrollLeft: boolean;
  canScrollRight: boolean;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const thumbRef = useRef<HTMLDivElement>(null);
  const [needsScroll, setNeedsScroll] = useState(false);

  // 현재 가시 범위를 썸 위치·크기로 시각화 (DOM 직접 조작으로 리렌더 0)
  // 의존성에 needsScroll 포함 → false→true 전환 시점에 재실행되어
  // 갓 마운트된 썸에 초기 style을 즉시 반영한다.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    const update = () => {
      const { scrollLeft, scrollWidth, clientWidth } = el;
      const active = scrollWidth - clientWidth > 1;
      setNeedsScroll((prev) => (prev === active ? prev : active));
      if (!active) return;
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
  }, [scrollRef, needsScroll]);

  const scrollByStep = useCallback(
    (delta: number) => {
      const el = scrollRef.current;
      if (!el) return;
      el.scrollTo({ left: el.scrollLeft + delta, behavior: 'smooth' });
    },
    [scrollRef],
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
        behavior: 'smooth',
      });
    },
    [scrollRef],
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
      <ScrollStepButton
        direction="left"
        disabled={!canScrollLeft}
        onClick={() => scrollByStep(-SCROLL_BUTTON_STEP)}
      />
      <div
        ref={trackRef}
        role="scrollbar"
        aria-orientation="horizontal"
        aria-label="가로 스크롤"
        onClick={handleTrackClick}
        className="relative h-1.5 flex-1 cursor-pointer rounded-full bg-gray-200"
      >
        <div
          ref={thumbRef}
          onMouseDown={handleThumbMouseDown}
          className="absolute inset-y-0 cursor-grab rounded-full bg-gray-400 transition-colors hover:bg-gray-500 active:cursor-grabbing active:bg-gray-600"
        />
      </div>
      <ScrollStepButton
        direction="right"
        disabled={!canScrollRight}
        onClick={() => scrollByStep(SCROLL_BUTTON_STEP)}
      />
    </div>
  );
}
