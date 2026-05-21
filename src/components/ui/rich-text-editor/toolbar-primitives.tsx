'use client';

import { forwardRef, type ButtonHTMLAttributes } from 'react';

interface ToolBtnProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'type'> {
  active?: boolean;
}

const BASE =
  'inline-flex h-9 items-center justify-center gap-1 rounded-md px-2 py-1 text-sm font-medium transition-colors disabled:pointer-events-none disabled:opacity-50';
const INACTIVE = 'text-gray-700 hover:bg-gray-100';
const ACTIVE = 'bg-gray-100 text-gray-900 ring-1 ring-inset ring-gray-300';

// forwardRef + button props spread — Radix PopoverTrigger asChild 등 데이터/aria/onClick 주입에 대응.
export const ToolBtn = forwardRef<HTMLButtonElement, ToolBtnProps>(function ToolBtn(
  { children, active, className, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type="button"
      {...rest}
      className={`${BASE} ${active ? ACTIVE : INACTIVE} ${className ?? ''}`}
    >
      {children}
    </button>
  );
});

export function Sep() {
  return <div className="h-6 w-px bg-gray-300" />;
}
