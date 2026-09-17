import { describe, expect, it } from 'vitest';

import type { TableRow } from '@/types/survey';

import { buildRankingMobileSections } from './ranking-mobile-sections';

/** 분류(rowspan 2, header) | 항목 | 항목 — 데스크톱 표 그대로의 행 데이터 */
function rows(): TableRow[] {
  return [
    {
      id: 'r1',
      cells: [
        { id: 'cat-tech', type: 'text', content: '기술 성능', rowspan: 2, mobileDisplay: 'header' },
        { id: 'o1', type: 'ranking_opt', content: '연산 성능' },
        { id: 'o2', type: 'ranking_opt', content: '전력 효율' },
      ],
    },
    {
      id: 'r2',
      cells: [
        { id: 'r2c0', type: 'text', content: '', isHidden: true },
        { id: 'o3', type: 'ranking_opt', content: '품질 신뢰성' },
        { id: 'o4', type: 'ranking_opt', content: '보안성' },
      ],
    },
    {
      id: 'r3',
      cells: [
        { id: 'cat-econ', type: 'text', content: '경제성', mobileDisplay: 'header' },
        { id: 'o5', type: 'ranking_opt', content: '가격' },
        { id: 'o6', type: 'text', content: '' },
      ],
    },
    {
      id: 'r4',
      cells: [
        { id: 'r4c0', type: 'text', content: '분류 없음' },
        { id: 'o7', type: 'ranking_opt', content: '기타' },
      ],
    },
  ] as TableRow[];
}

describe('buildRankingMobileSections', () => {
  it('header 지정 셀이 rowspan 으로 덮는 행의 보기까지 한 구간으로 묶는다', () => {
    const sections = buildRankingMobileSections(rows());
    expect(sections.map((s) => s.headerCell?.id)).toEqual(['cat-tech', 'cat-econ', undefined]);
    expect(sections[0]!.items.map((i) => i.optCell.id)).toEqual(['o1', 'o2', 'o3', 'o4']);
    expect(sections[1]!.items.map((i) => i.optCell.id)).toEqual(['o5']);
    expect(sections[2]!.items.map((i) => i.optCell.id)).toEqual(['o7']);
  });

  it('행의 첫 보기만 행 표시 셀을 받는다 — 카드 아래 표시 셀이 보기마다 중복되지 않는다', () => {
    const [tech] = buildRankingMobileSections(rows());
    expect(tech!.items.map((i) => i.isFirstInRow)).toEqual([true, false, true, false]);
  });

  it('숨김·continuation 보기 셀은 빼고, header 가 없는 행은 제목 없는 구간이다', () => {
    const sections = buildRankingMobileSections([
      {
        id: 'r1',
        cells: [
          { id: 't', type: 'text', content: '분류' },
          { id: 'o1', type: 'ranking_opt', content: 'A' },
          { id: 'o2', type: 'ranking_opt', content: 'B', isHidden: true },
        ],
      },
    ] as TableRow[]);
    expect(sections).toHaveLength(1);
    expect(sections[0]!.headerCell).toBeUndefined();
    expect(sections[0]!.items.map((i) => i.optCell.id)).toEqual(['o1']);
  });
});
