'use client';

import { type KeyboardEvent, useRef } from 'react';

import { cn } from '@/lib/utils';
import type { SurveyListWhose } from '@/shared/contracts/survey-builder-io';

const OPTIONS: { key: SurveyListWhose; label: string }[] = [
  { key: 'team', label: '팀 전체' },
  { key: 'mine', label: '내 설문' },
];

/**
 * 보는 자리 「팀 전체 | 내 설문」 (0158) — 툴바 둘째 줄 맨 앞. 「누구 것을 볼지 → 어떤 상태를 볼지」
 * 순서로 읽히게 목록 상태 세그먼트 앞에 같은 꼴(회색 트랙)로 선다. 내 설문은 내가 소유하거나 참여자로
 * 초대된 설문이다. 고르면 계정에 남아 다음에 같은 자리로 열린다(저장은 상위가 한다).
 *
 * 접근성은 목록 상태 세그먼트와 같은 라디오 그룹 패턴이다 — 고른 칸만 탭 순서에 들고 화살표가 고른다.
 */
export function WhoseToggle({
  value,
  onChange,
}: {
  value: SurveyListWhose;
  onChange: (next: SurveyListWhose) => void;
}) {
  const buttonsRef = useRef<(HTMLButtonElement | null)[]>([]);

  function select(index: number) {
    const size = OPTIONS.length;
    const next = OPTIONS[(index + size) % size];
    if (!next) return;
    onChange(next.key);
    buttonsRef.current[(index + size) % size]?.focus();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    if (['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp'].includes(event.key)) {
      event.preventDefault();
      select(index + (event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : -1));
    }
  }

  return (
    <div
      role="radiogroup"
      aria-label="보는 자리"
      className="inline-flex shrink-0 items-center gap-0.5 rounded-[10px] bg-[#F2F2F5] p-[3px]"
    >
      {OPTIONS.map((option, index) => {
        const active = value === option.key;
        return (
          <button
            key={option.key}
            ref={(el) => {
              buttonsRef.current[index] = el;
            }}
            type="button"
            role="radio"
            aria-checked={active}
            tabIndex={active ? 0 : -1}
            onClick={() => {
              if (!active) onChange(option.key);
            }}
            onKeyDown={(event) => handleKeyDown(event, index)}
            className={cn(
              'flex h-[30px] items-center rounded-[8px] px-3 text-[13px] transition-colors focus-visible:ring-2 focus-visible:ring-[#2E4FCE]/40 focus-visible:outline-none',
              active
                ? 'bg-white font-semibold text-[#1C1C1E] shadow-[0_1px_2px_rgba(0,0,0,0.08)]'
                : 'text-[#6E6E73] hover:text-[#1C1C1E]',
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
