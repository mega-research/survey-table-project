'use client';

import type { ReactNode } from 'react';

import { MobileDisplayCells } from '@/components/survey/mobile-display-cells';
import { cn } from '@/lib/utils';
import type { TableCell } from '@/types/survey';

export interface MobileOptionCardProps {
  /** 카드 헤더 라벨 */
  label: ReactNode;
  /** 행의 전체 셀 — 표시 셀(text/image/video)만 자동 추출해 렌더 */
  cells: TableCell[];
  /** 선택/입력 컨트롤 슬롯 (체크박스/라디오 등). 클릭은 onToggle 로 전파되지 않음 */
  control?: ReactNode;
  /** 표시 셀 아래 추가 영역 (예: 사이드카 텍스트 입력) */
  footer?: ReactNode;
  selected?: boolean;
  disabled?: boolean;
  /** 헤더 줄 탭 시 호출 (Case A 선택 토글). 미지정이면 헤더는 비인터랙티브 */
  onToggle?: () => void;
}

export function MobileOptionCard({
  label,
  cells,
  control,
  footer,
  selected,
  disabled,
  onToggle,
}: MobileOptionCardProps) {
  const interactive = Boolean(onToggle) && !disabled;
  return (
    <div
      className={cn(
        'rounded-2xl border bg-white p-4 transition-all',
        selected ? 'border-blue-500 ring-2 ring-blue-500/15' : 'border-gray-200',
        disabled && 'opacity-50',
      )}
    >
      <div
        className={cn('flex items-center gap-3', interactive && 'cursor-pointer')}
        onClick={interactive ? onToggle : undefined}
      >
        {control != null && (
          <span onClick={(e) => e.stopPropagation()} className="flex shrink-0 items-center">
            {control}
          </span>
        )}
        <div className="min-w-0 flex-1 whitespace-pre-line text-[15px] font-semibold leading-snug text-gray-900">
          {label}
        </div>
      </div>
      <MobileDisplayCells cells={cells} className="mt-2" />
      {footer != null && <div className="mt-2">{footer}</div>}
    </div>
  );
}
