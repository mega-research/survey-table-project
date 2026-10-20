import { numberFormatter } from '@/features/operations/format';

import {
  PAGER_ELLIPSIS_CLASS,
  PAGER_ITEM_CLASS,
  PAGER_ITEM_CURRENT_CLASS,
} from './pager-classes';
import { PagerJump } from './pager-jump';

export type CellAlign = 'left' | 'right' | 'center';

export const ALIGN_CLASS: Record<CellAlign, string> = {
  left: 'text-left',
  right: 'text-right',
  center: 'text-center',
};

interface SortIndicatorProps {
  direction: false | 'asc' | 'desc';
}

/**
 * 활성 컬럼에만 ▲/▼ 화살표 노출. 비활성 컬럼은 동일 폭의 투명 자리표시자로
 * 헤더 텍스트가 흔들리지 않도록 한다.
 */
export function SortIndicator({ direction }: SortIndicatorProps) {
  // 비활성 시 미렌더 — 투명 placeholder 로 공간을 예약하지 않고,
  // 정렬 활성 시에만 생성되어 라벨을 자연스럽게 밀어낸다.
  if (direction === false) return null;
  return (
    <span aria-hidden="true" className="text-slate-500">
      {direction === 'asc' ? '▲' : '▼'}
    </span>
  );
}

/** 번호형 페이지네이션이 한 번에 보이는 페이지 묶음 크기. */
export const PAGE_BLOCK_SIZE = 10;

/**
 * 번호형 페이지네이션에 노출할 페이지 목록 계산 — 10개 묶음 단위.
 * 현재 페이지가 속한 묶음(1~10, 11~20, …)을 통째로 보이고, 맨 앞(1)과 맨 뒤(마지막)는
 * 묶음 밖이어도 남긴다. 묶음 안에서 페이지를 옮겨도 번호 줄이 그대로라 덜 움직인다.
 * 예) 16페이지 중 7 → [1..10, …, 16] · 12 → [1, …, 11..16]
 * 서버/클라이언트 컴포넌트 공용 (링크 기반 페이저에서도 import).
 */
export function buildPageItems(page: number, totalPages: number): Array<number | 'ellipsis'> {
  if (totalPages <= PAGE_BLOCK_SIZE) {
    return Array.from({ length: totalPages }, (_, i) => i + 1);
  }
  const current = Math.min(Math.max(1, page), totalPages);
  const start = Math.floor((current - 1) / PAGE_BLOCK_SIZE) * PAGE_BLOCK_SIZE + 1;
  const end = Math.min(start + PAGE_BLOCK_SIZE - 1, totalPages);
  const items: Array<number | 'ellipsis'> = [];
  if (start > 1) {
    items.push(1);
    if (start > 2) items.push('ellipsis');
  }
  for (let i = start; i <= end; i += 1) items.push(i);
  if (end < totalPages) {
    if (end < totalPages - 1) items.push('ellipsis');
    items.push(totalPages);
  }
  return items;
}

/**
 * 이전·다음 버튼이 가는 페이지 — 한 페이지씩이 아니라 묶음 단위로 넘긴다.
 * 다음 = 다음 묶음의 첫 페이지(11, 21 …), 이전 = 이전 묶음의 마지막 페이지(10, 20 …).
 * 갈 묶음이 없으면 null(버튼 비활성) — 전체가 한 묶음이면 둘 다 null.
 */
export function pageBlockNavTargets(
  page: number,
  totalPages: number,
): { prev: number | null; next: number | null } {
  const current = Math.min(Math.max(1, page), Math.max(1, totalPages));
  const start = Math.floor((current - 1) / PAGE_BLOCK_SIZE) * PAGE_BLOCK_SIZE + 1;
  const end = Math.min(start + PAGE_BLOCK_SIZE - 1, totalPages);
  return { prev: start > 1 ? start - 1 : null, next: end < totalPages ? end + 1 : null };
}


interface TablePagerFooterProps {
  total: number;
  page: number;
  totalPages: number;
  /** 페이지 이동 — 번호 버튼·묶음 단위 이전/다음·페이지 입력이 모두 이것으로 간다. */
  onPage: (page: number) => void;
}

/**
 * 운영 콘솔 표 공통 페이지네이션 푸터.
 * server-driven (page/totalPages props) 와 client-driven (TanStack 콜백)
 * 모두 동일 시그니처로 사용 가능.
 */
export function TablePagerFooter({
  total,
  page,
  totalPages,
  onPage,
}: TablePagerFooterProps) {
  const nav = pageBlockNavTargets(page, totalPages);
  return (
    <div className="mt-3 flex items-center justify-between gap-2 px-1 text-sm text-slate-600">
      <span>
        총 {numberFormatter.format(total)}건 · {page} / {totalPages} 페이지
      </span>
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => nav.prev !== null && onPage(nav.prev)}
          disabled={nav.prev === null}
          className={PAGER_ITEM_CLASS}
        >
          ‹ 이전
        </button>
        {buildPageItems(page, totalPages).map((item, i) =>
              item === 'ellipsis' ? (
                <span key={`ellipsis-${i}`} className={PAGER_ELLIPSIS_CLASS}>
                  …
                </span>
              ) : (
                <button
                  key={item}
                  type="button"
                  onClick={() => onPage(item)}
                  disabled={item === page}
                  aria-current={item === page ? 'page' : undefined}
                  className={item === page ? PAGER_ITEM_CURRENT_CLASS : PAGER_ITEM_CLASS}
                >
                  {item}
                </button>
              ),
        )}
        <button
          type="button"
          onClick={() => nav.next !== null && onPage(nav.next)}
          disabled={nav.next === null}
          className={PAGER_ITEM_CLASS}
        >
          다음 ›
        </button>
        <PagerJump totalPages={totalPages} onJump={onPage} />
      </div>
    </div>
  );
}
