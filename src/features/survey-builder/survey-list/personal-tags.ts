import {
  PERSONAL_TAG_MESSAGE,
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
 * 카드 태그 줄 — 앞의 `CARD_TAG_LIMIT` 개를 보이고 나머지는 센다. 내 태그 목록에 없는 id(다른 탭에서
 * 지운 태그 등)는 건너뛴다.
 *
 * 걸린 검색 칩(`activeTagIds`)과 같은 태그가 맨 앞에 선다(티켓 09) — 왜 이 카드가 보이는지 바로 보이게.
 * 걸린 태그끼리, 나머지끼리는 붙인 순서 그대로다.
 */
export function resolveCardTags(
  myTagIds: readonly string[],
  tags: readonly PersonalTagItem[],
  activeTagIds: readonly string[] = [],
): { shown: PersonalTagItem[]; hiddenCount: number } {
  const byId = new Map(tags.map((t) => [t.id, t]));
  const active = new Set(activeTagIds);
  const resolved = myTagIds.flatMap((id) => {
    const found = byId.get(id);
    return found ? [found] : [];
  });
  const ordered = [
    ...resolved.filter((t) => active.has(t.id)),
    ...resolved.filter((t) => !active.has(t.id)),
  ];
  return {
    shown: ordered.slice(0, CARD_TAG_LIMIT),
    hiddenCount: Math.max(0, ordered.length - CARD_TAG_LIMIT),
  };
}

/** 「# 태그」 목록 정렬 — 많이 쓴 순(기본)·가나다순. */
export type TagFilterSort = 'usage' | 'name';

/**
 * 「# 태그」 목록(티켓 09, 시안 F8-d) — 이름에 찾는 글자가 든 내 태그(없으면 전부)를 고른 순서로.
 * 붙은 설문이 0개인 태그도 나온다(지울 수 있게). 많이 쓴 순의 동점과 가나다순은 한국어 정렬이다.
 */
export function resolveTagFilterList(
  tags: readonly PersonalTagItem[],
  query: string,
  sort: TagFilterSort,
): PersonalTagItem[] {
  const key = personalTagNameKey(query);
  const matches =
    key === '' ? [...tags] : tags.filter((t) => personalTagNameKey(t.name).includes(key));
  const byName = (a: PersonalTagItem, b: PersonalTagItem) => a.name.localeCompare(b.name, 'ko');
  return matches.sort(
    sort === 'usage' ? (a, b) => b.linkCount - a.linkCount || byName(a, b) : byName,
  );
}

/** 툴바 「자주 쓰는 태그」 줄에 세울 수 있는 최대 개수 — 폭이 모자라면 그보다 적게 보인다. */
export const QUICK_TAG_LIMIT = 10;

/**
 * 툴바 「자주 쓰는 태그」 줄 — 설문에 하나 이상 붙은 내 태그를 **최근 자주 검색에 건 순**으로 최대
 * `QUICK_TAG_LIMIT` 개(0157). 점수가 같으면(아직 아무것도 걸지 않았을 때 포함) 많이 붙인 순, 그다음
 * 가나다순이다. 붙은 설문이 없는 태그는 눌러도 빈 목록이라 빼고, 걸린 검색 칩이어도 자리를 옮기지 않는다.
 */
export function resolveQuickTags(tags: readonly PersonalTagItem[]): PersonalTagItem[] {
  const score = (t: PersonalTagItem) => t.recentFilterScore ?? 0;
  return tags
    .filter((t) => t.linkCount > 0)
    .sort(
      (a, b) =>
        score(b) - score(a) || b.linkCount - a.linkCount || a.name.localeCompare(b.name, 'ko'),
    )
    .slice(0, QUICK_TAG_LIMIT);
}

/**
 * 검색 칩 중 내 태그 목록에 있는 것만 — 다른 탭에서 지운 태그 칩을 풀 때 쓴다(서버는 없는 태그 id 를
 * 거부한다). 순서는 그대로.
 */
export function keepKnownTagIds(
  tagIds: readonly string[],
  tags: readonly PersonalTagItem[],
): string[] {
  const known = new Set(tags.map((t) => t.id));
  return tagIds.filter((id) => known.has(id));
}

export interface TagPickerView {
  /**
   * 이름에 검색어가 든 내 태그(검색어가 없으면 전부) — 위로 올릴 태그(`pinnedIds`)가 그 순서로 먼저,
   * 나머지는 내 태그 목록 순서.
   */
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
 *
 * `pinnedIds` 는 붙은 태그를 위로 모으는 순서다(시안 F6 ①). 부르는 쪽이 **창을 열 때의** 붙은 태그를
 * 넘긴다 — 지금 붙은 태그를 넘기면 창 안에서 붙이고 뗄 때마다 줄이 튄다.
 */
export function resolveTagPicker(
  tags: readonly PersonalTagItem[],
  query: string,
  myTagCount: number,
  pinnedIds: readonly string[] = [],
): TagPickerView {
  const key = personalTagNameKey(query);
  const ordered = pinFirst(tags, pinnedIds);
  if (key === '') return { matches: ordered, create: null, limitReached: false };

  const matches = ordered.filter((t) => personalTagNameKey(t.name).includes(key));
  const exact = tags.some((t) => personalTagNameKey(t.name) === key);
  const checked = normalizePersonalTagName(query);
  if (exact || !checked.ok) return { matches, create: null, limitReached: false };
  if (isPersonalTagLimitReached(myTagCount)) return { matches, create: null, limitReached: true };
  return { matches, create: checked.name, limitReached: false };
}

/** `pinnedIds` 의 태그를 그 순서로 앞에 — 목록에 없는 id 는 건너뛰고, 나머지는 원래 순서. */
function pinFirst(
  tags: readonly PersonalTagItem[],
  pinnedIds: readonly string[],
): PersonalTagItem[] {
  if (pinnedIds.length === 0) return [...tags];
  const byId = new Map(tags.map((t) => [t.id, t]));
  const pinned = [...new Set(pinnedIds)].flatMap((id) => {
    const found = byId.get(id);
    return found ? [found] : [];
  });
  const pinnedSet = new Set(pinned.map((t) => t.id));
  return [...pinned, ...tags.filter((t) => !pinnedSet.has(t.id))];
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
    return {
      kind: 'invalid',
      reason: checked.reason,
      message: PERSONAL_TAG_MESSAGE[checked.reason],
    };
  }
  if (checked.name === tag.name) return { kind: 'unchanged' };
  const key = personalTagNameKey(checked.name);
  if (tags.some((t) => t.id !== tag.id && personalTagNameKey(t.name) === key)) {
    return { kind: 'invalid', reason: 'taken', message: PERSONAL_TAG_MESSAGE.taken };
  }
  return { kind: 'save', name: checked.name };
}
