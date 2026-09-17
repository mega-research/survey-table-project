'use client';

import { useEffect, useRef } from 'react';

import { cn } from '@/lib/utils';

interface Props {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
}

/**
 * 옵션 라벨 편집용 auto-resize textarea — Enter = 줄바꿈.
 * 옵션 라벨 줄바꿈은 표시 전용이며 export 라벨은 공백으로 정규화된다. (CONTEXT.md "옵션 라벨 줄바꿈")
 */
export function OptionLabelTextarea({ value, onChange, placeholder, className }: Props) {
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);

  return (
    <textarea
      ref={ref}
      rows={1}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className={cn(
        'w-full resize-none overflow-hidden rounded-lg border border-gray-200 bg-white px-4 py-3 text-base leading-6 transition-colors placeholder:text-gray-500 focus-visible:border-blue-500 focus-visible:ring-1 focus-visible:ring-blue-500 focus-visible:outline-none',
        className,
      )}
    />
  );
}
