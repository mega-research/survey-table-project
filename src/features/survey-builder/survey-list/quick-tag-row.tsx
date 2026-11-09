'use client';

import { useLayoutEffect, useRef, useState } from 'react';

import { cn } from '@/lib/utils';
import type { PersonalTagItem } from '@/shared/contracts/workspace-io';

import { ACTIVE_TAG_LABEL_CLASS, PersonalTagLabel } from './personal-tag-label';
import { resolveQuickTags } from './personal-tags';

/**
 * 툴바 둘째 줄의 「자주 쓰는 태그」 — 많이 쓴 순으로 한 줄. 누르면 검색 칩으로 걸리고 다시 누르면 풀린다
 * (「# 태그 ▾」 목록의 체크와 같은 조작이다). 걸린 태그는 검색창 칩과 같은 연한 파랑이다.
 *
 * 한 줄을 넘기지 않는다 — 칩은 줄바꿈되게 두고 높이를 한 줄로 자른 뒤, 둘째 줄로 밀려난 칩은 재어서
 * 키보드·읽기에서도 뺀다(잘려 안 보이는 칩에 포커스가 가면 안 된다). 폭이 바뀌면 다시 잰다.
 */
export function QuickTagRow({
  tags,
  selectedIds,
  onToggle,
}: {
  tags: readonly PersonalTagItem[];
  selectedIds: readonly string[];
  onToggle: (tagId: string, on: boolean) => void;
}) {
  const quick = resolveQuickTags(tags);
  const selected = new Set(selectedIds);
  const rowRef = useRef<HTMLDivElement>(null);
  const [overflowFrom, setOverflowFrom] = useState<number | null>(null);
  const quickKey = quick.map((t) => t.id).join(',');

  useLayoutEffect(() => {
    const row = rowRef.current;
    if (!row) return;
    const measure = () => {
      const items = Array.from(row.children) as HTMLElement[];
      const firstTop = items[0]?.offsetTop ?? 0;
      const index = items.findIndex((el) => el.offsetTop > firstTop);
      setOverflowFrom(index === -1 ? null : index);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(row);
    return () => observer.disconnect();
  }, [quickKey]);

  if (quick.length === 0) return null;

  return (
    <div
      ref={rowRef}
      role="group"
      aria-label="자주 쓰는 태그"
      className="flex h-8 min-w-0 flex-1 flex-wrap items-center gap-1.5 overflow-hidden py-1"
    >
      {quick.map((t, i) => {
        const on = selected.has(t.id);
        const hidden = overflowFrom !== null && i >= overflowFrom;
        return (
          <button
            key={t.id}
            type="button"
            aria-pressed={on}
            aria-hidden={hidden || undefined}
            tabIndex={hidden ? -1 : undefined}
            title={on ? `「${t.name}」 거르기 풀기` : `「${t.name}」 태그로 거르기`}
            onClick={() => onToggle(t.id, !on)}
            className={cn(
              'flex h-6 max-w-[180px] min-w-0 rounded-md focus-visible:ring-2 focus-visible:ring-[#2E4FCE]/40 focus-visible:outline-none',
              hidden && 'invisible',
            )}
          >
            <PersonalTagLabel
              tag={t}
              className={cn(
                'min-w-0',
                on ? ACTIVE_TAG_LABEL_CLASS : 'hover:bg-[#E5E5EA] hover:text-[#1C1C1E]',
              )}
            />
          </button>
        );
      })}
    </div>
  );
}
