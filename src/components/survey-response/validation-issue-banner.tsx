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

/** 배너 톤 — 기본 red(응답자 흐름 차단형 에러)와 admin-edit 전용 amber(빈 필수 완화 경고). */
export type ValidationBannerTone = 'red' | 'amber';

const TONE_CLASSES: Record<
  ValidationBannerTone,
  { container: string; button: string }
> = {
  red: {
    container: 'border-red-200 bg-red-50 text-red-700',
    button: 'border-red-300 bg-white text-red-600 hover:bg-red-100',
  },
  amber: {
    container: 'border-amber-300 bg-amber-50 text-amber-900',
    button: 'border-amber-300 bg-white text-amber-700 hover:bg-amber-100',
  },
};

export function ValidationIssueBanner({
  items,
  questionId,
  onNavigate,
  tone = 'red',
}: {
  items?: ValidationBannerItem[] | undefined;
  questionId?: string | undefined;
  onNavigate?: ((item: ValidationBannerItem) => void) | undefined;
  /** admin-edit 빈 필수 완화 경고는 'amber' — 응답자 흐름 차단형 배너는 기본값(red) 그대로. */
  tone?: ValidationBannerTone;
}) {
  if (!items || items.length === 0) return null;
  const toneClasses = TONE_CLASSES[tone];

  return (
    <div
      role="alert"
      className={`mt-2 space-y-1 rounded-md border px-3 py-2 text-sm ${toneClasses.container}`}
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
                className={`shrink-0 rounded border px-2 py-0.5 text-xs font-medium transition-colors ${toneClasses.button}`}
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
