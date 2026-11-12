import { describe, expect, it } from 'vitest';

import type { ChoiceGroup, TableCell, TableRow } from '@/types/survey';

import {
  applyImpliedSelectionPlan,
  countColumnImpliedSelectionTargets,
  labelImpliedSelectionCells,
  listImpliedSelectionCandidates,
  planColumnImpliedSelection,
  pruneImpliedCellIds,
} from './column-implied-selection';

/**
 * 따라 선택의 빌더 쪽 — 후보·죽은 짝 정리·열 일괄 적용. 여성기업 사전 설문조사 C7 모양
 * (항목 | 알고 있음 | 지원 경험 | 수혜 경험, 마지막 줄은 3칸 병합 단독 선택 보기).
 */
const groups: ChoiceGroup[] = [
  { id: 'g-know', groupKey: 'chk01', type: 'checkbox', label: '알고 있음' },
  { id: 'g-apply', groupKey: 'chk02', type: 'checkbox', label: '지원 경험 있음' },
  { id: 'g-benefit', groupKey: 'chk03', type: 'checkbox', label: '수혜 경험 있음' },
];

const opt = (id: string, choiceGroupId: string, extra: Partial<TableCell> = {}): TableCell => ({
  id,
  type: 'choice_opt',
  content: '',
  choiceGroupId,
  ...extra,
});
const itemRow = (n: number): TableRow => ({
  id: `r${n}`,
  label: `항목 ${n}`,
  cells: [
    { id: `item${n}`, type: 'text', content: `항목 ${n}` },
    opt(`know${n}`, 'g-know'),
    opt(`apply${n}`, 'g-apply'),
    opt(`benefit${n}`, 'g-benefit'),
  ],
});
const noneRow: TableRow = {
  id: 'r9',
  label: '없음',
  cells: [
    { id: 'item9', type: 'text', content: '모두 수혜 경험 없음' },
    opt('benefit-none', 'g-benefit', { exclusiveChoice: true, colspan: 3 }),
    { id: 'pad1', type: 'text', content: '', isHidden: true },
    { id: 'pad2', type: 'text', content: '', isHidden: true },
  ],
};
const rows = (): TableRow[] => [itemRow(1), itemRow(2), itemRow(3), noneRow];
const cellOf = (table: TableRow[], id: string) =>
  table.flatMap((row) => row.cells).find((cell) => cell.id === id)!;

describe('listImpliedSelectionCandidates — 함께 고를 칸 후보', () => {
  it('같은 표의 체크박스 그룹 보기 칸 전부에서 자기 자신과 단독 선택 보기·가려진 칸을 뺀다', () => {
    const candidates = listImpliedSelectionCandidates(rows(), 'benefit1', { groups });
    expect(candidates).toEqual([
      'know1',
      'apply1',
      'know2',
      'apply2',
      'benefit2',
      'know3',
      'apply3',
      'benefit3',
    ]);
  });

  it('라디오 그룹의 보기 칸은 후보가 아니다', () => {
    const radio: ChoiceGroup[] = [
      { ...groups[0]!, type: 'radio' },
      groups[1]!,
      groups[2]!,
    ];
    expect(listImpliedSelectionCandidates(rows(), 'benefit1', { groups: radio })).not.toContain('know1');
  });
});

describe('pruneImpliedCellIds — 죽은 짝 정리', () => {
  it('지워진 칸·자격을 잃은 칸·자기 자신을 걷어내고 순서는 지킨다', () => {
    expect(
      pruneImpliedCellIds(['apply1', 'gone', 'benefit-none', 'benefit1', 'know1'], {
        rows: rows(),
        ownCellId: 'benefit1',
        groups,
      }),
    ).toEqual(['apply1', 'know1']);
  });

  it('같은 칸을 두 번 적어도 한 번만 남긴다', () => {
    expect(
      pruneImpliedCellIds(['apply1', 'apply1'], { rows: rows(), ownCellId: 'benefit1', groups }),
    ).toEqual(['apply1']);
  });
});

describe('열 일괄 적용 — 같은 위치 관계로', () => {
  it('바꿀 칸 수는 같은 열의 다른 출발 자격 칸이다 — 단독 선택 보기·가려진 칸은 세지 않는다', () => {
    expect(countColumnImpliedSelectionTargets(rows(), 'benefit1', { groups })).toBe(2);
    // 알고 있음 열 — 마지막 줄은 병합의 시작 칸이지만 단독 선택 보기다
    expect(countColumnImpliedSelectionTargets(rows(), 'know1', { groups })).toBe(2);
  });

  it('기준 칸에서 대상까지의 행·열 차이를 같은 열의 다른 칸에 옮긴다', () => {
    const plan = planColumnImpliedSelection(rows(), 'benefit1', ['apply1'], { groups });
    expect(plan).toEqual({ benefit2: ['apply2'], benefit3: ['apply3'] });
  });

  it('대상이 여럿이고 다른 행에 있어도 차이를 그대로 옮긴다. 옮긴 자리가 표 밖이면 그 짝만 뺀다', () => {
    const plan = planColumnImpliedSelection(rows(), 'benefit1', ['apply1', 'know2'], { groups });
    // benefit3 의 「한 줄 아래 알고 있음」은 단독 선택 보기 줄이라 자격이 없다
    expect(plan).toEqual({ benefit2: ['apply2', 'know3'], benefit3: ['apply3'] });
  });

  it('기준 칸의 짝이 비면 같은 열의 짝을 지우는 계획이다', () => {
    expect(planColumnImpliedSelection(rows(), 'benefit1', [], { groups })).toEqual({
      benefit2: [],
      benefit3: [],
    });
  });

  it('계획을 적용하면 그 칸들의 짝이 바뀌고 빈 목록은 키를 지운다. 기준 칸은 건드리지 않는다', () => {
    const table = rows().map((row) => ({
      ...row,
      cells: row.cells.map((cell) =>
        cell.id === 'benefit3' ? { ...cell, impliedCellIds: ['know1'] } : cell,
      ),
    }));
    const next = applyImpliedSelectionPlan(table, { benefit2: ['apply2'], benefit3: [] });
    expect(cellOf(next, 'benefit2').impliedCellIds).toEqual(['apply2']);
    expect(cellOf(next, 'benefit3')).not.toHaveProperty('impliedCellIds');
    expect(cellOf(next, 'benefit1')).toBe(cellOf(table, 'benefit1'));
  });

  it('바꿀 것이 없는 행은 원본 참조를 지킨다', () => {
    const table = rows();
    const next = applyImpliedSelectionPlan(table, { benefit2: ['apply2'] });
    expect(next[0]).toBe(table[0]);
    expect(next[1]).not.toBe(table[1]);
  });
});

describe('labelImpliedSelectionCells — 빌더에 보일 칸 이름', () => {
  const columns = [
    { id: 'c0', label: '항목' },
    { id: 'c1', label: '알고 있음' },
    { id: 'c2', label: '지원 경험 있음' },
    { id: 'c3', label: '수혜 경험 있음' },
  ];

  it('행 제목 · 열 제목으로 부른다', () => {
    const labels = labelImpliedSelectionCells({ rows: rows(), columns });
    expect(labels.get('apply2')).toBe('항목 2 · 지원 경험 있음');
  });

  it('행 제목도 열 제목도 없는 칸은 위치로 부른다', () => {
    const bare: TableRow[] = [
      { id: 'r1', label: '', cells: [opt('a', 'g-know'), opt('b', 'g-apply')] },
    ];
    const labels = labelImpliedSelectionCells({
      rows: bare,
      columns: [
        { id: 'c0', label: '' },
        { id: 'c1', label: '' },
      ],
    });
    expect(labels.get('b')).toBe('1행 2열');
  });
});

describe('보기 소스 표 — 그룹 없는 체크박스 문항', () => {
  const bare = (id: string, extra: Partial<TableCell> = {}): TableCell => ({
    id,
    type: 'choice_opt',
    content: '',
    ...extra,
  });
  const table: TableRow[] = [
    { id: 'r1', label: 'TV', cells: [{ id: 't1', type: 'text', content: 'TV' }, bare('tv')] },
    { id: 'r2', label: '냉장고', cells: [{ id: 't2', type: 'text', content: '냉장고' }, bare('fridge')] },
    {
      id: 'r3',
      label: '없음',
      cells: [{ id: 't3', type: 'text', content: '없음' }, bare('none', { exclusiveChoice: true })],
    },
  ];
  const scope = { groups: [], ungroupedSelectionType: 'checkbox' as const };

  it('문항 전체가 한 묶음이라 다른 보기 칸이 후보다 — 단독 선택 보기는 뺀다', () => {
    expect(listImpliedSelectionCandidates(table, 'tv', scope)).toEqual(['fridge']);
  });

  it('라디오 문항이면 후보가 없다', () => {
    expect(
      listImpliedSelectionCandidates(table, 'tv', { groups: [], ungroupedSelectionType: 'radio' }),
    ).toEqual([]);
  });

  it('열 일괄 적용도 같은 위치 관계로 옮긴다', () => {
    expect(countColumnImpliedSelectionTargets(table, 'fridge', scope)).toBe(1);
    // 냉장고 → 한 줄 위(TV). TV 의 한 줄 위는 표 밖이라 짝이 없다
    expect(planColumnImpliedSelection(table, 'fridge', ['tv'], scope)).toEqual({ tv: [] });
  });
});
