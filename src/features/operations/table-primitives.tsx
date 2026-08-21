import { numberFormatter } from '@/features/operations/format';

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

/**
 * 번호형 페이지네이션에 노출할 페이지 목록 계산.
 * 전체가 7페이지 이하면 전부, 초과 시 [1, …, 현재±2, …, 마지막] 윈도우.
 * 서버/클라이언트 컴포넌트 공용 (링크 기반 페이저에서도 import).
 */
export function buildPageItems(page: number, totalPages: number): Array<number | 'ellipsis'> {
  if (totalPages <= 7) {
    return Array.from({ length: totalPages }, (_, i) => i + 1);
  }
  const start = Math.max(2, page - 2);
  const end = Math.min(totalPages - 1, page + 2);
  const items: Array<number | 'ellipsis'> = [1];
  if (start > 2) items.push('ellipsis');
  for (let i = start; i <= end; i += 1) items.push(i);
  if (end < totalPages - 1) items.push('ellipsis');
  items.push(totalPages);
  return items;
}

interface TablePagerFooterProps {
  total: number;
  page: number;
  totalPages: number;
  onPrev: () => void;
  onNext: () => void;
  /** 페이지 번호 직접 이동. 전달 시 이전/다음 사이에 번호 버튼 노출. */
  onPage?: (page: number) => void;
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
  onPrev,
  onNext,
  onPage,
}: TablePagerFooterProps) {
  return (
    <div className="mt-3 flex items-center justify-between gap-2 px-1 text-xs text-slate-600">
      <span>
        총 {numberFormatter.format(total)}건 · {page} / {totalPages} 페이지
      </span>
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={onPrev}
          disabled={page <= 1}
          className="rounded border border-slate-200 px-2 py-1 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
        >
          ‹ 이전
        </button>
        {onPage
          ? buildPageItems(page, totalPages).map((item, i) =>
              item === 'ellipsis' ? (
                <span key={`ellipsis-${i}`} className="px-1 text-slate-400">
                  …
                </span>
              ) : (
                <button
                  key={item}
                  type="button"
                  onClick={() => onPage(item)}
                  disabled={item === page}
                  aria-current={item === page ? 'page' : undefined}
                  className={
                    item === page
                      ? 'rounded border border-blue-500 bg-blue-500 px-2 py-1 font-medium text-white'
                      : 'rounded border border-slate-200 px-2 py-1 tabular-nums hover:bg-slate-50'
                  }
                >
                  {item}
                </button>
              ),
            )
          : null}
        <button
          type="button"
          onClick={onNext}
          disabled={page >= totalPages}
          className="rounded border border-slate-200 px-2 py-1 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
        >
          다음 ›
        </button>
        {onPage ? <PagerJump totalPages={totalPages} onJump={onPage} /> : null}
      </div>
    </div>
  );
}
