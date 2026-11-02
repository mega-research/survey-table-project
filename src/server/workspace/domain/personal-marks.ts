// 개인 표시 도메인 — 즐겨찾기 (티켓 06) · 내 태그 (티켓 07).
//
// client-safe — server-only·Node·DB 의존 없음. 계약은 shared/contracts 가 소유하고 여기는 그것을
// 다시 내보낸다(공유 설정·그룹 도메인과 같은 구조). 태그 이름 정규화·한도는 화면도 써야 해서
// 계약(`shared/contracts/workspace`)에 있고, 서버만 정하는 색 배정은 여기 있다.
import {
  PERSONAL_TAG_MESSAGE,
  type PersonalTagColor,
  personalTagColorValues,
} from '@/shared/contracts/workspace';

export {
  CreatePersonalTagInput,
  CreatePersonalTagOutput,
  DeletePersonalTagInput,
  DeletePersonalTagOutput,
  MinePersonalTagsOutput,
  SetFavoriteInput,
  SetFavoriteOutput,
  SetTagLinkInput,
  SetTagLinkOutput,
  UpdatePersonalTagInput,
  UpdatePersonalTagOutput,
} from '@/shared/contracts/workspace-io';
export type { PersonalTagItem } from '@/shared/contracts/workspace-io';
export { PERSONAL_TAG_LIMIT, isPersonalTagLimitReached } from '@/shared/contracts/workspace';

/**
 * 새 태그 색 — 내 태그에서 가장 적게 쓴 색, 같으면 어휘 순서가 앞선 색.
 *
 * 만들 때 색을 고르지 않게 하고, 태그가 늘어도 한 색으로 몰리지 않게 한다. `usedColors` 는 내
 * 태그 전부의 색(중복 포함)이다.
 */
export function pickPersonalTagColor(usedColors: readonly PersonalTagColor[]): PersonalTagColor {
  const usage = new Map<PersonalTagColor, number>(personalTagColorValues.map((c) => [c, 0]));
  for (const color of usedColors) usage.set(color, (usage.get(color) ?? 0) + 1);
  let best: PersonalTagColor = personalTagColorValues[0];
  for (const color of personalTagColorValues) {
    if ((usage.get(color) ?? 0) < (usage.get(best) ?? 0)) best = color;
  }
  return best;
}

/** 내 태그가 아니거나 없는 태그 — 둘을 가르지 않는다(남의 태그 존재를 알리지 않는다). */
export class PersonalTagNotFoundError extends Error {
  constructor() {
    super('태그를 찾을 수 없습니다.');
    this.name = 'PersonalTagNotFoundError';
  }
}

/**
 * 다른 내 태그와 이름이 겹친다(`lower(btrim(name))`). 이름은 메시지에 싣지 않는다 — 화면은 이
 * 문구를 이름 칸 아래에 그대로 보인다.
 */
export class PersonalTagNameTakenError extends Error {
  constructor() {
    super(PERSONAL_TAG_MESSAGE.taken);
    this.name = 'PersonalTagNameTakenError';
  }
}

/** 한도(`PERSONAL_TAG_LIMIT`)에 닿아 더 만들 수 없다. 이름은 메시지에 싣지 않는다. */
export class PersonalTagLimitError extends Error {
  constructor() {
    super(PERSONAL_TAG_MESSAGE.limit);
    this.name = 'PersonalTagLimitError';
  }
}

/**
 * 확인과 쓰기 사이에 설문이나 태그가 사라져 연결을 쓰지 못했다(외래 키 위반). 관문의 존재 은닉과
 * 같은 NOT_FOUND 로 돌려준다 — 만들며 붙이기였다면 트랜잭션이 태그까지 되돌린다.
 */
export class PersonalMarkTargetGoneError extends Error {
  constructor() {
    super('설문이나 태그를 찾을 수 없습니다.');
    this.name = 'PersonalMarkTargetGoneError';
  }
}
