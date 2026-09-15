'use client';

import { type ReactNode, type RefObject, useLayoutEffect, useState } from 'react';
import { createPortal } from 'react-dom';

/**
 * 셀 아래에 띄우는 위반 안내 — body 로 포털해 화면 좌표(fixed)로 그린다.
 *
 * 셀 안에서 absolute 로 띄우면 표 본문의 가로 스크롤 컨테이너(overflow-x:auto 는 세로도
 * 자른다)가 마지막 행의 안내를 잘라내고, 잘린 만큼 가로·세로 스크롤바가 생긴다. z-index 로는
 * 못 푼다 — 컨테이너가 잘라내는 문제다. 포털은 어떤 컨테이너에도 속하지 않아 잘리지도,
 * 스크롤바를 만들지도 않는다.
 *
 * 위치는 앵커(입력칸)의 화면 사각형에서 매번 다시 잰다 — 창·표 컨테이너 스크롤과 리사이즈에
 * 따라 앵커가 움직이므로 캡처 단계 scroll 리스너로 전부 받는다. 안내는 blur 뒤에만 보이는
 * 짧은 상태라 리스너 비용은 그때만 든다.
 */
export function FloatingHint({
  anchorRef,
  children,
}: {
  anchorRef: RefObject<HTMLElement | null>;
  children: ReactNode;
}) {
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  useLayoutEffect(() => {
    const update = () => {
      const el = anchorRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      setPos({ top: r.bottom + 4, left: r.left });
    };
    update();
    window.addEventListener('resize', update);
    document.addEventListener('scroll', update, true);
    return () => {
      window.removeEventListener('resize', update);
      document.removeEventListener('scroll', update, true);
    };
  }, [anchorRef]);

  if (pos === null || typeof document === 'undefined') return null;
  return createPortal(
    <div
      data-floating-hint
      className="pointer-events-none fixed z-50 w-max space-y-0.5"
      style={{ top: pos.top, left: pos.left }}
    >
      {children}
    </div>,
    document.body,
  );
}
