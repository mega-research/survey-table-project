import * as React from 'react';

import { cn } from '@/lib/utils';

// Base UI 에는 독립 Label 이 없다(Field.Label 은 Field 안에서만 쓴다). htmlFor 로 잇는
// 평범한 label 이면 충분하다 — Checkbox·Switch 래퍼가 네이티브 button 을 그려 htmlFor 가 닿는다.
function Label({ className, ...props }: React.ComponentProps<'label'>) {
  return (
    <label
      className={cn(
        'text-sm leading-none font-medium peer-disabled:cursor-not-allowed peer-disabled:opacity-70',
        className,
      )}
      {...props}
    />
  );
}

export { Label };
