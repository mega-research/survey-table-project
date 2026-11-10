import { describe, expect, it } from 'vitest';

import { shareCountAfter, shareTargetOutcome } from './fieldwork-share-overlap';

describe('겹침 처리 — 대상 하나가 적용 뒤 어디에 있는가', () => {
  const overlapping = { matched: true, inThisLink: false, inOtherOpenLink: true };

  it('가져오기는 이쪽에 넣고 다른 링크에서 뺀다', () => {
    expect(shareTargetOutcome(overlapping, 'take')).toEqual({
      inThisLink: true,
      leavesOtherLinks: true,
    });
  });

  it('남겨 두기는 이쪽에 넣지 않고 다른 링크도 건드리지 않는다', () => {
    expect(shareTargetOutcome(overlapping, 'keep')).toEqual({
      inThisLink: false,
      leavesOtherLinks: false,
    });
  });

  it('같이 맡기기는 이쪽에 넣고 다른 링크에도 남긴다', () => {
    expect(shareTargetOutcome(overlapping, 'joint')).toEqual({
      inThisLink: true,
      leavesOtherLinks: false,
    });
  });

  it('조건 밖 대상은 고른 처리와 무관하게 이쪽에서 빠지고 다른 링크는 그대로다', () => {
    for (const overlap of ['take', 'keep', 'joint'] as const) {
      expect(
        shareTargetOutcome({ matched: false, inThisLink: true, inOtherOpenLink: true }, overlap),
      ).toEqual({ inThisLink: false, leavesOtherLinks: false });
    }
  });

  it('어느 링크에도 없던 조건 결과는 고른 처리와 무관하게 들어온다', () => {
    for (const overlap of ['take', 'keep', 'joint'] as const) {
      expect(
        shareTargetOutcome({ matched: true, inThisLink: false, inOtherOpenLink: false }, overlap),
      ).toEqual({ inThisLink: true, leavesOtherLinks: false });
    }
  });

  it('이미 같이 맡고 있는 대상은 겹침이 아니다 — 다시 적용해도 양쪽에 그대로 남는다', () => {
    for (const overlap of ['take', 'keep', 'joint'] as const) {
      expect(
        shareTargetOutcome({ matched: true, inThisLink: true, inOtherOpenLink: true }, overlap),
      ).toEqual({ inThisLink: true, leavesOtherLinks: false });
    }
  });
});

describe('적용 뒤 이 링크의 인원', () => {
  const summary = { matched: 100, overlap: 30 };

  it('가져오기·같이 맡기기는 조건 결과 전부다', () => {
    expect(shareCountAfter(summary, 'take')).toBe(100);
    expect(shareCountAfter(summary, 'joint')).toBe(100);
  });

  it('남겨 두기는 겹치는 대상만큼 적다', () => {
    expect(shareCountAfter(summary, 'keep')).toBe(70);
  });
});
