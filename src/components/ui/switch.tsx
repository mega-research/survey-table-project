'use client';

import * as React from 'react';

import { Switch as SwitchPrimitive } from '@base-ui/react/switch';

import { cn } from '@/lib/utils';

// onCheckedChange 는 켜짐 여부 하나만 넘긴다 — Base UI 가 덧붙이는 eventDetails 를 쓰는 쪽이 없고,
// 콜백을 그대로 prop 으로 흘려보내는 화면이 많아 그 인자가 위로 새지 않게 한다.
type SwitchProps = Omit<React.ComponentProps<typeof SwitchPrimitive.Root>, 'className' | 'onCheckedChange'> & {
  className?: string | undefined;
  onCheckedChange?: ((checked: boolean) => void) | undefined;
};

// Checkbox 와 같은 이유로 네이티브 button 으로 그린다(형제 <Label htmlFor>).
function Switch({ className, onCheckedChange, ...props }: SwitchProps) {
  return (
    <SwitchPrimitive.Root
      onCheckedChange={(checked) => onCheckedChange?.(checked)}
      nativeButton
      render={<button type="button" />}
      className={cn(
        'peer focus-visible:ring-ring focus-visible:ring-offset-background inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50 data-[checked]:bg-blue-500 data-[unchecked]:bg-gray-200',
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb className="pointer-events-none block h-4 w-4 rounded-full bg-white shadow-lg ring-0 transition-transform data-[checked]:translate-x-4 data-[unchecked]:translate-x-0" />
    </SwitchPrimitive.Root>
  );
}

export { Switch };
