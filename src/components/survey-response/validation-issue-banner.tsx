'use client';

import { scrollToIssue } from './scroll-to-issue';

export interface ValidationBannerItem {
  message: string;
  /** 데스크톱에서만 메시지 앞에 표시할 행 라벨 */
  labelPrefix?: string | undefined;
  rowId?: string | undefined;
  cellIds?: string[] | undefined;
  detailTargetIds?: string[] | undefined;
}

export function ValidationIssueBanner({
  items,
  questionId,
  onNavigate,
}: {
  items?: ValidationBannerItem[] | undefined;
  questionId?: string | undefined;
  onNavigate?: ((item: ValidationBannerItem) => void) | undefined;
}) {
  if (!items || items.length === 0) return null;

  return (
    <div
      role="alert"
      className="mt-2 space-y-1 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
    >
      {items.map((item, index) => {
        const canNavigate =
          (item.detailTargetIds?.length ?? 0) > 0 ||
          (item.cellIds?.length ?? 0) > 0 ||
          Boolean(questionId);
        return (
          <div key={index} className="flex items-center justify-between gap-3">
            <p className="min-w-0">
              {item.labelPrefix && (
                <span className="hidden md:inline">{item.labelPrefix}: </span>
              )}
              <span>{item.message}</span>
            </p>
            {canNavigate && (
              <button
                type="button"
                onClick={() => {
                  if (onNavigate) {
                    onNavigate(item);
                    return;
                  }
                  scrollToIssue({
                    detailTargetIds: item.detailTargetIds,
                    cellIds: item.cellIds,
                    questionId,
                  });
                }}
                className="shrink-0 rounded border border-red-300 bg-white px-2 py-0.5 text-xs font-medium text-red-600 transition-colors hover:bg-red-100"
              >
                위치로 이동
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
