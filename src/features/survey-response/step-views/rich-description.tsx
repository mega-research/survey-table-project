'use client';

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
  return (
    <div
      className={cn(
        // max-md word-break normal: 전역 keep-all(어절 보존)이 좁은 화면의 긴 문단에서
        // 줄 끝 빈 공간을 크게 남겨, 설명 본문은 모바일에서만 글자 단위 줄바꿈을 허용한다.
        'tiptap-mobile-tame prose min-w-0 max-w-none max-md:[word-break:normal] [&_a]:[overflow-wrap:anywhere] [&_p]:break-words',
        '[&_table]:max-w-full [&_table]:table-auto [&_table]:border-collapse [&_table]:border [&_table]:border-gray-200 [&_table_p]:m-0',
        '[&_table_td]:border [&_table_td]:border-gray-200 [&_table_td]:break-words',
        '[&_table_th]:border [&_table_th]:border-gray-200 [&_table_th]:bg-gray-50 [&_table_th]:break-words [&_table_th]:font-semibold',
        size === 'base' ? 'prose-base' : 'prose-sm',
        className,
      )}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
