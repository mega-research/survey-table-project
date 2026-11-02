'use client';

import { type KeyboardEvent, useRef } from 'react';

import { cn } from '@/lib/utils';

import type { SurveyListLifecycleFilter } from './survey-list-pipeline';

// `closed` 의 라벨은 「종료」다(ADR-0030). 「완료」는 응답 상태의 어휘라 카드의 「완료 N건」 옆에서
// 무엇의 완료인지 읽히지 않는다. 종료는 종료 스위치와 마감일 경과를 함께 담는다(목록 상태).
const SEGMENTS: { key: SurveyListLifecycleFilter; label: string }[] = [
  { key: 'all', label: '전체' },
  { key: 'draft', label: '작성중' },
  { key: 'running', label: '진행중' },
  { key: 'closed', label: '종료' },
];

interface LifecycleSegmentProps {
  value: SurveyListLifecycleFilter;
  counts: Record<SurveyListLifecycleFilter, number>;
  onChange: (next: SurveyListLifecycleFilter) => void;
}

/**
 * 목록 상태 세그먼트 (시안 F8-a 둘째 줄 왼쪽) — 회색 트랙, 하나만 고름, 숫자 포함.
 *
 * 태그 칩(검색창 안, 연한 파랑)과 다른 줄·다른 꼴이라 상태와 키워드가 섞여 읽히지 않는다.
 * 접근성은 라디오 그룹 패턴이다 — 고른 칸만 탭 순서에 들고, 화살표·Home·End 가 고르면서
 * 포커스를 옮긴다(라디오는 옮기는 것이 곧 고르는 것). 좁은 폭에서는 숫자를 화면에서만
 * 숨기고 낭독에는 남긴다.
 */
export function LifecycleSegment({ value, counts, onChange }: LifecycleSegmentProps) {
  const buttonsRef = useRef<(HTMLButtonElement | null)[]>([]);

  function select(index: number) {
    const size = SEGMENTS.length;
    const next = SEGMENTS[(index + size) % size];
    if (!next) return;
    onChange(next.key);
    buttonsRef.current[(index + size) % size]?.focus();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    switch (event.key) {
      case 'ArrowRight':
      case 'ArrowDown':
        event.preventDefault();
        select(index + 1);
        break;
      case 'ArrowLeft':
      case 'ArrowUp':
        event.preventDefault();
        select(index - 1);
        break;
      case 'Home':
        event.preventDefault();
        select(0);
        break;
      case 'End':
        event.preventDefault();
        select(SEGMENTS.length - 1);
        break;
    }
  }

  return (
    <div
      role="radiogroup"
      aria-label="목록 상태"
      className="inline-flex shrink-0 items-center gap-0.5 rounded-[10px] bg-[#F2F2F5] p-[3px]"
    >
      {SEGMENTS.map((segment, index) => {
        const active = value === segment.key;
        return (
          <button
            key={segment.key}
            ref={(el) => {
              buttonsRef.current[index] = el;
            }}
            type="button"
            role="radio"
            aria-checked={active}
            tabIndex={active ? 0 : -1}
            onClick={() => onChange(segment.key)}
            onKeyDown={(event) => handleKeyDown(event, index)}
            className={cn(
              'flex h-[30px] items-center gap-1.5 rounded-[8px] px-3 text-[13px] transition-colors focus-visible:ring-2 focus-visible:ring-[#2E4FCE]/40 focus-visible:outline-none',
              active
                ? 'bg-white font-semibold text-[#1C1C1E] shadow-[0_1px_2px_rgba(0,0,0,0.08)]'
                : 'text-[#6E6E73] hover:text-[#1C1C1E]',
            )}
          >
            <span>{segment.label}</span>{' '}
            <span
              className={cn(
                'tabular-nums max-lg:sr-only',
                active ? 'text-[#6E6E73]' : 'text-[#9CA3AF]',
              )}
            >
              {counts[segment.key]}
            </span>
          </button>
        );
      })}
    </div>
  );
}
