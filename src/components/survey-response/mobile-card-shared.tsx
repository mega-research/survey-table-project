'use client';

import React, { useState } from 'react';

import { ChevronDown } from 'lucide-react';

import { useContactAttrs } from '@/lib/survey/contact-attrs-context';
import { substituteTokens } from '@/lib/survey/substitute-tokens';
import { cn } from '@/lib/utils';
import type { TableCell } from '@/types/survey';
import { splitMobileDisplayCells } from '@/utils/mobile-display-cells';

/** text/image/video 표시 셀 1개의 읽기 전용 콘텐츠 */
function DisplayCellContent({ cell }: { cell: TableCell }) {
  const attrs = useContactAttrs();
  if (cell.type === 'image' && cell.imageUrl) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={cell.imageUrl} alt="" className="max-w-full rounded-md" />;
  }
  if (cell.type === 'video' && cell.videoUrl) {
    return (
      <a
        href={cell.videoUrl}
        target="_blank"
        rel="noreferrer"
        className="text-sm font-medium text-blue-600 underline"
      >
        동영상 보기
      </a>
    );
  }
  const text = (cell.content ?? '').trim();
  if (!text) return null;
  return (
    <div className="whitespace-pre-wrap text-sm leading-relaxed text-gray-600 [overflow-wrap:anywhere]">
      {substituteTokens(text, attrs)}
    </div>
  );
}

/** mobileDisplay 에 따라 inline 은 바로, collapsed 는 "자세히" 접기 안에 렌더 */
export function MobileDisplayCells({ cells, className }: { cells: TableCell[]; className?: string }) {
  const { inline, collapsed } = splitMobileDisplayCells(cells);
  const [open, setOpen] = useState(false);

  if (inline.length === 0 && collapsed.length === 0) return null;

  return (
    <div className={cn('space-y-2', className)}>
      {inline.map((c) => (
        <DisplayCellContent key={c.id} cell={c} />
      ))}
      {collapsed.length > 0 && (
        <div>
          <button
            type="button"
            aria-expanded={open}
            onClick={() => setOpen((v) => !v)}
            className="inline-flex items-center gap-1 text-sm font-medium text-gray-500 transition-colors hover:text-gray-700"
          >
            자세히
            <ChevronDown className={cn('h-4 w-4 transition-transform', open && 'rotate-180')} />
          </button>
          {open && (
            <div className="mt-2 space-y-2 rounded-lg border border-gray-100 bg-gray-50 p-3">
              {collapsed.map((c) => (
                <DisplayCellContent key={c.id} cell={c} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export interface MobileOptionCardProps {
  /** 카드 헤더 라벨 */
  label: React.ReactNode;
  /** 행의 전체 셀 — 표시 셀(text/image/video)만 자동 추출해 렌더 */
  cells: TableCell[];
  /** 선택/입력 컨트롤 슬롯 (체크박스/라디오 등). 클릭은 onToggle 로 전파되지 않음 */
  control?: React.ReactNode;
  /** 표시 셀 아래 추가 영역 (예: 사이드카 텍스트 입력) */
  footer?: React.ReactNode;
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
        <div className="min-w-0 flex-1 text-[15px] font-semibold leading-snug text-gray-900">
          {label}
        </div>
      </div>
      <MobileDisplayCells cells={cells} className="mt-2" />
      {footer != null && <div className="mt-2">{footer}</div>}
    </div>
  );
}
