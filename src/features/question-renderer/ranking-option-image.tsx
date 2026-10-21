'use client';

import {
  useAnswerQuotes,
  useContactAttrs,
} from '@/features/question-renderer/contact-attrs-context';
import { substituteTokens } from '@/lib/survey/substitute-tokens';
import { cn } from '@/lib/utils';
import type { TableCell } from '@/types/survey';
import { buildRankingOptLabel } from '@/utils/ranking-source';

import { EnlargeableImage } from './enlargeable-image';
import { useTableImageEnlarge } from './table-image-enlarge';

/**
 * 순위형 보기(ranking_opt 셀)의 이미지 — 높이 띠에 잘라 채워 그리고, 잘려 보이면 돋보기 버튼으로
 * 크게 본다(CONTEXT.md 「이미지 크게 보기」). 이미지 누르기는 클릭 방식에서 순위 지정이라 입력 방식과
 * 무관하게 돋보기로만 연다. 머리 줄은 보기 라벨이다.
 */
export function RankingOptionImage({ cell, className }: { cell: TableCell; className: string }) {
  const attrs = useContactAttrs();
  const quotes = useAnswerQuotes();
  const enlarge = useTableImageEnlarge(cell.id);
  if (!cell.imageUrl) return null;
  // 대체 텍스트·머리 줄 모두 보기 라벨(토큰 치환 후)이다
  const label = substituteTokens(buildRankingOptLabel(cell, ''), attrs, quotes);
  return (
    <EnlargeableImage
      key={cell.imageUrl}
      src={cell.imageUrl}
      alt={label || '순위 옵션 이미지'}
      enabled={enlarge !== null}
      fit="cover"
      trigger="button"
      wrapperClassName="w-full"
      className={cn('w-full rounded object-cover', className)}
      title={label || undefined}
    />
  );
}
