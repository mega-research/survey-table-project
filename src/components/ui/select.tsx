'use client';

import * as React from 'react';

import { Select as SelectPrimitive } from '@base-ui/react/select';
import { Check, ChevronDown, ChevronUp } from 'lucide-react';

import { cn } from '@/lib/utils';

type WithStringClassName<T> = Omit<T, 'className'> & { className?: string | undefined };

type SelectRootProps = React.ComponentProps<typeof SelectPrimitive.Root<string>>;

type SelectProps = Omit<
  SelectRootProps,
  'value' | 'defaultValue' | 'onValueChange' | 'items' | 'multiple'
> & {
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
};

interface SelectItemEntry {
  value: string;
  label: React.ReactNode;
}

// 자식 트리에서 SelectItem 의 value·라벨을 모은다. Base UI 의 Select.Value 는 items 가 없으면
// 라벨이 아니라 원시 value 를 그린다 — Radix 는 고른 항목의 ItemText 를 그렸으므로, 같은 화면을
// 내려면 Root 에 items 를 넘겨야 한다. 항목을 다른 컴포넌트 안에 숨겨 그리면 여기서 못 찾으니
// SelectItem 은 Select 의 JSX 안에 직접 둘 것(select.test.tsx 가 이 계약을 못박는다).
function collectSelectItems(node: React.ReactNode, out: SelectItemEntry[]): SelectItemEntry[] {
  React.Children.forEach(node, (child) => {
    if (!React.isValidElement<{ children?: React.ReactNode; value?: unknown }>(child)) return;
    if (child.type === SelectItem) {
      if (typeof child.props.value === 'string') {
        out.push({ value: child.props.value, label: child.props.children });
      }
      return;
    }
    if (child.props.children !== undefined) collectSelectItems(child.props.children, out);
  });
  return out;
}

// value 는 문자열이다(Radix 와 같은 계약). 빈 문자열·undefined 는 「고르지 않음」(null) 으로 보내
// placeholder 를 그린다 — Radix 는 value="" 인 항목을 허용하지 않아 빈 문자열은 늘 「없음」이었다.
function Select(allProps: SelectProps) {
  const { value, defaultValue, onValueChange, children, ...props } = allProps;
  const isControlled = 'value' in allProps;
  const items = collectSelectItems(children, []);
  return (
    <SelectPrimitive.Root<string>
      items={items}
      {...(isControlled ? { value: value === undefined || value === '' ? null : value } : {})}
      {...(defaultValue !== undefined && defaultValue !== '' ? { defaultValue } : {})}
      onValueChange={(next) => {
        if (typeof next === 'string') onValueChange?.(next);
      }}
      {...props}
    >
      {children}
    </SelectPrimitive.Root>
  );
}

const SelectGroup = SelectPrimitive.Group;

function SelectValue({
  className,
  ...props
}: WithStringClassName<React.ComponentProps<typeof SelectPrimitive.Value>>) {
  return <SelectPrimitive.Value className={cn('truncate', className)} {...props} />;
}

function SelectTrigger({
  className,
  children,
  ...props
}: WithStringClassName<React.ComponentProps<typeof SelectPrimitive.Trigger>>) {
  return (
    <SelectPrimitive.Trigger
      className={cn(
        // text-left 필수: button 의 UA 기본 스타일이 text-align:center 라, line-clamp 로 잘린
        // 값이 span 안에서 가운데 정렬되어 좌우로 여백이 반씩 갈린다. 라벨마다 잘리는 양이
        // 달라 글자 시작 위치가 제각각으로 보인다.
        'border-input bg-background ring-offset-background data-[placeholder]:text-muted-foreground focus:ring-ring flex h-10 w-full items-center justify-between rounded-md border px-3 py-2 text-left text-sm focus:ring-2 focus:ring-offset-2 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50 [&>span]:line-clamp-1',
        className,
      )}
      {...props}
    >
      {children}
      <SelectPrimitive.Icon className="flex shrink-0">
        <ChevronDown className="h-4 w-4 opacity-50" />
      </SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
  );
}

function SelectScrollUpButton({
  className,
  ...props
}: WithStringClassName<React.ComponentProps<typeof SelectPrimitive.ScrollUpArrow>>) {
  return (
    <SelectPrimitive.ScrollUpArrow
      className={cn(
        'bg-popover top-0 z-10 flex w-full cursor-default items-center justify-center py-1',
        className,
      )}
      {...props}
    >
      <ChevronUp className="h-4 w-4" />
    </SelectPrimitive.ScrollUpArrow>
  );
}

function SelectScrollDownButton({
  className,
  ...props
}: WithStringClassName<React.ComponentProps<typeof SelectPrimitive.ScrollDownArrow>>) {
  return (
    <SelectPrimitive.ScrollDownArrow
      className={cn(
        'bg-popover bottom-0 z-10 flex w-full cursor-default items-center justify-center py-1',
        className,
      )}
      {...props}
    >
      <ChevronDown className="h-4 w-4" />
    </SelectPrimitive.ScrollDownArrow>
  );
}

type SelectPositionerProps = React.ComponentProps<typeof SelectPrimitive.Positioner>;

type SelectContentProps = WithStringClassName<React.ComponentProps<typeof SelectPrimitive.Popup>> &
  Pick<SelectPositionerProps, 'side' | 'align' | 'sideOffset' | 'alignOffset'>;

// 트리거 아래에 펼치는 popper 배치(Radix 시절 position="popper" 기본값) — 고른 항목을 트리거에
// 겹쳐 맞추는 Base UI 기본 배치(alignItemWithTrigger)는 쓰지 않는다.
function SelectContent({
  className,
  children,
  side,
  align = 'start',
  sideOffset = 4,
  alignOffset,
  ...props
}: SelectContentProps) {
  return (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Positioner
        className="z-50"
        alignItemWithTrigger={false}
        side={side}
        align={align}
        sideOffset={sideOffset}
        alignOffset={alignOffset}
      >
        <SelectPrimitive.Popup
          className={cn(
            // 높이 상한은 Popup 이 쥐고 List 가 남는 높이만큼 스크롤한다 — 쓰는 쪽의 max-h-* 가
            // 이 상한을 덮어써도(tailwind-merge) 목록 끝까지 닿는다.
            'bg-popover text-popover-foreground relative flex max-h-[min(var(--available-height,24rem),24rem)] min-w-[max(8rem,var(--anchor-width))] origin-[var(--transform-origin)] flex-col overflow-hidden rounded-md border shadow-md outline-none',
            className,
          )}
          {...props}
        >
          <SelectScrollUpButton />
          <SelectPrimitive.List className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto p-1">
            {children}
          </SelectPrimitive.List>
          <SelectScrollDownButton />
        </SelectPrimitive.Popup>
      </SelectPrimitive.Positioner>
    </SelectPrimitive.Portal>
  );
}

// Radix 의 SelectLabel 은 SelectGroup 안의 제목이었다 — Base UI 에서는 GroupLabel 이다
// (Base UI 의 Select.Label 은 트리거 바깥의 필드 라벨이라 다른 것).
function SelectLabel({
  className,
  ...props
}: WithStringClassName<React.ComponentProps<typeof SelectPrimitive.GroupLabel>>) {
  return (
    <SelectPrimitive.GroupLabel
      className={cn('py-1.5 pr-2 pl-8 text-sm font-semibold', className)}
      {...props}
    />
  );
}

function SelectItem({
  className,
  children,
  ...props
}: WithStringClassName<React.ComponentProps<typeof SelectPrimitive.Item>>) {
  return (
    <SelectPrimitive.Item
      className={cn(
        'data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground relative flex w-full cursor-default items-center rounded-sm py-1.5 pr-2 pl-8 text-sm outline-none select-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
        className,
      )}
      {...props}
    >
      <span className="absolute left-2 flex h-3.5 w-3.5 items-center justify-center">
        <SelectPrimitive.ItemIndicator>
          <Check className="h-4 w-4" />
        </SelectPrimitive.ItemIndicator>
      </span>

      <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
    </SelectPrimitive.Item>
  );
}

function SelectSeparator({
  className,
  ...props
}: WithStringClassName<React.ComponentProps<typeof SelectPrimitive.Separator>>) {
  return (
    <SelectPrimitive.Separator className={cn('bg-muted -mx-1 my-1 h-px', className)} {...props} />
  );
}

export {
  Select,
  SelectGroup,
  SelectValue,
  SelectTrigger,
  SelectContent,
  SelectLabel,
  SelectItem,
  SelectSeparator,
  SelectScrollUpButton,
  SelectScrollDownButton,
};
