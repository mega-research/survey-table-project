import { describe, expect, it } from 'vitest';

import {
  DEFAULT_GROUP_KEY,
  collectChoiceGroups,
  collectRankingGroups,
  getGroupKeyOfCell,
  getGroupTypeOfCell,
  isGroupedChoiceQuestion,
  isGroupedRankingQuestion,
  nextGroupKey,
  pruneChoiceGroups,
} from '@/utils/choice-group-helpers';
import type { ChoiceGroup, Question } from '@/types/survey';

const rad1: ChoiceGroup = { id: 'g1', groupKey: 'rad1', type: 'radio', label: 'TV보유' };
const rad2: ChoiceGroup = { id: 'g2', groupKey: 'rad2', type: 'radio', label: '구매의향' };
const cb1: ChoiceGroup = { id: 'g3', groupKey: 'cb1', type: 'checkbox', label: '복수선택' };

function makeQuestion(overrides: Record<string, unknown>): Question {
  return {
    id: 'q1', type: 'radio', title: '질문', required: false, order: 1,
    ...overrides,
  } as unknown as Question;
}

const grouped = makeQuestion({
  choiceGroups: [rad1, rad2],
  tableRowsData: [
    {
      id: 'r1', label: '행1',
      cells: [
        { id: 'cellA', content: 'UHD', type: 'choice_opt', choiceGroupId: 'g1' },
        { id: 'cellB', content: 'FHD', type: 'choice_opt', choiceGroupId: 'g1' },
        { id: 'cellC', content: '있음', type: 'choice_opt', choiceGroupId: 'g2' },
        { id: 'cellD', content: '미소속', type: 'choice_opt' },
        { id: 'cellX', content: '텍스트', type: 'text' },
      ],
    },
  ],
});

// rad1 + cb1 혼재 픽스처 (radio 질문)
const mixedRadioQ = makeQuestion({
  type: 'radio',
  choiceGroups: [rad1, cb1],
  tableRowsData: [
    {
      id: 'r1', label: '행1',
      cells: [
        { id: 'cellA', content: 'UHD', type: 'choice_opt', choiceGroupId: 'g1' },
        { id: 'cellB', content: '있음', type: 'choice_opt', choiceGroupId: 'g3' },
        { id: 'cellD', content: '미소속', type: 'choice_opt' },
      ],
    },
  ],
});

// cb1 만 있는 checkbox 질문
const cbOnlyQ = makeQuestion({
  type: 'checkbox',
  choiceGroups: [cb1],
  tableRowsData: [
    {
      id: 'r1', label: '행1',
      cells: [
        { id: 'cellB', content: '있음', type: 'choice_opt', choiceGroupId: 'g3' },
        { id: 'cellD', content: '미소속', type: 'choice_opt' },
      ],
    },
  ],
});

// ranking 그룹만 있는 픽스처
const rankingOnly: ChoiceGroup = { id: 'g9', groupKey: 'rnk1', type: 'ranking', label: '순위' };
const rankingOnlyQ = makeQuestion({
  type: 'radio',
  choiceGroups: [rankingOnly],
  tableRowsData: [
    {
      id: 'r1', label: '행1',
      cells: [{ id: 'cellZ', content: '항목', type: 'choice_opt', choiceGroupId: 'g9' }],
    },
  ],
});

// ranking 그룹 픽스처 (4b-3 전용)
const rnk1: ChoiceGroup = { id: 'rg1', groupKey: 'rnk1', type: 'ranking', label: '브랜드' };
const rnk2: ChoiceGroup = { id: 'rg2', groupKey: 'rnk2', type: 'ranking', label: '디자인' };

// rnk1(셀2) + rnk2(셀2) + 미소속(셀1) 구조
const rnkGroupedQ = makeQuestion({
  type: 'table',
  choiceGroups: [rnk1, rnk2],
  tableRowsData: [
    {
      id: 'r1', label: '행1',
      cells: [
        { id: 'rk1', content: '삼성', type: 'ranking_opt', choiceGroupId: 'rg1' },
        { id: 'rk2', content: 'LG', type: 'ranking_opt', choiceGroupId: 'rg1' },
        { id: 'rk3', content: '디자인A', type: 'ranking_opt', choiceGroupId: 'rg2' },
        { id: 'rk4', content: '디자인B', type: 'ranking_opt', choiceGroupId: 'rg2' },
        { id: 'rk5', content: '미소속', type: 'ranking_opt' },
      ],
    },
  ],
});

// ranking 그룹이 있는 질문에 radio 그룹도 혼재
const rnkWithRadioQ = makeQuestion({
  type: 'table',
  choiceGroups: [rnk1, rad1],
  tableRowsData: [
    {
      id: 'r1', label: '행1',
      cells: [
        { id: 'rk1', content: '삼성', type: 'ranking_opt', choiceGroupId: 'rg1' },
        { id: 'cellA', content: 'UHD', type: 'choice_opt', choiceGroupId: 'g1' },
      ],
    },
  ],
});

// isHidden 셀이 포함된 픽스처
const rnkWithHiddenQ = makeQuestion({
  type: 'table',
  choiceGroups: [rnk1],
  tableRowsData: [
    {
      id: 'r1', label: '행1',
      cells: [
        { id: 'rk1', content: '삼성', type: 'ranking_opt', choiceGroupId: 'rg1' },
        { id: 'rk_hidden', content: '숨김', type: 'ranking_opt', choiceGroupId: 'rg1', isHidden: true },
      ],
    },
  ],
});

describe('isGroupedChoiceQuestion', () => {
  it('radio 그룹이 있으면 true', () => {
    expect(isGroupedChoiceQuestion(grouped)).toBe(true);
  });

  it('checkbox 그룹만 있어도 true', () => {
    expect(isGroupedChoiceQuestion(cbOnlyQ)).toBe(true);
  });

  it('ranking 그룹만 있으면 false — ranking은 제외', () => {
    expect(isGroupedChoiceQuestion(rankingOnlyQ)).toBe(false);
  });

  it('choiceGroups가 없거나 비면 false - 하위호환 분기점', () => {
    expect(isGroupedChoiceQuestion(makeQuestion({}))).toBe(false);
    expect(isGroupedChoiceQuestion(makeQuestion({ choiceGroups: [] }))).toBe(false);
  });
});

describe('getGroupKeyOfCell', () => {
  it('셀의 choiceGroupId를 groupKey로 해석한다', () => {
    expect(getGroupKeyOfCell(grouped, 'cellA')).toBe('rad1');
    expect(getGroupKeyOfCell(grouped, 'cellC')).toBe('rad2');
  });

  it('미소속 셀은 default 키', () => {
    expect(getGroupKeyOfCell(grouped, 'cellD')).toBe(DEFAULT_GROUP_KEY);
  });

  it('존재하지 않는 그룹 id를 참조하는 셀도 default로 폴백한다', () => {
    const broken = makeQuestion({
      choiceGroups: [rad1],
      tableRowsData: [{ id: 'r1', label: '행1', cells: [
        { id: 'cellZ', content: '', type: 'choice_opt', choiceGroupId: 'ghost' },
      ] }],
    });
    expect(getGroupKeyOfCell(broken, 'cellZ')).toBe(DEFAULT_GROUP_KEY);
  });
});

describe('collectChoiceGroups', () => {
  it('명시 그룹 + 미소속 셀 존재 시 default를 멤버 셀과 함께 반환한다', () => {
    const groups = collectChoiceGroups(grouped);
    expect(groups.map((g) => g.groupKey)).toEqual(['rad1', 'rad2', DEFAULT_GROUP_KEY]);
    expect(groups[0]!.cells.map((c) => c.id)).toEqual(['cellA', 'cellB']);
    expect(groups[2]!.cells.map((c) => c.id)).toEqual(['cellD']);
  });

  it('명시 그룹의 type 필드가 포함된다 — radio·checkbox 혼재 시 각 그룹의 type 반환', () => {
    const groups = collectChoiceGroups(mixedRadioQ);
    expect(groups.map((g) => g.groupKey)).toEqual(['rad1', 'cb1', DEFAULT_GROUP_KEY]);
    expect(groups[0]!.type).toBe('radio');
    expect(groups[1]!.type).toBe('checkbox');
    // 미소속 default: radio 질문이므로 'radio'
    expect(groups[2]!.type).toBe('radio');
  });

  it('checkbox 질문의 default 그룹 type은 checkbox', () => {
    const groups = collectChoiceGroups(cbOnlyQ);
    const def = groups.find((g) => g.groupKey === DEFAULT_GROUP_KEY);
    expect(def).toBeDefined();
    expect(def!.type).toBe('checkbox');
  });

  it('ranking 그룹은 수집에서 skip한다 — ranking 멤버 셀은 미소속으로 default에 귀속', () => {
    const groups = collectChoiceGroups(rankingOnlyQ);
    // ChoiceGroupWithCells.type 은 'radio' | 'checkbox' 만 존재(ranking skip 보장).
    // ranking 그룹 하나만 있고 해당 셀이 1개이므로 미소속으로 default 그룹 1개만 반환.
    expect(groups).toHaveLength(1);
    expect(groups[0]!.groupKey).toBe(DEFAULT_GROUP_KEY);
  });

  it('미소속 셀이 없으면 default 그룹을 만들지 않는다', () => {
    const noDefault = makeQuestion({
      choiceGroups: [rad1],
      tableRowsData: [{ id: 'r1', label: '행1', cells: [
        { id: 'cellA', content: 'UHD', type: 'choice_opt', choiceGroupId: 'g1' },
      ] }],
    });
    expect(collectChoiceGroups(noDefault).map((g) => g.groupKey)).toEqual(['rad1']);
  });

  it('멤버 0인 명시 그룹은 collectChoiceGroups 에서 제외된다', () => {
    // rad1 은 멤버 있음, rad2 는 멤버 없음(phantom)
    const withPhantom = makeQuestion({
      choiceGroups: [rad1, rad2],
      tableRowsData: [{ id: 'r1', label: '행1', cells: [
        { id: 'cellA', content: 'UHD', type: 'choice_opt', choiceGroupId: 'g1' },
        { id: 'cellD', content: '미소속', type: 'choice_opt' },
      ] }],
    });
    const groups = collectChoiceGroups(withPhantom);
    // rad2(g2)는 멤버 0이므로 제외. rad1 + default(미소속 셀) 만 반환.
    expect(groups.map((g) => g.groupKey)).toEqual(['rad1', DEFAULT_GROUP_KEY]);
  });

  it('멤버 0인 명시 그룹만 있을 때 미소속 셀이 없으면 빈 배열', () => {
    // 모든 그룹이 phantom 이고 미소속 셀도 없는 극단 케이스
    const allPhantom = makeQuestion({
      choiceGroups: [rad1, rad2],
      tableRowsData: [{ id: 'r1', label: '행1', cells: [] }],
    });
    expect(collectChoiceGroups(allPhantom)).toEqual([]);
  });
});

describe('getGroupTypeOfCell', () => {
  it('cb1 소속 셀은 checkbox 반환', () => {
    expect(getGroupTypeOfCell(mixedRadioQ, 'cellB')).toBe('checkbox');
  });

  it('rad1 소속 셀은 radio 반환', () => {
    expect(getGroupTypeOfCell(mixedRadioQ, 'cellA')).toBe('radio');
  });

  it('미소속 셀: radio 질문이면 radio', () => {
    expect(getGroupTypeOfCell(mixedRadioQ, 'cellD')).toBe('radio');
  });

  it('미소속 셀: checkbox 질문이면 checkbox', () => {
    expect(getGroupTypeOfCell(cbOnlyQ, 'cellD')).toBe('checkbox');
  });

  it('존재하지 않는 그룹 id(ghost 참조) → 질문 type 기반 폴백', () => {
    const broken = makeQuestion({
      type: 'checkbox',
      choiceGroups: [rad1],
      tableRowsData: [{ id: 'r1', label: '행1', cells: [
        { id: 'cellZ', content: '', type: 'choice_opt', choiceGroupId: 'ghost' },
      ] }],
    });
    expect(getGroupTypeOfCell(broken, 'cellZ')).toBe('checkbox');
  });
});

describe('nextGroupKey', () => {
  it('기존 rad 순번 다음 번호를 발번한다', () => {
    expect(nextGroupKey([rad1, rad2], 'radio')).toBe('rad3');
  });

  it('그룹이 없으면 rad1', () => {
    expect(nextGroupKey([], 'radio')).toBe('rad1');
  });

  it('수동 오버라이드로 구멍이 나도 최대+1', () => {
    const custom: ChoiceGroup = { id: 'g9', groupKey: 'rad9', type: 'radio', label: 'x' };
    expect(nextGroupKey([custom], 'radio')).toBe('rad10');
  });

  it('cb1 이미 있을 때 cb2를 발번한다', () => {
    expect(nextGroupKey([cb1], 'checkbox')).toBe('cb2');
  });
});

describe('pruneChoiceGroups', () => {
  it('멤버 0 그룹을 제거한다', () => {
    const q = makeQuestion({
      choiceGroups: [rad1, rad2],
      tableRowsData: [{ id: 'r1', label: '행1', cells: [
        { id: 'cellA', content: '', type: 'choice_opt', choiceGroupId: 'g1' },
      ] }],
    });
    expect(pruneChoiceGroups(q)?.map((g) => g.groupKey)).toEqual(['rad1']);
  });

  it('전부 멤버가 있으면 동일 참조 반환', () => {
    expect(pruneChoiceGroups(grouped)).toBe(grouped.choiceGroups);
  });

  it('choiceGroups가 없으면 undefined', () => {
    expect(pruneChoiceGroups(makeQuestion({}))).toBeUndefined();
  });

  it('ranking_opt 셀만 멤버인 rnk 그룹은 prune되지 않고 생존한다', () => {
    // 버그 픽스 검증: 기존 코드는 collectChoiceOptCells만 봐서 ranking_opt 멤버를 인식 못함
    expect(pruneChoiceGroups(rnkGroupedQ)?.map((g) => g.groupKey)).toEqual(['rnk1', 'rnk2']);
  });
});

describe('isGroupedRankingQuestion', () => {
  it('ranking 그룹이 있으면 true', () => {
    expect(isGroupedRankingQuestion(rnkGroupedQ)).toBe(true);
  });

  it('radio·checkbox 그룹만 있으면 false', () => {
    expect(isGroupedRankingQuestion(grouped)).toBe(false);
    expect(isGroupedRankingQuestion(cbOnlyQ)).toBe(false);
  });

  it('choiceGroups가 없으면 false', () => {
    expect(isGroupedRankingQuestion(makeQuestion({}))).toBe(false);
    expect(isGroupedRankingQuestion(makeQuestion({ choiceGroups: [] }))).toBe(false);
  });
});

describe('isGroupedChoiceQuestion (ranking 불변 고정)', () => {
  it('ranking 그룹만 있으면 false — ranking은 계속 제외', () => {
    expect(isGroupedChoiceQuestion(rnkGroupedQ)).toBe(false);
  });
});

describe('collectRankingGroups', () => {
  it('rnk1(셀2)+rnk2(셀2)+미소속(셀1) → [rnk1, rnk2, default] 순서·멤버 반환', () => {
    const groups = collectRankingGroups(rnkGroupedQ);
    expect(groups.map((g) => g.groupKey)).toEqual(['rnk1', 'rnk2', DEFAULT_GROUP_KEY]);
    expect(groups[0]!.cells.map((c) => c.id)).toEqual(['rk1', 'rk2']);
    expect(groups[1]!.cells.map((c) => c.id)).toEqual(['rk3', 'rk4']);
    expect(groups[2]!.cells.map((c) => c.id)).toEqual(['rk5']);
  });

  it('label 필드가 그룹 정의대로 설정된다', () => {
    const groups = collectRankingGroups(rnkGroupedQ);
    expect(groups[0]!.label).toBe('브랜드');
    expect(groups[1]!.label).toBe('디자인');
    expect(groups[2]!.label).toBe('');
  });

  it('멤버 0 rnk 그룹은 skip한다', () => {
    const emptyRnkQ = makeQuestion({
      type: 'table',
      choiceGroups: [rnk1, rnk2],
      tableRowsData: [{ id: 'r1', label: '행1', cells: [
        { id: 'rk3', content: '디자인A', type: 'ranking_opt', choiceGroupId: 'rg2' },
      ] }],
    });
    const groups = collectRankingGroups(emptyRnkQ);
    // rnk1은 멤버 없으므로 skip, rnk2만 반환
    expect(groups.map((g) => g.groupKey)).toEqual(['rnk2']);
  });

  it('radio 그룹은 수집에서 무시한다', () => {
    const groups = collectRankingGroups(rnkWithRadioQ);
    expect(groups.map((g) => g.groupKey)).toEqual(['rnk1']);
    expect(groups[0]!.cells.map((c) => c.id)).toEqual(['rk1']);
  });

  it('isHidden 셀은 제외된다', () => {
    const groups = collectRankingGroups(rnkWithHiddenQ);
    expect(groups[0]!.cells.map((c) => c.id)).toEqual(['rk1']);
  });
});
