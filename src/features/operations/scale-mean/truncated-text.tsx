'use client';

import { useRef, useState } from 'react';

import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

interface Props {
  text: string;
}

/**
 * 한 줄 말줄임 글자 — 실제로 잘렸을 때만 마우스를 올리면 전체 글자를 팝오버로 보인다.
 * 잘렸는지는 열 때마다 잰다(창 폭이 바뀌면 달라진다).
 */
export function TruncatedText({ text }: Props) {
  const ref = useRef<HTMLSpanElement>(null);
  const [open, setOpen] = useState(false);

  const handleOpenChange = (next: boolean) => {
    const el = ref.current;
    setOpen(next && el !== null && el.scrollWidth > el.clientWidth);
  };

  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip open={open} onOpenChange={handleOpenChange}>
        <TooltipTrigger asChild>
          <span ref={ref} className="block truncate">
            {text}
          </span>
        </TooltipTrigger>
        <TooltipContent
          side="bottom"
          align="start"
          className="max-w-[600px] bg-white text-[13px] leading-5 break-keep whitespace-normal text-gray-900"
        >
          {text}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
