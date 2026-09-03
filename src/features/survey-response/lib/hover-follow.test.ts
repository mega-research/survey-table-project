import { describe, expect, it } from 'vitest';

import { HOVER_DELAY_MS, resolveHoverAction, SCROLL_QUIET_MS } from './hover-follow';

const at = (over: Partial<Parameters<typeof resolveHoverAction>[0]> = {}) =>
  resolveHoverAction({ groupId: 'g1', activeGroupId: 'g1', now: 1000, scrollingUntil: 0, ...over });

describe('resolveHoverAction', () => {
  it('같은 그룹 안에서는 기다리지 않는다', () => {
    expect(at()).toEqual({ kind: 'now' });
  });

  it('그룹 밖 문항끼리도 같은 묶음이다 — null 끼리는 지연이 없다', () => {
    // groupId 가 null 이면 무조건 지연이던 시절, 그룹 없는 문항 사이를 훑을 때마다
    // 0.5초를 기다려야 했다.
    expect(at({ groupId: null, activeGroupId: null })).toEqual({ kind: 'now' });
  });

  it('그룹을 넘어가면 머무름을 확인한다', () => {
    expect(at({ groupId: 'g2' })).toEqual({ kind: 'after', delayMs: HOVER_DELAY_MS });
  });

  it('초점이 없던 상태에서 그룹 문항에 얹으면 지연 경로다', () => {
    expect(at({ activeGroupId: null })).toEqual({ kind: 'after', delayMs: HOVER_DELAY_MS });
  });

  it('스크롤 직후에는 같은 그룹이어도 받지 않는다', () => {
    expect(at({ scrollingUntil: 1000 + SCROLL_QUIET_MS })).toEqual({ kind: 'ignore' });
  });

  it('정숙 구간이 지나면 다시 받는다 — 경계 시각은 이미 지난 것으로 본다', () => {
    expect(at({ now: 1000, scrollingUntil: 1000 })).toEqual({ kind: 'now' });
  });
});
