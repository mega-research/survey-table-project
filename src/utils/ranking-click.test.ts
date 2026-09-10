import { describe, expect, it } from 'vitest';

import type { RankingAnswer } from '@/types/survey';

import { lowestEmptyRank, rankOfOption, toggleRankingOption } from './ranking-click';

describe('toggleRankingOption', () => {
  it('빈 응답에서 보기를 누르면 1순위가 된다', () => {
    expect(toggleRankingOption([], 'a', 3)).toEqual({
      next: [{ rank: 1, optionValue: 'a' }],
      full: false,
    });
  });

  it('비어 있는 가장 낮은 순위에 들어간다', () => {
    const answers: RankingAnswer[] = [{ rank: 1, optionValue: 'a' }];
    expect(toggleRankingOption(answers, 'b', 3).next).toEqual([
      { rank: 1, optionValue: 'a' },
      { rank: 2, optionValue: 'b' },
    ]);
  });

  it('드롭다운 시절의 빈 칸(1·3순위만 있음)이 있으면 그 칸을 먼저 채운다', () => {
    const answers: RankingAnswer[] = [
      { rank: 1, optionValue: 'a' },
      { rank: 3, optionValue: 'c' },
    ];
    expect(toggleRankingOption(answers, 'b', 3).next).toEqual([
      { rank: 1, optionValue: 'a' },
      { rank: 2, optionValue: 'b' },
      { rank: 3, optionValue: 'c' },
    ]);
  });

  it('이미 순위가 있는 보기를 다시 누르면 빠지고 뒤 순위가 당겨진다', () => {
    const answers: RankingAnswer[] = [
      { rank: 1, optionValue: 'a' },
      { rank: 2, optionValue: 'b', optionText: '상세' },
      { rank: 3, optionValue: 'c' },
    ];
    expect(toggleRankingOption(answers, 'a', 3)).toEqual({
      next: [
        { rank: 1, optionValue: 'b', optionText: '상세' },
        { rank: 2, optionValue: 'c' },
      ],
      full: false,
    });
  });

  it('순위가 다 찼으면 바꾸지 않고 full 을 알린다', () => {
    const answers: RankingAnswer[] = [
      { rank: 1, optionValue: 'a' },
      { rank: 2, optionValue: 'b' },
    ];
    expect(toggleRankingOption(answers, 'c', 2)).toEqual({ next: answers, full: true });
  });

  it('positions 를 넘는 순위 항목은 셀 수에 맞게 잘려 있어도 그대로 두지 않고 당김에 포함한다', () => {
    const answers: RankingAnswer[] = [
      { rank: 1, optionValue: 'a' },
      { rank: 2, optionValue: 'b' },
    ];
    // 2순위를 빼면 1순위만 남는다 — 당길 것이 없어도 결과는 정렬돼 있다
    expect(toggleRankingOption(answers, 'b', 2).next).toEqual([{ rank: 1, optionValue: 'a' }]);
  });
});

describe('rankOfOption / lowestEmptyRank', () => {
  const answers: RankingAnswer[] = [
    { rank: 1, optionValue: 'a' },
    { rank: 3, optionValue: 'c' },
  ];

  it('보기의 순위를 찾는다', () => {
    expect(rankOfOption(answers, 'c')).toBe(3);
    expect(rankOfOption(answers, 'zzz')).toBeUndefined();
  });

  it('비어 있는 가장 낮은 순위를 찾고, 없으면 undefined', () => {
    expect(lowestEmptyRank(answers, 3)).toBe(2);
    expect(lowestEmptyRank([{ rank: 1, optionValue: 'a' }], 1)).toBeUndefined();
  });
});
