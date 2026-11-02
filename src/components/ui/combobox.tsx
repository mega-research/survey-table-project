'use client';

import * as React from 'react';

import { Combobox as ComboboxPrimitive } from '@base-ui/react/combobox';
import { Check, ChevronsUpDown, Search } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

type WithStringClassName<T> = Omit<T, 'className'> & { className?: string | undefined };

// ── 부품 ──────────────────────────────────────────────────────────────────────
// 검색 입력을 팝업 안에 두는 「찾아서 고르기」 모양(옛 Popover + cmdk Command 자리).
// 항목은 데이터(items)로 넘기고 ComboboxList 에 렌더 함수를 준다 — 걸러내기는 Base UI 가
// itemToStringLabel 로 만든 글자에 대해 한다.

const ComboboxRoot = ComboboxPrimitive.Root;

const ComboboxTrigger = ComboboxPrimitive.Trigger;

const ComboboxCollection = ComboboxPrimitive.Collection;

const ComboboxItemIndicator = ComboboxPrimitive.ItemIndicator;

type ComboboxPositionerProps = React.ComponentProps<typeof ComboboxPrimitive.Positioner>;

function ComboboxContent({
  className,
  side,
  align = 'start',
  sideOffset = 4,
  ...props
}: WithStringClassName<React.ComponentProps<typeof ComboboxPrimitive.Popup>> &
  Pick<ComboboxPositionerProps, 'side' | 'align' | 'sideOffset'>) {
  return (
    <ComboboxPrimitive.Portal>
      <ComboboxPrimitive.Positioner
        className="z-50"
        side={side}
        align={align}
        sideOffset={sideOffset}
      >
        <ComboboxPrimitive.Popup
          className={cn(
            'flex max-w-[var(--available-width)] origin-[var(--transform-origin)] flex-col overflow-hidden rounded-lg border border-gray-200 bg-white text-gray-900 shadow-lg outline-none',
            className,
          )}
          {...props}
        />
      </ComboboxPrimitive.Positioner>
    </ComboboxPrimitive.Portal>
  );
}

function ComboboxSearchInput({
  className,
  wrapperClassName,
  ...props
}: WithStringClassName<React.ComponentProps<typeof ComboboxPrimitive.Input>> & {
  wrapperClassName?: string;
}) {
  return (
    <div className={cn('flex items-center border-b border-gray-200 px-3', wrapperClassName)}>
      <Search className="mr-2 h-4 w-4 shrink-0 text-gray-400" />
      <ComboboxPrimitive.Input
        className={cn(
          'flex h-10 w-full rounded-md bg-transparent py-3 text-sm outline-none placeholder:text-gray-400 disabled:cursor-not-allowed disabled:opacity-50',
          className,
        )}
        {...props}
      />
    </div>
  );
}

function ComboboxEmpty({
  className,
  ...props
}: WithStringClassName<React.ComponentProps<typeof ComboboxPrimitive.Empty>>) {
  return (
    <ComboboxPrimitive.Empty
      className={cn('text-center text-sm text-gray-500 empty:hidden', className)}
      {...props}
    />
  );
}

function ComboboxList({
  className,
  ...props
}: WithStringClassName<React.ComponentProps<typeof ComboboxPrimitive.List>>) {
  return (
    <ComboboxPrimitive.List
      className={cn(
        'max-h-[300px] overflow-x-hidden overflow-y-auto overscroll-contain p-1 empty:p-0',
        className,
      )}
      {...props}
    />
  );
}

const ComboboxGroup = ComboboxPrimitive.Group;

function ComboboxGroupLabel({
  className,
  ...props
}: WithStringClassName<React.ComponentProps<typeof ComboboxPrimitive.GroupLabel>>) {
  return (
    <ComboboxPrimitive.GroupLabel
      className={cn('px-2 py-1.5 text-xs font-medium text-gray-500', className)}
      {...props}
    />
  );
}

function ComboboxItem({
  className,
  ...props
}: WithStringClassName<React.ComponentProps<typeof ComboboxPrimitive.Item>>) {
  return (
    <ComboboxPrimitive.Item
      className={cn(
        'relative flex cursor-pointer items-center rounded-md px-2 py-2 text-sm transition-colors outline-none select-none',
        'data-[highlighted]:bg-blue-50 data-[highlighted]:text-blue-700',
        'data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
        className,
      )}
      {...props}
    />
  );
}

// ── 완성품: 문자열 value 를 고르는 검색 가능한 선택 ─────────────────────────────────

export interface ComboboxOption {
  value: string;
  label: string;
  disabled?: boolean;
}

interface ComboboxProps {
  options: ComboboxOption[];
  value?: string;
  onValueChange?: (value: string) => void;
  placeholder?: string;
  searchPlaceholder?: string;
  emptyText?: string;
  className?: string | undefined;
  triggerClassName?: string;
  disabled?: boolean;
}

function Combobox({
  options,
  value,
  onValueChange,
  placeholder = '선택...',
  searchPlaceholder = '검색...',
  emptyText = '결과가 없습니다',
  className,
  triggerClassName,
  disabled = false,
}: ComboboxProps) {
  const selectedOption = options.find((option) => option.value === value) ?? null;

  return (
    <ComboboxRoot<ComboboxOption>
      items={options}
      value={selectedOption}
      onValueChange={(next) => {
        if (next) onValueChange?.(next.value);
      }}
      itemToStringLabel={(option) => option.label}
      isItemEqualToValue={(a, b) => a.value === b.value}
      disabled={disabled}
    >
      <ComboboxTrigger
        render={
          <Button
            variant="outline"
            className={cn(
              'w-full justify-between font-normal',
              !value && 'text-muted-foreground',
              triggerClassName,
            )}
          />
        }
      >
        <span className="truncate">{selectedOption ? selectedOption.label : placeholder}</span>
        <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
      </ComboboxTrigger>
      <ComboboxContent className={cn('w-72', className)}>
        <ComboboxSearchInput placeholder={searchPlaceholder} />
        <ComboboxEmpty className="py-6">{emptyText}</ComboboxEmpty>
        <ComboboxList>
          {(option: ComboboxOption) => (
            <ComboboxItem key={option.value} value={option} disabled={option.disabled}>
              <Check
                className={cn('mr-2 h-4 w-4', value === option.value ? 'opacity-100' : 'opacity-0')}
              />
              <span className="truncate">{option.label}</span>
            </ComboboxItem>
          )}
        </ComboboxList>
      </ComboboxContent>
    </ComboboxRoot>
  );
}

export {
  Combobox,
  ComboboxRoot,
  ComboboxTrigger,
  ComboboxContent,
  ComboboxSearchInput,
  ComboboxEmpty,
  ComboboxList,
  ComboboxGroup,
  ComboboxGroupLabel,
  ComboboxCollection,
  ComboboxItem,
  ComboboxItemIndicator,
};
