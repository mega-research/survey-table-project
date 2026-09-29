'use client';

import type { LucideIcon } from 'lucide-react';

import { cn } from '@/lib/utils';

/**
 * 공유 설정 모달의 세그먼트 컨트롤 (.pen FLOW 4-2·10-1).
 *
 * 이 모달에 세그먼트가 둘이다 — 공개 범위(팀 공개 | 초대된 멤버만)와 실사 방식(내부 실사원 |
 * 외주, ADR-0026). 같은 모양을 두 벌 적어 두면 한쪽만 고쳐지므로 여기로 모은다.
 *
 * `features/workspace/segmented-choice.tsx` 와 모양이 겹치는데 그것을 쓰지 못한다 — feature 간
 * 직접 import 가 ESLint 금지고(survey-builder ↔ workspace 는 서로 독립) 공유 설정 모달이
 * survey-builder 에 사는 이유가 그 방향 제약이기 때문이다(share-settings-modal 주석). 세 번째
 * 소비자가 나타나면 `shared/` 로 승격할 자리다.
 */
export interface SegmentOption<T extends string> {
  value: T;
  label: string;
  /** 없으면 라벨만 그린다 — 실사 방식 세그먼트가 그렇다. */
  icon?: LucideIcon;
}

interface SegmentRowProps<T extends string> {
  /** 스크린리더가 읽는 이 세그먼트의 이름. */
  label: string;
  options: ReadonlyArray<SegmentOption<T>>;
  value: T;
  onChange: (value: T) => void;
  /**
   * 고를 수 없는 상태 — 공개 범위는 `survey.manageAccess` 가 없으면 잠기지만 **보여는 준다**.
   * 지금 무엇이 열려 있는지는 바꿀 수 없는 사람도 알아야 한다.
   */
  disabled?: boolean;
}

export function SegmentRow<T extends string>({
  label,
  options,
  value,
  onChange,
  disabled = false,
}: SegmentRowProps<T>) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className="flex gap-1 rounded-[10px] bg-[#EEF0F4] p-[3px]"
    >
      {options.map((option) => {
        const Icon = option.icon;
        const active = value === option.value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={active}
            disabled={disabled}
            onClick={() => onChange(option.value)}
            className={cn(
              'flex h-8 flex-1 items-center justify-center gap-1.5 rounded-[8px] text-[13px] font-medium transition-colors',
              active ? 'bg-white text-[#1C1C1E] shadow-sm' : 'text-[#6E6E73]',
              !disabled && !active && 'hover:text-[#1C1C1E]',
              disabled && 'cursor-not-allowed',
            )}
          >
            {Icon && <Icon className="h-3.5 w-3.5" />}
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
