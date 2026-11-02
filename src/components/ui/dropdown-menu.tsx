'use client';

import * as React from 'react';

import { Menu as MenuPrimitive } from '@base-ui/react/menu';
import { Check, ChevronRight, Circle } from 'lucide-react';

import { cn } from '@/lib/utils';

type WithStringClassName<T> = Omit<T, 'className'> & { className?: string | undefined };

type PositionerProps = React.ComponentProps<typeof MenuPrimitive.Positioner>;

type PlacementProps = Pick<
  PositionerProps,
  'side' | 'align' | 'sideOffset' | 'alignOffset' | 'collisionPadding'
>;

const DropdownMenu = MenuPrimitive.Root;

const DropdownMenuTrigger = MenuPrimitive.Trigger;

const DropdownMenuGroup = MenuPrimitive.Group;

const DropdownMenuPortal = MenuPrimitive.Portal;

const DropdownMenuSub = MenuPrimitive.SubmenuRoot;

const DropdownMenuRadioGroup = MenuPrimitive.RadioGroup;

const popupClassName =
  'bg-popover text-popover-foreground min-w-[8rem] origin-[var(--transform-origin)] overflow-x-hidden overflow-y-auto rounded-md border p-1 shadow-md outline-none max-h-[var(--available-height)]';

// 항목은 포인터·키보드 강조 시 data-highlighted 를 받는다(Radix 의 focus 상태 자리).
const itemClassName =
  'data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground relative flex cursor-default items-center rounded-sm text-sm transition-colors outline-none select-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50';

function DropdownMenuSubTrigger({
  className,
  inset,
  children,
  ...props
}: WithStringClassName<React.ComponentProps<typeof MenuPrimitive.SubmenuTrigger>> & {
  inset?: boolean;
}) {
  return (
    <MenuPrimitive.SubmenuTrigger
      className={cn(
        'data-[highlighted]:bg-accent data-[popup-open]:bg-accent flex cursor-default items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none select-none [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0',
        inset && 'pl-8',
        className,
      )}
      {...props}
    >
      {children}
      <ChevronRight className="ml-auto" />
    </MenuPrimitive.SubmenuTrigger>
  );
}

// 하위 메뉴의 쪽(side)은 Base UI 가 inline-end 로 정한다 — 넘기지 않는다.
function DropdownMenuSubContent({
  className,
  side,
  align,
  sideOffset,
  alignOffset = -4,
  collisionPadding,
  ...props
}: WithStringClassName<React.ComponentProps<typeof MenuPrimitive.Popup>> & PlacementProps) {
  return (
    <MenuPrimitive.Portal>
      <MenuPrimitive.Positioner
        className="z-50"
        side={side}
        align={align}
        sideOffset={sideOffset}
        alignOffset={alignOffset}
        collisionPadding={collisionPadding}
      >
        <MenuPrimitive.Popup className={cn(popupClassName, 'shadow-lg', className)} {...props} />
      </MenuPrimitive.Positioner>
    </MenuPrimitive.Portal>
  );
}

function DropdownMenuContent({
  className,
  side,
  align,
  sideOffset = 4,
  alignOffset,
  collisionPadding,
  ...props
}: WithStringClassName<React.ComponentProps<typeof MenuPrimitive.Popup>> & PlacementProps) {
  return (
    <MenuPrimitive.Portal>
      <MenuPrimitive.Positioner
        className="z-50"
        side={side}
        align={align}
        sideOffset={sideOffset}
        alignOffset={alignOffset}
        collisionPadding={collisionPadding}
      >
        <MenuPrimitive.Popup className={cn(popupClassName, className)} {...props} />
      </MenuPrimitive.Positioner>
    </MenuPrimitive.Portal>
  );
}

// 선택 처리는 onClick 이다(Radix 의 onSelect 자리). 누른 뒤 메뉴를 열어 두려면 closeOnClick={false}.
function DropdownMenuItem({
  className,
  inset,
  ...props
}: WithStringClassName<React.ComponentProps<typeof MenuPrimitive.Item>> & {
  inset?: boolean;
}) {
  return (
    <MenuPrimitive.Item
      className={cn(
        itemClassName,
        'gap-2 px-2 py-1.5 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0',
        inset && 'pl-8',
        className,
      )}
      {...props}
    />
  );
}

// Radix 와 달리 Base UI 의 체크·라디오 항목은 기본으로 메뉴를 닫지 않는다(closeOnClick 기본 false).
function DropdownMenuCheckboxItem({
  className,
  children,
  ...props
}: WithStringClassName<React.ComponentProps<typeof MenuPrimitive.CheckboxItem>>) {
  return (
    <MenuPrimitive.CheckboxItem
      className={cn(itemClassName, 'py-1.5 pr-2 pl-8', className)}
      {...props}
    >
      <span className="absolute left-2 flex h-3.5 w-3.5 items-center justify-center">
        <MenuPrimitive.CheckboxItemIndicator>
          <Check className="h-4 w-4" />
        </MenuPrimitive.CheckboxItemIndicator>
      </span>
      {children}
    </MenuPrimitive.CheckboxItem>
  );
}

function DropdownMenuRadioItem({
  className,
  children,
  ...props
}: WithStringClassName<React.ComponentProps<typeof MenuPrimitive.RadioItem>>) {
  return (
    <MenuPrimitive.RadioItem
      className={cn(itemClassName, 'py-1.5 pr-2 pl-8', className)}
      {...props}
    >
      <span className="absolute left-2 flex h-3.5 w-3.5 items-center justify-center">
        <MenuPrimitive.RadioItemIndicator>
          <Circle className="h-2 w-2 fill-current" />
        </MenuPrimitive.RadioItemIndicator>
      </span>
      {children}
    </MenuPrimitive.RadioItem>
  );
}

// Base UI 의 GroupLabel 은 Group 안에서만 쓴다. 이 라벨은 그룹 없이도 쓰이므로 평범한 div 다.
function DropdownMenuLabel({
  className,
  inset,
  ...props
}: React.ComponentProps<'div'> & { inset?: boolean }) {
  return (
    <div
      className={cn('px-2 py-1.5 text-sm font-semibold', inset && 'pl-8', className)}
      {...props}
    />
  );
}

function DropdownMenuSeparator({
  className,
  ...props
}: WithStringClassName<React.ComponentProps<typeof MenuPrimitive.Separator>>) {
  return (
    <MenuPrimitive.Separator className={cn('bg-muted -mx-1 my-1 h-px', className)} {...props} />
  );
}

const DropdownMenuShortcut = ({ className, ...props }: React.HTMLAttributes<HTMLSpanElement>) => {
  return (
    <span className={cn('ml-auto text-xs tracking-widest opacity-60', className)} {...props} />
  );
};
DropdownMenuShortcut.displayName = 'DropdownMenuShortcut';

export {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuCheckboxItem,
  DropdownMenuRadioItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuGroup,
  DropdownMenuPortal,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuRadioGroup,
};
