/**
 * 조사표를 따라가는 hover 규칙. 순수 모듈 — React·DOM 을 모른다.
 *
 * 마우스를 얹는 것만으로 왼쪽 조사표가 따라 움직이므로, 무엇을 "의도한 이동"으로
 * 볼지가 화면의 체감을 통째로 정한다. 규칙은 셋이고 서로 맞물린다.
 */

/** 스쳐 지나가는 것과 머무는 것을 가르는 시간. 그룹을 넘어갈 때만 쓴다. */
export const HOVER_DELAY_MS = 500;

/** 마지막 스크롤 이후 이만큼은 hover 를 받지 않는다. */
export const SCROLL_QUIET_MS = 150;

export type HoverAction =
  /** 아무 일도 하지 않는다. 이미 걸린 타이머는 호출측이 이미 껐다. */
  | { kind: 'ignore' }
  /** 곧바로 초점을 옮긴다. */
  | { kind: 'now' }
  /** 이만큼 머무르면 옮긴다. */
  | { kind: 'after'; delayMs: number };

export function resolveHoverAction(input: {
  /** 얹은 문항이 속한 그룹. 그룹 밖 문항은 null. */
  groupId: string | null;
  /** 지금 초점이 있는 그룹. 없으면 null. */
  activeGroupId: string | null;
  now: number;
  /** 이 시각까지는 목록이 스크롤 중인 것으로 본다. */
  scrollingUntil: number;
}): HoverAction {
  // 스크롤 중에는 커서가 가만히 있어도 행이 밑으로 지나가며 hover 가 발화한다.
  // 타이머를 걸어 두면 스크롤이 멎은 뒤 엉뚱한 행으로 튀므로 아예 받지 않는다.
  if (input.now < input.scrollingUntil) return { kind: 'ignore' };

  // 같은 그룹 안에서는 지연이 없다 — 조사표가 쪽을 넘기지 않고 주황 테두리만
  // 옮겨 붙으므로 기다릴 이유가 없다. 그룹 밖 문항끼리도 같은 묶음이다(null === null).
  if (input.groupId === input.activeGroupId) return { kind: 'now' };

  // 그룹을 넘어가면 쪽이 통째로 바뀐다. 지나가는 커서에 조사표를 빼앗기지 않게
  // 머무름을 확인한다.
  return { kind: 'after', delayMs: HOVER_DELAY_MS };
}
