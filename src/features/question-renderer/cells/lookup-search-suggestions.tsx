'use client';

import { type RefObject, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import type { LookupSearchHit } from '@/features/question-renderer/utils/lookup-search';
import { cn } from '@/lib/utils';

/**
 * 「목록에서 찾기」 후보 목록 — 입력칸 아래에 body 포털로 띄운다.
 *
 * 표 본문의 가로 스크롤 컨테이너가 셀 안 absolute 목록을 잘라내므로 위반 안내(FloatingHint)와
 * 같이 화면 좌표로 그린다. 위치는 입력칸의 화면 사각형에서 스크롤·리사이즈마다 다시 잰다.
 *
 * 누르기는 mousedown 에서 기본 동작을 막는다 — 입력칸이 먼저 blur 되어 목록이 닫히면 click 이
 * 도착할 곳이 없다.
 */
export function LookupSearchSuggestions({
  anchorRef,
  listboxId,
  hits,
  activeIndex,
  onPick,
  onHover,
}: {
  anchorRef: RefObject<HTMLElement | null>;
  listboxId: string;
  hits: readonly LookupSearchHit[];
  activeIndex: number;
  onPick: (position: number) => void;
  onHover: (position: number) => void;
}) {
  const [rect, setRect] = useState<{ top: number; left: number; width: number } | null>(null);

  useLayoutEffect(() => {
    const update = () => {
      const el = anchorRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      setRect({ top: r.bottom + 4, left: r.left, width: r.width });
    };
    update();
    window.addEventListener('resize', update);
    document.addEventListener('scroll', update, true);
    return () => {
      window.removeEventListener('resize', update);
      document.removeEventListener('scroll', update, true);
    };
  }, [anchorRef]);

  // 키보드로 옮긴 후보와 열 때 고른 회사가 목록 밖으로 밀려 있지 않게 한다. 목록 자체의 스크롤만
  // 옮긴다 — scrollIntoView 는 창까지 움직여 응답자가 페이지를 넘기는 중에 끌려간다.
  const listRef = useRef<HTMLUListElement | null>(null);
  const shown = rect !== null;
  useEffect(() => {
    const list = listRef.current;
    const item = list?.querySelector<HTMLElement>(`[data-position="${activeIndex}"]`);
    if (!list || !item) return;
    if (item.offsetTop < list.scrollTop) list.scrollTop = item.offsetTop;
    else if (item.offsetTop + item.offsetHeight > list.scrollTop + list.clientHeight) {
      list.scrollTop = item.offsetTop + item.offsetHeight - list.clientHeight;
    }
  }, [activeIndex, shown]);

  if (rect === null || typeof document === 'undefined') return null;
  return createPortal(
    <ul
      ref={listRef}
      id={listboxId}
      role="listbox"
      className="fixed z-50 max-h-72 overflow-y-auto rounded-md border border-gray-200 bg-white py-1 text-base shadow-lg"
      style={{ top: rect.top, left: rect.left, width: Math.max(rect.width, 200) }}
    >
      {hits.map((hit, position) => (
        <li
          key={hit.index}
          id={`${listboxId}-${position}`}
          data-position={position}
          role="option"
          aria-selected={position === activeIndex}
          className={cn(
            'cursor-pointer px-3 py-2 text-gray-900',
            position === activeIndex && 'bg-blue-50 text-blue-900',
          )}
          onMouseDown={(e) => e.preventDefault()}
          onMouseEnter={() => onHover(position)}
          onClick={() => onPick(position)}
        >
          {hit.label}
        </li>
      ))}
    </ul>,
    document.body,
  );
}
