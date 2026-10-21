'use client';

import { useState } from 'react';

import { ChevronDown } from 'lucide-react';

import { CellText, resolveCellTextHtml } from './cell-text';
import { EnlargeableImage } from './enlargeable-image';
import { useImageEnlargeTitle } from './image-enlarge-labels';
import { useAnswerQuotes, useContactAttrs } from '@/features/question-renderer/contact-attrs-context';
import { substituteTokens } from '@/lib/survey/substitute-tokens';
import { cn } from '@/lib/utils';
import type { TableCell } from '@/types/survey';
import { getCellTextClassName, getCellTextStyle } from '@/utils/cell-style';
import { splitMobileDisplayCells } from '@/features/question-renderer/utils/split-display-cells';

/** text/image/video 표시 셀 1개의 읽기 전용 콘텐츠 */
export function DisplayCellContent({ cell }: { cell: TableCell }) {
  const attrs = useContactAttrs();
  const quotes = useAnswerQuotes();
  const enlargeTitle = useImageEnlargeTitle(cell.id);

  if (cell.type === 'image' && cell.imageUrl) {
    return (
      <EnlargeableImage
        key={cell.imageUrl}
        src={cell.imageUrl}
        alt=""
        fit="contain"
        className="max-w-full rounded-md"
        title={enlargeTitle}
        subtitle={substituteTokens(cell.content ?? '', attrs, quotes).trim() || undefined}
      />
    );
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
        // body 의 keep-all(어절 단위 줄바꿈) 상속을 끊는다 — 좁은 카드에서 긴 어절이 통째로
        // 다음 줄로 넘어가 줄 끝이 크게 비던 것을 글자 단위로 채운다.
        'whitespace-pre-wrap text-sm leading-relaxed [word-break:normal] text-gray-600 [overflow-wrap:anywhere]',
        getCellTextClassName(cell),
      )}
      style={getCellTextStyle(cell)}
    >
      <CellText
        text={substituteTokens(text, attrs, quotes)}
        html={resolveCellTextHtml(cell, attrs, quotes)}
        boldFirstLine={cell.boldFirstLine}
      />
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
