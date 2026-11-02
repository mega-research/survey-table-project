'use client';

import * as React from 'react';

import { Tooltip as TooltipPrimitive } from '@base-ui/react/tooltip';

import { cn } from '@/lib/utils';

const TooltipProvider = TooltipPrimitive.Provider;

const Tooltip = TooltipPrimitive.Root;

const TooltipTrigger = TooltipPrimitive.Trigger;

type PositionerProps = React.ComponentProps<typeof TooltipPrimitive.Positioner>;

type TooltipContentProps = Omit<React.ComponentProps<typeof TooltipPrimitive.Popup>, 'className'> &
  Pick<PositionerProps, 'side' | 'align' | 'sideOffset' | 'alignOffset'> & {
    className?: string | undefined;
  };

// Portal·Positioner 를 감싸 Radix 시절처럼 Content 하나로 쓴다. 위치 prop 은 Positioner 로 간다.
function TooltipContent({
  className,
  side,
  align,
  sideOffset = 4,
  alignOffset,
  ...props
}: TooltipContentProps) {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Positioner
        className="z-50"
        side={side}
        align={align}
        sideOffset={sideOffset}
        alignOffset={alignOffset}
      >
        <TooltipPrimitive.Popup
          className={cn(
            'bg-popover text-popover-foreground overflow-hidden rounded-md border px-3 py-1.5 text-sm shadow-md',
            className,
          )}
          {...props}
        />
      </TooltipPrimitive.Positioner>
    </TooltipPrimitive.Portal>
  );
}

export { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider };
