'use client';

import * as React from 'react';

import { Popover as PopoverPrimitive } from '@base-ui/react/popover';

import { cn } from '@/lib/utils';

const Popover = PopoverPrimitive.Root;

const PopoverTrigger = PopoverPrimitive.Trigger;

type PositionerProps = React.ComponentProps<typeof PopoverPrimitive.Positioner>;

type PopoverContentProps = Omit<React.ComponentProps<typeof PopoverPrimitive.Popup>, 'className'> &
  Pick<
    PositionerProps,
    'side' | 'align' | 'sideOffset' | 'alignOffset' | 'anchor' | 'collisionPadding'
  > & {
    className?: string | undefined;
  };

// Portal·Positioner 를 감싸 Radix 시절처럼 Content 하나로 쓴다. 위치 prop 은 Positioner 로 간다.
// 트리거가 아닌 곳에 붙이려면(옛 PopoverAnchor) anchor 에 요소 ref 나 가상 요소를 넘긴다.
function PopoverContent({
  className,
  side,
  align = 'center',
  sideOffset = 4,
  alignOffset,
  anchor,
  collisionPadding,
  ...props
}: PopoverContentProps) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Positioner
        className="z-50"
        side={side}
        align={align}
        sideOffset={sideOffset}
        alignOffset={alignOffset}
        anchor={anchor}
        collisionPadding={collisionPadding}
      >
        <PopoverPrimitive.Popup
          className={cn(
            'w-72 rounded-lg border border-gray-200 bg-white p-4 text-gray-900 shadow-lg outline-none',
            className,
          )}
          {...props}
        />
      </PopoverPrimitive.Positioner>
    </PopoverPrimitive.Portal>
  );
}

export { Popover, PopoverTrigger, PopoverContent };
