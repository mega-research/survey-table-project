'use client';

import { useState } from 'react';

import { ChevronDown } from 'lucide-react';

import { useAnswerQuotes, useContactAttrs } from '@/lib/survey/contact-attrs-context';
import { substituteTokens } from '@/lib/survey/substitute-tokens';
import { cn } from '@/lib/utils';
import type { TableCell } from '@/types/survey';
import { getCellTextClassName, getCellTextStyle } from '@/utils/cell-style';
import { splitMobileDisplayCells } from '@/components/question-renderer/utils/mobile-display-cells';

/** text/image/video 표시 셀 1개의 읽기 전용 콘텐츠 */
function DisplayCellContent({ cell }: { cell: TableCell }) {
  const attrs = useContactAttrs();
  const quotes = useAnswerQuotes();

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
    <div
      className={cn(
        'whitespace-pre-wrap text-sm leading-relaxed text-gray-600 [overflow-wrap:anywhere]',
        getCellTextClassName(cell),
      )}
      style={getCellTextStyle(cell)}
    >
      {substituteTokens(text, attrs, quotes)}
    </div>
  );
}

/** mobileDisplay 에 따라 inline 은 바로, collapsed 는 "자세히" 접기 안에 렌더 */
export function MobileDisplayCells({
  cells,
  className,
}: {
  cells: TableCell[];
  className?: string;
}) {
  const { inline, collapsed } = splitMobileDisplayCells(cells);
  const [open, setOpen] = useState(false);

  if (inline.length === 0 && collapsed.length === 0) return null;

  return (
    <div className={cn('space-y-2', className)}>
      {inline.map((cell) => (
        <DisplayCellContent key={cell.id} cell={cell} />
      ))}
      {collapsed.length > 0 && (
        <div>
          <button
            type="button"
            aria-expanded={open}
            onClick={() => setOpen((value) => !value)}
            className="inline-flex items-center gap-1 text-sm font-medium text-gray-500 transition-colors hover:text-gray-700"
          >
            자세히
            <ChevronDown className={cn('h-4 w-4 transition-transform', open && 'rotate-180')} />
          </button>
          {open && (
            <div className="mt-2 space-y-2 rounded-lg border border-gray-100 bg-gray-50 p-3">
              {collapsed.map((cell) => (
                <DisplayCellContent key={cell.id} cell={cell} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
