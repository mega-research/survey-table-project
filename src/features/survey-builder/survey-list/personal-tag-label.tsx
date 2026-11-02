import { cn } from '@/lib/utils';
import type { PersonalTagItem } from '@/shared/contracts/workspace-io';

import { PERSONAL_TAG_DOT_CLASS } from './personal-tags';

// 내 태그 한 개의 꼴 — 카드 태그 줄·검색창 칩·자동완성 후보·태그 창이 함께 쓴다(티켓 07·09·10).

/**
 * 걸린 검색 칩과 맞물린 태그의 꼴(티켓 09) — 연한 파랑 바탕. 검색창 안 칩과 카드의 맞물린 태그가
 * 같은 꼴이라 「왜 이 카드가 보이는지」가 이어져 읽힌다. `PersonalTagLabel` 의 className 으로 덮는다.
 */
export const ACTIVE_TAG_LABEL_CLASS = 'bg-[#EAF0FF] text-[#2743AE]';

/**
 * 태그 한 개의 꼴 — 회색 바탕 + 색 점 + 이름(시안 F8 기준, F6 의 색 바탕은 쓰지 않는다).
 * 이름은 텍스트로만 그린다.
 */
export function PersonalTagLabel({
  tag,
  className,
  children,
}: {
  tag: Pick<PersonalTagItem, 'name' | 'color'>;
  className?: string;
  /** 이름 뒤에 붙는 것 — 칩의 × 단추 자리. */
  children?: React.ReactNode;
}) {
  return (
    <span
      className={cn(
        'inline-flex max-w-full min-w-0 items-center gap-1.5 rounded-md bg-[#F2F2F7] px-2 py-0.5 text-[12.5px] leading-5 text-[#3A3A3C]',
        className,
      )}
    >
      <span
        aria-hidden
        className={cn('h-1.5 w-1.5 shrink-0 rounded-full', PERSONAL_TAG_DOT_CLASS[tag.color])}
      />
      <span className="truncate">{tag.name}</span>
      {children}
    </span>
  );
}
