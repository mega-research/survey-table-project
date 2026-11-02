'use client';

import { Button } from '@/components/ui/button';
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  ComboboxTrigger,
  ComboboxValue,
} from '@/components/ui/combobox';
import { cn } from '@/lib/utils';

export interface SearchableSelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

interface SearchableSelectProps {
  options: SearchableSelectOption[];
  value: string | null;
  onValueChange: (value: string) => void;
  placeholder?: string;
  searchPlaceholder?: string;
  emptyText?: string;
  /** 펼친 목록 폭 */
  className?: string;
  /** 트리거 폭·모양 */
  triggerClassName?: string;
  disabled?: boolean;
}

/**
 * 검색해서 하나 고르기 — 교차분석 질문 고르기·필터 조건이 쓴다. shadcn 공식 Combobox 의
 * 「버튼 트리거 + 팝업 안 검색 칸」 모양이다(목록이 길어 Select 대신 이것을 쓴다).
 */
export function SearchableSelect({
  options,
  value,
  onValueChange,
  placeholder = '선택...',
  searchPlaceholder = '검색...',
  emptyText = '결과가 없습니다',
  className,
  triggerClassName,
  disabled = false,
}: SearchableSelectProps) {
  const selected = options.find((option) => option.value === value) ?? null;
  return (
    <Combobox<SearchableSelectOption>
      items={options}
      value={selected}
      onValueChange={(next) => {
        if (next) onValueChange(next.value);
      }}
      itemToStringLabel={(option) => option.label}
      isItemEqualToValue={(a, b) => a.value === b.value}
      disabled={disabled}
    >
      <ComboboxTrigger
        render={
          <Button
            variant="outline"
            className={cn('w-full justify-between font-normal', triggerClassName)}
          />
        }
      >
        <span className={cn('truncate', !selected && 'text-muted-foreground')}>
          <ComboboxValue placeholder={placeholder} />
        </span>
      </ComboboxTrigger>
      <ComboboxContent className={className}>
        <ComboboxInput showTrigger={false} placeholder={searchPlaceholder} />
        <ComboboxEmpty>{emptyText}</ComboboxEmpty>
        <ComboboxList>
          {(option: SearchableSelectOption) => (
            <ComboboxItem key={option.value} value={option} disabled={option.disabled}>
              <span className="truncate">{option.label}</span>
            </ComboboxItem>
          )}
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  );
}
