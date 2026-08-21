'use client';

import { useRouter, useSearchParams } from 'next/navigation';

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

import { formatKrw } from './_format';

export interface CycleSelectorOption {
  cycleKey: string;
  startLabel: string;
  endLabel: string;
  isCurrent: boolean;
  totalCostKrw: number;
}

interface Props {
  options: CycleSelectorOption[];
  /** 현재 선택된 cycleKey. 미선택 시 가장 최신. */
  value: string;
}

export function CycleSelector({ options, value }: Props) {
  const router = useRouter();
  const params = useSearchParams();

  const handleChange = (next: string) => {
    const sp = new URLSearchParams(params?.toString() ?? '');
    sp.set('cycle', next);
    router.push(`?${sp.toString()}`);
  };

  return (
    <Select value={value} onValueChange={handleChange}>
      <SelectTrigger className="w-[400px]">
        <SelectValue placeholder="기간을 선택하세요" />
      </SelectTrigger>
      <SelectContent>
        {options.map((opt) => (
          <SelectItem key={opt.cycleKey} value={opt.cycleKey}>
            <span className="flex items-center gap-2 whitespace-nowrap">
              <span className="tabular-nums">
                {opt.startLabel} ~ {opt.endLabel}
              </span>
              {opt.isCurrent && (
                <span className="rounded-full bg-blue-100 px-1.5 py-0.5 text-[10px] font-medium text-blue-700">
                  진행 중
                </span>
              )}
              <span className="text-xs text-gray-500">· {formatKrw(opt.totalCostKrw)}</span>
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
