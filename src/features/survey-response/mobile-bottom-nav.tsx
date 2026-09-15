'use client';

import { ChevronLeft, ChevronRight } from 'lucide-react';

interface MobileBottomNavProps {
  keyboardOpen: boolean;
  currentStepNumber: number;
  totalStepCount: number;
  hasPrevious: boolean;
  isLastStep: boolean;
  isSubmitting: boolean;
  submitLabel?: string;
  submittingLabel?: string;
  onPrevious: () => void;
  onNext: () => void;
}

const primaryButtonCls =
  'flex items-center gap-1 rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-blue-700 active:scale-[0.98] disabled:pointer-events-none disabled:bg-gray-200 disabled:text-gray-400';

/**
 * 모바일 고정 하단 네비게이션 바.
 *
 * - 모든 스텝 종류 공통 (그룹형·테이블 모두 동일 동작).
 * - 키보드 열리면 DOM 유지한 채 `translate-y-full`로 슬라이드 다운 → 상태 오판되어도 즉시 복귀.
 * - MobileTableStepper의 row 내부 네비와 병존 (행 이동 vs 스텝 이동 역할 분리).
 */
export function MobileBottomNav({
  keyboardOpen,
  currentStepNumber,
  totalStepCount,
  hasPrevious,
  isLastStep,
  isSubmitting,
  submitLabel = '다음',
  submittingLabel = '처리 중...',
  onPrevious,
  onNext,
}: MobileBottomNavProps) {
  return (
    <div
      className={`fixed inset-x-0 bottom-0 z-50 border-t border-gray-200 bg-white shadow-[0_-2px_10px_rgba(0,0,0,0.05)] transition-transform duration-200 md:hidden ${
        keyboardOpen ? 'translate-y-full' : 'translate-y-0'
      }`}
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      <div className="flex items-center justify-between px-4 py-3">
        <button
          onClick={onPrevious}
          disabled={!hasPrevious}
          className="flex items-center gap-1 rounded-lg px-4 py-2.5 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-100 active:scale-[0.98] disabled:pointer-events-none disabled:text-gray-300"
        >
          <ChevronLeft className="h-4 w-4" />
          이전
        </button>

        {/* 쪽수만 — 필수 미충족 안내는 문항 아래 검증 안내가 맡는다(하단 바의 「필수 질문」
            소표시는 2026-09-15 에 뺐다: 어느 문항인지 알려주지 않는 중복 신호였다). */}
        <span className="text-sm font-medium text-gray-900">
          {currentStepNumber || 1} / {Math.max(totalStepCount, 1)}
        </span>

        {isLastStep ? (
          <button onClick={onNext} disabled={isSubmitting} className={primaryButtonCls}>
            {isSubmitting ? submittingLabel : submitLabel}
            {!isSubmitting && <ChevronRight className="h-4 w-4" />}
          </button>
        ) : (
          <button onClick={onNext} disabled={isSubmitting} className={primaryButtonCls}>
            다음
            <ChevronRight className="h-4 w-4" />
          </button>
        )}
      </div>
    </div>
  );
}
