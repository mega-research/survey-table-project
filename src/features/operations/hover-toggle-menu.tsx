'use client';

import { type ReactNode, useState } from 'react';

import { DropdownMenuItem } from '@/components/ui/dropdown-menu';

/**
 * 운영 헤더의 호버 메뉴 — 테스트 모드와 설문 중단·종료가 같은 모양으로 연다.
 *
 * 버튼은 아무것도 바꾸지 않고 메뉴만 연다(호버·클릭). `triggerProps` 는 DropdownMenuTrigger 에
 * 펼친다 — Base UI 의 호버 열기(openOnHover)가 대각선 이동 중 닫힘을 막는 지연(closeDelay)과,
 * 호버로 연 메뉴를 클릭이 다시 닫지 않게 하는 처리를 맡는다. DropdownMenu 는 `modal={false}` 로
 * 써야 한다 — 호버로 연 메뉴가 배경을 잠그면 마우스가 떠날 때의 닫힘이 어색하다.
 */
export function useHoverMenu() {
  const [open, setOpen] = useState(false);
  return {
    open,
    setOpen,
    triggerProps: { openOnHover: true, delay: 0, closeDelay: 200 },
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
      closeOnClick={false}
      onClick={onToggle}
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
