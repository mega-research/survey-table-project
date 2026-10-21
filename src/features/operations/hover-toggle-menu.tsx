'use client';

import { type ReactNode, useEffect, useRef, useState } from 'react';

import { DropdownMenuItem } from '@/components/ui/dropdown-menu';

/**
 * 운영 헤더의 호버 메뉴 — 테스트 모드와 설문 중단·종료가 같은 모양으로 연다.
 *
 * 버튼은 아무것도 바꾸지 않고 메뉴만 연다(호버·클릭). 대각선 이동 중 닫힘을 막기 위해
 * mouseleave 후 200ms 지연 뒤 닫고, 트리거/콘텐츠 어느 쪽이든 재진입하면 취소한다.
 * 호버로 이미 열린 메뉴를 클릭이 다시 닫지 않게 트리거의 pointerdown 을 막고, 버튼 위 클릭은
 * 메뉴 바깥 클릭으로 치지 않는다. DropdownMenu 는 `modal={false}` 로 써야 한다 — 호버로 연
 * 메뉴가 배경을 잠그면 mouseleave 닫힘이 어색하다.
 */
export function useHoverMenu() {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const closeTimer = useRef<number | null>(null);

  const openMenu = () => {
    if (closeTimer.current !== null) {
      window.clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
    setOpen(true);
  };

  const scheduleClose = () => {
    if (closeTimer.current !== null) window.clearTimeout(closeTimer.current);
    closeTimer.current = window.setTimeout(() => setOpen(false), 200);
  };

  useEffect(
    () => () => {
      if (closeTimer.current !== null) window.clearTimeout(closeTimer.current);
    },
    [],
  );

  return {
    open,
    setOpen,
    triggerProps: {
      ref: triggerRef,
      onMouseEnter: openMenu,
      onMouseLeave: scheduleClose,
      onPointerDown: (e: React.PointerEvent) => {
        if (open) e.preventDefault();
      },
    },
    contentProps: {
      onMouseEnter: openMenu,
      onMouseLeave: scheduleClose,
      onPointerDownOutside: (e: { target: EventTarget | null; preventDefault: () => void }) => {
        if (triggerRef.current?.contains(e.target as Node)) e.preventDefault();
      },
    },
  };
}

/**
 * 메뉴 안의 켜고 끄는 항목 — 고른 뒤에도 메뉴를 닫지 않는다(스위치가 바뀌는 걸 보게).
 * 스위치는 모양만이고 상태는 menuitemcheckbox 의 aria-checked 로 알린다.
 * 확인 창을 띄우는 항목은 `onToggle` 안에서 메뉴를 직접 닫는다.
 */
export function ToggleMenuItem({
  icon,
  label,
  hint,
  checked,
  disabled,
  onToggle,
  tone = 'blue',
}: {
  icon: ReactNode;
  label: string;
  hint: string;
  checked: boolean;
  disabled: boolean;
  onToggle: () => void;
  /** 켜짐 색 — 중단은 rose, 종료는 slate 로 버튼 색과 맞춘다. */
  tone?: 'blue' | 'rose' | 'slate';
}) {
  const onColor =
    tone === 'rose' ? 'bg-rose-500' : tone === 'slate' ? 'bg-slate-600' : 'bg-blue-500';
  return (
    <DropdownMenuItem
      role="menuitemcheckbox"
      aria-checked={checked}
      disabled={disabled}
      onSelect={(e) => {
        e.preventDefault();
        onToggle();
      }}
      className="items-start gap-2"
    >
      <span className="mt-0.5">{icon}</span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span>{label}</span>
        <span className="text-xs text-slate-500">{hint}</span>
      </span>
      <span
        aria-hidden="true"
        className={`mt-0.5 flex h-5 w-9 shrink-0 items-center rounded-full p-0.5 transition-colors ${
          checked ? `justify-end ${onColor}` : 'justify-start bg-slate-300'
        }`}
      >
        <span className="h-4 w-4 rounded-full bg-white" />
      </span>
    </DropdownMenuItem>
  );
}
