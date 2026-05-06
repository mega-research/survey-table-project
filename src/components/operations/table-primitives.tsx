import { numberFormatter } from '@/lib/operations/format';

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
  if (direction === false) {
    return (
      <span aria-hidden="true" className="inline-block w-2 text-transparent">
        ▲
      </span>
    );
  }
  return (
    <span aria-hidden="true" className="text-slate-400">
      {direction === 'asc' ? '▲' : '▼'}
    </span>
  );
}

interface TablePagerFooterProps {
  total: number;
  page: number;
  totalPages: number;
  onPrev: () => void;
  onNext: () => void;
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
}: TablePagerFooterProps) {
  return (
    <div className="mt-3 flex items-center justify-between gap-2 px-1 text-xs text-slate-600">
      <span>
        총 {numberFormatter.format(total)}건 · {page} / {totalPages} 페이지
      </span>
      <div className="flex gap-1">
        <button
          type="button"
          onClick={onPrev}
          disabled={page <= 1}
          className="rounded border border-slate-200 px-2 py-1 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
        >
          ‹ 이전
        </button>
        <button
          type="button"
          onClick={onNext}
          disabled={page >= totalPages}
          className="rounded border border-slate-200 px-2 py-1 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
        >
          다음 ›
        </button>
      </div>
    </div>
  );
}
