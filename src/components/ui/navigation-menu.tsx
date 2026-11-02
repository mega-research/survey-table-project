'use client';

import * as React from 'react';

import { NavigationMenu as NavigationMenuPrimitive } from '@base-ui/react/navigation-menu';
import { ChevronDown } from 'lucide-react';

import { cn } from '@/lib/utils';

type WithStringClassName<T> = Omit<T, 'className'> & { className?: string | undefined };

// Base UI 의 내비게이션 메뉴는 열린 Content 를 Root 끝의 Viewport 로 옮겨 그린다. Root 래퍼가
// Portal·Positioner·Popup·Viewport 를 붙여 두므로 쓰는 쪽은 Item 안에 Trigger·Content 만 둔다.
// 펼침 판은 열린 트리거 바로 아래에 붙는다.
function NavigationMenu({
  className,
  children,
  ...props
}: WithStringClassName<React.ComponentProps<typeof NavigationMenuPrimitive.Root>>) {
  return (
    <NavigationMenuPrimitive.Root
      className={cn('relative z-10 flex max-w-max flex-1 items-center justify-center', className)}
      {...props}
    >
      {children}
      <NavigationMenuPrimitive.Portal>
        <NavigationMenuPrimitive.Positioner
          className="z-50 h-[var(--positioner-height)] w-[var(--positioner-width)] max-w-[var(--available-width)] before:absolute before:content-[''] data-[side=bottom]:before:top-[-6px] data-[side=bottom]:before:right-0 data-[side=bottom]:before:left-0 data-[side=bottom]:before:h-1.5"
          side="bottom"
          align="start"
          sideOffset={6}
          collisionAvoidance={{ side: 'none' }}
        >
          <NavigationMenuPrimitive.Popup className="relative h-[var(--popup-height)] w-[var(--popup-width)] origin-[var(--transform-origin)] rounded-md border border-slate-200 bg-white text-slate-900 shadow-lg outline-none">
            <NavigationMenuPrimitive.Viewport className="relative h-full w-full overflow-hidden" />
          </NavigationMenuPrimitive.Popup>
        </NavigationMenuPrimitive.Positioner>
      </NavigationMenuPrimitive.Portal>
    </NavigationMenuPrimitive.Root>
  );
}

function NavigationMenuList({
  className,
  ...props
}: WithStringClassName<React.ComponentProps<typeof NavigationMenuPrimitive.List>>) {
  return (
    <NavigationMenuPrimitive.List
      className={cn('group flex flex-1 list-none items-center justify-center space-x-1', className)}
      {...props}
    />
  );
}

function NavigationMenuItem({
  className,
  ...props
}: WithStringClassName<React.ComponentProps<typeof NavigationMenuPrimitive.Item>>) {
  return <NavigationMenuPrimitive.Item className={cn('relative', className)} {...props} />;
}

const navigationMenuTriggerStyle =
  'group inline-flex h-10 w-max items-center justify-center rounded-md bg-background px-4 py-2 text-sm font-medium transition-colors hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground focus:outline-none disabled:pointer-events-none disabled:opacity-50 data-[popup-open]:text-accent-foreground data-[popup-open]:bg-accent/50 data-[popup-open]:hover:bg-accent data-[popup-open]:focus:bg-accent';

function NavigationMenuTrigger({
  className,
  children,
  ...props
}: WithStringClassName<React.ComponentProps<typeof NavigationMenuPrimitive.Trigger>>) {
  return (
    <NavigationMenuPrimitive.Trigger
      className={cn(navigationMenuTriggerStyle, 'group', className)}
      {...props}
    >
      {children}{' '}
      <ChevronDown
        className="relative top-[1px] ml-1 h-3 w-3 transition duration-200 group-data-[popup-open]:rotate-180"
        aria-hidden="true"
      />
    </NavigationMenuPrimitive.Trigger>
  );
}

function NavigationMenuContent({
  className,
  ...props
}: WithStringClassName<React.ComponentProps<typeof NavigationMenuPrimitive.Content>>) {
  return <NavigationMenuPrimitive.Content className={cn('h-full', className)} {...props} />;
}

const NavigationMenuLink = NavigationMenuPrimitive.Link;

export {
  navigationMenuTriggerStyle,
  NavigationMenu,
  NavigationMenuList,
  NavigationMenuItem,
  NavigationMenuContent,
  NavigationMenuTrigger,
  NavigationMenuLink,
};
