'use client';

import type { ReactNode } from 'react';

interface ToolBtnProps {
  children: ReactNode;
  onClick?: () => void;
  active?: boolean;
  disabled?: boolean;
  title?: string;
  className?: string;
}

const BASE =
  'inline-flex h-9 items-center justify-center gap-1 rounded-md px-2 py-1 text-sm font-medium transition-colors disabled:pointer-events-none disabled:opacity-50';
const INACTIVE = 'text-gray-700 hover:bg-gray-100';
const ACTIVE = 'bg-gray-100 text-gray-900 ring-1 ring-inset ring-gray-300';

export function ToolBtn({
  children,
  onClick,
  active,
  disabled,
  title,
  className,
}: ToolBtnProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`${BASE} ${active ? ACTIVE : INACTIVE} ${className ?? ''}`}
    >
      {children}
    </button>
  );
}

export function Sep() {
  return <div className="h-6 w-px bg-gray-300" />;
}
