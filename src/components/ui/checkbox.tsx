'use client';

import * as React from 'react';

import { Checkbox as CheckboxPrimitive } from '@base-ui/react/checkbox';
import { Check } from 'lucide-react';

import { cn } from '@/lib/utils';

// onCheckedChange 는 켜짐 여부 하나만 넘긴다 — Base UI 가 덧붙이는 eventDetails 를 쓰는 쪽이 없고,
// 콜백을 그대로 prop 으로 흘려보내는 화면이 많아 그 인자가 위로 새지 않게 한다.
type CheckboxProps = Omit<React.ComponentProps<typeof CheckboxPrimitive.Root>, 'className' | 'onCheckedChange'> & {
  className?: string | undefined;
  onCheckedChange?: ((checked: boolean) => void) | undefined;
};

// 네이티브 button 으로 그린다 — 형제 <Label htmlFor> 가 이 id 에 닿아야 하고(Base UI 기본은 span),
// 감싸는 <label> 패턴도 button 이면 그대로 동작한다.
function Checkbox({ className, onCheckedChange, ...props }: CheckboxProps) {
  return (
    <CheckboxPrimitive.Root
      onCheckedChange={(checked) => onCheckedChange?.(checked)}
      nativeButton
      render={<button type="button" />}
      className={cn(
        'peer border-primary ring-offset-background focus-visible:ring-ring data-[checked]:bg-primary data-[checked]:text-primary-foreground h-4 w-4 shrink-0 rounded-sm border focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator className="flex items-center justify-center text-current">
        <Check className="h-4 w-4" />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );
}

export { Checkbox };
