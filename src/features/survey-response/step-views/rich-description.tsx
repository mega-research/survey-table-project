'use client';

import { useMemo, useRef } from 'react';

import {
  RICH_TEXT_ENLARGE_CLASS,
  useRichTextImageEnlarge,
} from '@/features/question-renderer/rich-text-image-enlarge';
import { cn } from '@/lib/utils';

/**
 * TipTap이 출력한 sanitized HTML을 prose 스타일로 렌더.
 * 모바일 표 길들이기는 globals.css의 `.tiptap-mobile-tame`이 담당하므로
 * 여기선 데스크탑용 prose + 표 외형만 정의한다.
 */
export function RichDescription({
  html,
  size = 'sm',
  className,
}: {
  html: string;
  size?: 'sm' | 'base';
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const imageEnlarge = useRichTextImageEnlarge(ref, html);
  // 본문 객체를 고정한다 — 새 객체면 React 가 다시 그릴 때마다 본문을 통째로 다시 넣어, 크게 보기
  // 표식을 붙인 이미지가 표식 없는 새 이미지로 바뀐다(돋보기 자리·크게 보기 상태가 바뀌어도 다시 그린다)
  const innerHtml = useMemo(() => ({ __html: html }), [html]);
  return (
    <>
      <div className="relative">
        <div
          ref={ref}
          {...imageEnlarge.enlargeProps}
          className={cn(
            // max-md word-break normal: 전역 keep-all(어절 보존)이 좁은 화면의 긴 문단에서
            // 줄 끝 빈 공간을 크게 남겨, 설명 본문은 모바일에서만 글자 단위 줄바꿈을 허용한다.
            'tiptap-mobile-tame prose max-w-none min-w-0 max-md:[word-break:normal] [&_a]:[overflow-wrap:anywhere] [&_p]:break-words',
            '[&_table]:max-w-full [&_table]:table-auto [&_table]:border-collapse [&_table]:border [&_table]:border-gray-200 [&_table_p]:m-0',
            '[&_table_td]:border [&_table_td]:border-gray-200 [&_table_td]:break-words',
            '[&_table_th]:border [&_table_th]:border-gray-200 [&_table_th]:bg-gray-50 [&_table_th]:font-semibold [&_table_th]:break-words',
            size === 'base' ? 'prose-base' : 'prose-sm',
            RICH_TEXT_ENLARGE_CLASS,
            className,
          )}
          dangerouslySetInnerHTML={innerHtml}
        />
        {imageEnlarge.badges}
      </div>
      {imageEnlarge.overlay}
    </>
  );
}
