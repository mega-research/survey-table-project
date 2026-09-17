'use client';

import { useState } from 'react';

import { ChevronLeft, ChevronRight } from 'lucide-react';

import { cn } from '@/lib/utils';

interface ListPaginationProps {
  page: number;
  totalPages: number;
  onPageChange: (page: number) => void;
}

const MAX_VISIBLE_PAGES = 7;

/** 페이지 번호 배열 생성 — 최대 7개, 넘치면 앞/뒤 생략(ellipsis)을 끼워 넣는다. */
export function buildPageItems(page: number, totalPages: number): (number | 'ellipsis')[] {
  if (totalPages <= MAX_VISIBLE_PAGES) {
    return Array.from({ length: totalPages }, (_, i) => i + 1);
  }

  const items = new Set<number>([1, totalPages, page, page - 1, page + 1]);
  const sorted = Array.from(items)
    .filter((p) => p >= 1 && p <= totalPages)
    .sort((a, b) => a - b);

  const result: (number | 'ellipsis')[] = [];
  for (let i = 0; i < sorted.length; i++) {
    const current = sorted[i]!;
    if (i > 0 && current - sorted[i - 1]! > 1) {
      result.push('ellipsis');
    }
    result.push(current);
  }
  return result;
}

/**
 * 번호 입력 이동 — 입력값을 이동할 페이지로 바꾼다.
 *
 * 정수가 아니면 null(이동 안 함). 범위를 넘는 값은 끝으로 접는다 — 「100」을 넣었는데 아무 일도
 * 안 일어나는 것보다 마지막 페이지로 가는 편이 사용자가 원한 방향이다.
 */
export function parsePageJump(raw: string, totalPages: number): number | null {
  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  return Math.min(Math.max(Number(trimmed), 1), Math.max(totalPages, 1));
}

const PAGE_BOX = 'flex h-[34px] min-w-[34px] items-center justify-center rounded-[8px] text-[13px]';

/**
 * 목록 하단 페이지네이션 (.pen FLOW 6 페이지네이션 행).
 *
 * 1페이지뿐이어도 그린다 — 목록이 어디서 끝나는지와 페이지가 몇 개인지를 늘 같은 자리에서
 * 알려준다(목업이 그렇게 그린다). 그때 이전·다음은 비활성이다.
 */
export function ListPagination({ page, totalPages, onPageChange }: ListPaginationProps) {
  const pages = Math.max(totalPages, 1);
  const items = buildPageItems(page, pages);
  const [jump, setJump] = useState('');

  const submitJump = () => {
    const target = parsePageJump(jump, pages);
    setJump('');
    if (target !== null && target !== page) onPageChange(target);
  };

  return (
    <nav className="flex items-center justify-center gap-1.5 pt-2" aria-label="페이지네이션">
      <button
        type="button"
        disabled={page <= 1}
        onClick={() => onPageChange(page - 1)}
        aria-label="이전 페이지"
        className={cn(PAGE_BOX, 'border border-[#E5E5EA] bg-white text-[#374151] disabled:opacity-40')}
      >
        <ChevronLeft className="h-4 w-4" />
      </button>

      {items.map((item, idx) =>
        item === 'ellipsis' ? (
          <span key={`ellipsis-${idx}`} className="px-1 text-[13px] text-[#9CA3AF]">
            …
          </span>
        ) : (
          <button
            key={item}
            type="button"
            onClick={() => onPageChange(item)}
            aria-current={item === page ? 'page' : undefined}
            className={cn(
              PAGE_BOX,
              'px-2',
              item === page
                ? 'bg-[#2E4FCE] font-semibold text-white'
                : 'border border-[#E5E5EA] bg-white text-[#374151] hover:bg-[#F5F5F7]',
            )}
          >
            {item}
          </button>
        ),
      )}

      <button
        type="button"
        disabled={page >= pages}
        onClick={() => onPageChange(page + 1)}
        aria-label="다음 페이지"
        className={cn(PAGE_BOX, 'border border-[#E5E5EA] bg-white text-[#374151] disabled:opacity-40')}
      >
        <ChevronRight className="h-4 w-4" />
      </button>

      <form
        className="ml-3 flex items-center gap-1.5 text-[13px] text-[#6E6E73]"
        onSubmit={(event) => {
          event.preventDefault();
          submitJump();
        }}
      >
        <input
          type="text"
          inputMode="numeric"
          value={jump}
          onChange={(event) => setJump(event.target.value)}
          placeholder={String(page)}
          aria-label="이동할 페이지"
          className="h-[34px] w-12 rounded-[8px] border border-[#E5E5EA] bg-white px-2 text-center text-[13px] text-[#1C1C1E] outline-none focus:border-[#2E4FCE]"
        />
        <span>/ {pages}</span>
        <button
          type="submit"
          disabled={pages <= 1}
          className={cn(
            PAGE_BOX,
            'border border-[#E5E5EA] bg-white px-2.5 text-[#374151] hover:bg-[#F5F5F7] disabled:opacity-40',
          )}
        >
          이동
        </button>
      </form>
    </nav>
  );
}
