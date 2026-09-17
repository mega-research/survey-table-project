'use client';

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

/** 목록 하단 페이지네이션 (.pen FLOW 6 페이지네이션 행) — 1페이지뿐이면 그리지 않는다. */
export function ListPagination({ page, totalPages, onPageChange }: ListPaginationProps) {
  if (totalPages <= 1) return null;

  const items = buildPageItems(page, totalPages);

  return (
    <nav className="flex items-center justify-center gap-1.5" aria-label="페이지네이션">
      <button
        type="button"
        disabled={page <= 1}
        onClick={() => onPageChange(page - 1)}
        aria-label="이전 페이지"
        className="flex h-8 w-8 items-center justify-center rounded-[8px] border border-[#E5E5EA] text-[#374151] disabled:opacity-40"
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
              'flex h-8 min-w-8 items-center justify-center rounded-[8px] px-2 text-[13px]',
              item === page
                ? 'bg-[#2E4FCE] font-semibold text-white'
                : 'text-[#374151] hover:bg-[#F5F5F7]',
            )}
          >
            {item}
          </button>
        ),
      )}

      <button
        type="button"
        disabled={page >= totalPages}
        onClick={() => onPageChange(page + 1)}
        aria-label="다음 페이지"
        className="flex h-8 w-8 items-center justify-center rounded-[8px] border border-[#E5E5EA] text-[#374151] disabled:opacity-40"
      >
        <ChevronRight className="h-4 w-4" />
      </button>
    </nav>
  );
}
