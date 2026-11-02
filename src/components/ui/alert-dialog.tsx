'use client';

import * as React from 'react';

import { AlertDialog as AlertDialogPrimitive } from '@base-ui/react/alert-dialog';

import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';

type WithStringClassName<T> = Omit<T, 'className'> & { className?: string | undefined };

const AlertDialog = AlertDialogPrimitive.Root;
const AlertDialogTrigger = AlertDialogPrimitive.Trigger;
const AlertDialogPortal = AlertDialogPrimitive.Portal;

function AlertDialogOverlay({
  className,
  ...props
}: WithStringClassName<React.ComponentProps<typeof AlertDialogPrimitive.Backdrop>>) {
  return (
    <AlertDialogPrimitive.Backdrop
      className={cn('fixed inset-0 z-50 bg-black/50', className)}
      {...props}
    />
  );
}

function AlertDialogContent({
  className,
  ...props
}: WithStringClassName<React.ComponentProps<typeof AlertDialogPrimitive.Popup>>) {
  return (
    <AlertDialogPortal>
      <AlertDialogOverlay />
      <AlertDialogPrimitive.Popup
        className={cn(
          'fixed top-1/2 left-1/2 z-50 grid w-full max-w-md -translate-x-1/2 -translate-y-1/2 gap-4 rounded-xl border border-gray-200 bg-white p-6 shadow-lg duration-200',
          className,
        )}
        {...props}
      />
    </AlertDialogPortal>
  );
}

const AlertDialogHeader = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn('flex flex-col gap-2 text-left', className)} {...props} />
);
AlertDialogHeader.displayName = 'AlertDialogHeader';

const AlertDialogFooter = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn('flex flex-col-reverse gap-2 sm:flex-row sm:justify-end', className)}
    {...props}
  />
);
AlertDialogFooter.displayName = 'AlertDialogFooter';

function AlertDialogTitle({
  className,
  ...props
}: WithStringClassName<React.ComponentProps<typeof AlertDialogPrimitive.Title>>) {
  return (
    <AlertDialogPrimitive.Title
      className={cn('text-base font-semibold text-gray-900', className)}
      {...props}
    />
  );
}

function AlertDialogDescription({
  className,
  ...props
}: WithStringClassName<React.ComponentProps<typeof AlertDialogPrimitive.Description>>) {
  return (
    <AlertDialogPrimitive.Description
      className={cn('text-sm text-gray-500', className)}
      {...props}
    />
  );
}

// Action·Cancel 은 누르면 닫히는 버튼이다(Base UI Close). 처리하는 동안 열어 두려면 onClick 에서
// event.preventBaseUIHandler() 를 부른다 — Radix 시절의 e.preventDefault() 는 더 이상 닫힘을 막지 않는다.
function AlertDialogAction({
  className,
  ...props
}: WithStringClassName<React.ComponentProps<typeof AlertDialogPrimitive.Close>>) {
  return <AlertDialogPrimitive.Close className={cn(buttonVariants(), className)} {...props} />;
}

function AlertDialogCancel({
  className,
  ...props
}: WithStringClassName<React.ComponentProps<typeof AlertDialogPrimitive.Close>>) {
  return (
    <AlertDialogPrimitive.Close
      className={cn(buttonVariants({ variant: 'outline' }), className)}
      {...props}
    />
  );
}

export {
  AlertDialog,
  AlertDialogPortal,
  AlertDialogOverlay,
  AlertDialogTrigger,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogAction,
  AlertDialogCancel,
};
