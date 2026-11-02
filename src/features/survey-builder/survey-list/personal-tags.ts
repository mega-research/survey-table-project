import {
  type PersonalTagColor,
  isPersonalTagLimitReached,
  normalizePersonalTagName,
  personalTagNameKey,
} from '@/shared/contracts/workspace';
import type { PersonalTagItem } from '@/shared/contracts/workspace-io';

// 내 태그 표시 규칙 (설문 즐겨찾기·태그 티켓 07) — 카드 태그 줄과 태그 창이 쓰는 순수 함수.
// 이름 정규화·한도는 서버와 같은 계약 함수(`shared/contracts/workspace`)를 쓴다.

/** 카드에 보이는 태그 수 — 넘치면 「+N」. */
export const CARD_TAG_LIMIT = 2;

/**
 * 태그 점 색 — 카드·태그 창의 태그는 회색 바탕 + 이 색의 점이다(색 바탕이 아니다). 태그가
 * 수십 개면 8색이 겹쳐 뜻이 약해지고, 공개·종료 같은 상태 배지(알약 + 아이콘)와 꼴로 갈려야 한다.
 */
export const PERSONAL_TAG_DOT_CLASS: Record<PersonalTagColor, string> = {
  blue: 'bg-[#3B82F6]',
  red: 'bg-[#EF4444]',
  green: 'bg-[#22C55E]',
  purple: 'bg-[#8B5CF6]',
  amber: 'bg-[#F59E0B]',
  teal: 'bg-[#14B8A6]',
  pink: 'bg-[#EC4899]',
  gray: 'bg-[#9CA3AF]',
};

/**
 * 카드 태그 줄 — 붙인 순서대로 앞의 `CARD_TAG_LIMIT` 개를 보이고 나머지는 센다. 내 태그 목록에
 * 없는 id(다른 탭에서 지운 태그 등)는 건너뛴다.
 *
 * 걸린 검색 칩과 같은 태그를 맨 앞에 세우는 규칙(티켓 09)은 이 함수에 더한다.
 */
export function resolveCardTags(
  myTagIds: readonly string[],
  tags: readonly PersonalTagItem[],
): { shown: PersonalTagItem[]; hiddenCount: number } {
  const byId = new Map(tags.map((t) => [t.id, t]));
  const resolved = myTagIds.flatMap((id) => {
    const found = byId.get(id);
    return found ? [found] : [];
  });
  return {
    shown: resolved.slice(0, CARD_TAG_LIMIT),
    hiddenCount: Math.max(0, resolved.length - CARD_TAG_LIMIT),
  };
}

export interface TagPickerView {
  /** 이름에 검색어가 든 내 태그(검색어가 없으면 전부) — 내 태그 목록 순서 그대로. */
  matches: PersonalTagItem[];
  /** 「만들기 [이름]」에 쓸 이름 — 같은 이름이 없고 이름 규칙을 지킬 때만. */
  create: string | null;
  /** 같은 이름이 없지만 한도라 만들 수 없다 — 「만들기」 자리에 안내. */
  limitReached: boolean;
}

/**
 * 태그 창 — 검색어로 좁힌 목록과 「만들기」 여부.
 *
 * 맞는 태그를 위에, 「만들기」를 맨 아래에 둔다. 같은 이름(공백·대소문자 무시)이 이미 있으면
 * 만들지 않는다 — 서버도 그 태그를 돌려준다.
 */
export function resolveTagPicker(
  tags: readonly PersonalTagItem[],
  query: string,
  myTagCount: number,
): TagPickerView {
  const key = personalTagNameKey(query);
  if (key === '') return { matches: [...tags], create: null, limitReached: false };

  const matches = tags.filter((t) => personalTagNameKey(t.name).includes(key));
  const exact = tags.some((t) => personalTagNameKey(t.name) === key);
  const checked = normalizePersonalTagName(query);
  if (exact || !checked.ok) return { matches, create: null, limitReached: false };
  if (isPersonalTagLimitReached(myTagCount)) return { matches, create: null, limitReached: true };
  return { matches, create: checked.name, limitReached: false };
}

/** 편집 패널 색 견본 — 연한 바탕 + 같은 계열 테두리(시안 F6 ③). */
export const PERSONAL_TAG_SWATCH_CLASS: Record<PersonalTagColor, string> = {
  blue: 'border-[#3B82F6] bg-[#DBEAFE]',
  red: 'border-[#EF4444] bg-[#FEE2E2]',
  green: 'border-[#22C55E] bg-[#DCFCE7]',
  purple: 'border-[#8B5CF6] bg-[#EDE9FE]',
  amber: 'border-[#F59E0B] bg-[#FEF3C7]',
  teal: 'border-[#14B8A6] bg-[#CCFBF1]',
  pink: 'border-[#EC4899] bg-[#FCE7F3]',
  gray: 'border-[#9CA3AF] bg-[#F3F4F6]',
};

export type TagRenameDecision =
  | { kind: 'unchanged' }
  | { kind: 'invalid'; reason: 'empty' | 'too_long' | 'taken'; message: string }
  | { kind: 'save'; name: string };

const RENAME_MESSAGE = {
  empty: '태그 이름을 입력하세요',
  too_long: '태그 이름은 20자까지입니다',
  taken: '이미 같은 이름의 태그가 있습니다',
} as const;

/**
 * 편집 패널의 이름 칸 — 보낼지, 왜 못 보내는지 (티켓 08).
 *
 * 앞뒤 공백을 걷은 이름이 지금과 글자 그대로 같으면 보내지 않는다. 다른 내 태그와 같은
 * 이름(공백·대소문자 무시)이면 겹침이다 — 자기 이름의 대소문자만 바꾸는 것은 겹침이 아니다.
 * 서버도 같은 규칙으로 CONFLICT 를 낸다(다른 탭에서 만든 이름은 서버가 잡는다).
 */
export function resolveTagRename(
  draft: string,
  tag: Pick<PersonalTagItem, 'id' | 'name'>,
  tags: readonly Pick<PersonalTagItem, 'id' | 'name'>[],
): TagRenameDecision {
  const checked = normalizePersonalTagName(draft);
  if (!checked.ok) {
    return { kind: 'invalid', reason: checked.reason, message: RENAME_MESSAGE[checked.reason] };
  }
  if (checked.name === tag.name) return { kind: 'unchanged' };
  const key = personalTagNameKey(checked.name);
  if (tags.some((t) => t.id !== tag.id && personalTagNameKey(t.name) === key)) {
    return { kind: 'invalid', reason: 'taken', message: RENAME_MESSAGE.taken };
  }
  return { kind: 'save', name: checked.name };
}
