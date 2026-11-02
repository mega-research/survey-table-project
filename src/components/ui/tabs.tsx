'use client';

import * as React from 'react';

import { Tabs as TabsPrimitive } from '@base-ui/react/tabs';

import { cn } from '@/lib/utils';

type WithStringClassName<T> = Omit<T, 'className'> & { className?: string | undefined };

const Tabs = TabsPrimitive.Root;

function TabsList({
  className,
  ...props
}: WithStringClassName<React.ComponentProps<typeof TabsPrimitive.List>>) {
  return (
    <TabsPrimitive.List
      className={cn(
        'bg-muted text-muted-foreground inline-flex h-10 items-center justify-center rounded-md p-1',
        className,
      )}
      {...props}
    />
  );
}

function TabsTrigger({
  className,
  ...props
}: WithStringClassName<React.ComponentProps<typeof TabsPrimitive.Tab>>) {
  return (
    <TabsPrimitive.Tab
      className={cn(
        'ring-offset-background focus-visible:ring-ring data-[active]:bg-background data-[active]:text-foreground inline-flex items-center justify-center rounded-sm px-3 py-1.5 text-sm font-medium whitespace-nowrap transition-all focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50 data-[active]:shadow-sm',
        className,
      )}
      {...props}
    />
  );
}

function TabsContent({
  className,
  ...props
}: WithStringClassName<React.ComponentProps<typeof TabsPrimitive.Panel>>) {
  return (
    <TabsPrimitive.Panel
      className={cn(
        'ring-offset-background focus-visible:ring-ring mt-2 focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none',
        className,
      )}
      {...props}
    />
  );
}

export { Tabs, TabsList, TabsTrigger, TabsContent };
