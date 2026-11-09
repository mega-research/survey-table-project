// 개인 표시 도메인 — 즐겨찾기 (티켓 06) · 내 태그 (티켓 07).
//
// client-safe — server-only·Node·DB 의존 없음. 계약은 shared/contracts 가 소유하고 여기는 그것을
// 다시 내보낸다(공유 설정·그룹 도메인과 같은 구조). 태그 이름 정규화·한도는 화면도 써야 해서
// 계약(`shared/contracts/workspace`)에 있다. 새 태그 색 배정도 「만들기」 미리보기가 같은 규칙을
// 봐야 해서 계약에 있다.
import { PERSONAL_TAG_MESSAGE } from '@/shared/contracts/workspace';

export {
  CreatePersonalTagInput,
  CreatePersonalTagOutput,
  DeletePersonalTagInput,
  DeletePersonalTagOutput,
  MinePersonalTagsOutput,
  RecordTagFilterInput,
  RecordTagFilterOutput,
  SetFavoriteInput,
  SetFavoriteOutput,
  SetTagLinkInput,
  SetTagLinkOutput,
  UpdatePersonalTagInput,
  UpdatePersonalTagOutput,
} from '@/shared/contracts/workspace-io';
export type { PersonalTagItem } from '@/shared/contracts/workspace-io';
export {
  PERSONAL_TAG_LIMIT,
  isPersonalTagLimitReached,
  pickPersonalTagColor,
} from '@/shared/contracts/workspace';

/**
 * 「자주 쓰는 태그」 점수의 반감기(일) — 14일 동안 걸지 않으면 점수가 절반이 된다. 설문이 몇 달 단위
 * 프로젝트라 끝난 사업 태그가 옛 클릭 수로 앞자리를 계속 차지하지 않게 한다(0157).
 */
export const PERSONAL_TAG_FILTER_HALF_LIFE_DAYS = 14;

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
