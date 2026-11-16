import { describe, expect, it } from 'vitest';

import type { ChoiceGroup, TableCell } from '@/types/survey';

import {
  applyImpliedSelection,
  applyImpliedSelectionToList,
  canImplySelection,
  hasImpliedSelection,
  isImpliedSelectionTarget,
  resolveImpliedCells,
} from './implied-selection';

/**
 * 따라 선택 — 여성기업 사전 설문조사 C7 모양. 열마다 체크박스 그룹(알고 있음 · 지원 경험 · 수혜 경험),
 * 수혜 → 지원 → 알고 로 같은 행에 짝이 걸려 있다.
 */
const groups: ChoiceGroup[] = [
  { id: 'g-know', groupKey: 'chk01', type: 'checkbox', label: '알고 있음' },
  { id: 'g-apply', groupKey: 'chk02', type: 'checkbox', label: '지원 경험 있음' },
  { id: 'g-benefit', groupKey: 'chk03', type: 'checkbox', label: '수혜 경험 있음' },
  { id: 'g-radio', groupKey: 'rad1', type: 'radio', label: '단일' },
];

const opt = (id: string, choiceGroupId: string, extra: Partial<TableCell> = {}): TableCell => ({
  id,
  type: 'choice_opt',
  content: '',
  choiceGroupId,
  ...extra,
});

function c7Cells(overrides: Record<string, Partial<TableCell>> = {}): TableCell[] {
  const cells: TableCell[] = [];
  for (const row of [1, 2]) {
    cells.push(opt(`know${row}`, 'g-know'));
    cells.push(opt(`apply${row}`, 'g-apply', { impliedCellIds: [`know${row}`] }));
    cells.push(opt(`benefit${row}`, 'g-benefit', { impliedCellIds: [`apply${row}`] }));
  }
  cells.push(opt('benefit-none', 'g-benefit', { exclusiveChoice: true }));
  return cells.map((cell) => ({ ...cell, ...overrides[cell.id] }));
}

const ids = (cells: TableCell[]) => cells.map((cell) => cell.id);
const find = (cells: TableCell[], id: string) => cells.find((cell) => cell.id === id)!;

describe('자격', () => {
  const groupsById = { groups };

  it('체크박스 그룹의 보기 칸은 출발도 대상도 된다', () => {
    const cell = opt('a', 'g-know');
    expect(canImplySelection(cell, groupsById)).toBe(true);
    expect(isImpliedSelectionTarget(cell, groupsById)).toBe(true);
  });

  it.each([
    ['단독 선택 보기', opt('a', 'g-know', { exclusiveChoice: true })],
    ['라디오 그룹의 보기 칸', opt('a', 'g-radio')],
    ['그룹에 속하지 않은 보기 칸', { id: 'a', type: 'choice_opt', content: '' } as TableCell],
    ['없어진 그룹을 가리키는 보기 칸', opt('a', 'g-gone')],
    ['보기 칸이 아닌 칸', { id: 'a', type: 'input', content: '' } as TableCell],
  ])('%s은 출발도 대상도 될 수 없다', (_name, cell) => {
    expect(canImplySelection(cell, groupsById)).toBe(false);
    expect(isImpliedSelectionTarget(cell, groupsById)).toBe(false);
  });

  it('병합에 가려진 칸은 대상이 될 수 없다', () => {
    expect(isImpliedSelectionTarget(opt('a', 'g-know', { isHidden: true }), groupsById)).toBe(
      false,
    );
  });
});

describe('hasImpliedSelection', () => {
  it('짝이 하나라도 걸린 표만 참이다', () => {
    expect(hasImpliedSelection(c7Cells())).toBe(true);
    expect(hasImpliedSelection([opt('a', 'g-know'), opt('b', 'g-apply')])).toBe(false);
    expect(hasImpliedSelection([opt('a', 'g-know', { impliedCellIds: [] })])).toBe(false);
  });
});

describe('resolveImpliedCells — 고른 칸에서 따라 골라질 칸', () => {
  it('사슬을 끝까지 따라간다 — 수혜를 고르면 지원, 알고 있음 순', () => {
    const cells = c7Cells();
    expect(
      ids(resolveImpliedCells(find(cells, 'benefit1'), { tableCells: cells, groups })),
    ).toEqual(['apply1', 'know1']);
  });

  it('지원을 고르면 알고 있음만이다', () => {
    const cells = c7Cells();
    expect(ids(resolveImpliedCells(find(cells, 'apply1'), { tableCells: cells, groups }))).toEqual([
      'know1',
    ]);
  });

  it('짝이 없는 칸은 아무것도 따라 고르지 않는다', () => {
    const cells = c7Cells();
    expect(resolveImpliedCells(find(cells, 'know1'), { tableCells: cells, groups })).toEqual([]);
  });

  it('서로 물리는 짝은 둘 다 고르고 끝난다. 고른 칸 자신은 결과에 없다', () => {
    const cells = [
      opt('a', 'g-know', { impliedCellIds: ['b'] }),
      opt('b', 'g-apply', { impliedCellIds: ['a'] }),
    ];
    expect(ids(resolveImpliedCells(cells[0]!, { tableCells: cells, groups }))).toEqual(['b']);
  });

  it('같은 행·같은 그룹일 필요가 없다', () => {
    const cells = [
      opt('a', 'g-know', { impliedCellIds: ['b', 'c'] }),
      opt('b', 'g-know'),
      opt('c', 'g-benefit'),
    ];
    expect(ids(resolveImpliedCells(cells[0]!, { tableCells: cells, groups }))).toEqual(['b', 'c']);
  });

  it('단독 선택 보기는 짝이 걸려 있어도 따라 선택을 일으키지 않는다', () => {
    const cells = c7Cells({ 'benefit-none': { impliedCellIds: ['know1'] } });
    expect(resolveImpliedCells(find(cells, 'benefit-none'), { tableCells: cells, groups })).toEqual(
      [],
    );
  });

  it.each([
    ['단독 선택 보기가 된 대상', { exclusiveChoice: true }],
    ['병합에 가려진 대상', { isHidden: true }],
    ['보기 칸이 아니게 된 대상', { type: 'input' as const }],
    ['라디오 그룹으로 옮긴 대상', { choiceGroupId: 'g-radio' }],
  ])('%s은 건너뛰고, 그 칸의 짝도 따라가지 않는다', (_name, override) => {
    const cells = c7Cells({ apply1: override });
    expect(resolveImpliedCells(find(cells, 'benefit1'), { tableCells: cells, groups })).toEqual([]);
  });

  it('지워진 칸을 가리키는 짝은 없는 것으로 본다', () => {
    const cells = c7Cells({ benefit1: { impliedCellIds: ['gone', 'apply1'] } });
    expect(
      ids(resolveImpliedCells(find(cells, 'benefit1'), { tableCells: cells, groups })),
    ).toEqual(['apply1', 'know1']);
  });

  it('지금 그려지지 않는 칸은 건너뛴다 — 보이는 칸 집합이 주어졌을 때만 본다', () => {
    const cells = c7Cells();
    const picked = find(cells, 'benefit1');
    const visibleCellIds = new Set(['benefit1', 'apply1']);
    expect(ids(resolveImpliedCells(picked, { tableCells: cells, groups, visibleCellIds }))).toEqual(
      ['apply1'],
    );
    expect(
      ids(resolveImpliedCells(picked, { tableCells: cells, groups, visibleCellIds: null })),
    ).toEqual(['apply1', 'know1']);
  });
});

describe('applyImpliedSelection — 직접 고른 쓰기 뒤의 그룹 선택 맵', () => {
  it('수혜를 고른 맵에 지원·알고 있음을 더한다', () => {
    const cells = c7Cells();
    const next = applyImpliedSelection({ chk03: ['benefit1'] }, find(cells, 'benefit1'), {
      tableCells: cells,
      groups,
    });
    expect(next).toEqual({ chk03: ['benefit1'], chk02: ['apply1'], chk01: ['know1'] });
  });

  it('이미 골라진 것은 그대로 두고 빠진 것만 더한다. 다른 행의 선택은 건드리지 않는다', () => {
    const cells = c7Cells();
    const next = applyImpliedSelection(
      { chk03: ['benefit2', 'benefit1'], chk02: ['apply1'], chk01: ['know2'] },
      find(cells, 'benefit1'),
      { tableCells: cells, groups },
    );
    expect(next).toEqual({
      chk03: ['benefit2', 'benefit1'],
      chk02: ['apply1'],
      chk01: ['know2', 'know1'],
    });
  });

  it('이미 골라진 대상의 너머도 따라간다 — 지원이 체크돼 있어도 알고 있음을 채운다', () => {
    const cells = c7Cells();
    const next = applyImpliedSelection(
      { chk03: ['benefit1'], chk02: ['apply1'] },
      find(cells, 'benefit1'),
      { tableCells: cells, groups },
    );
    expect(next['chk01']).toEqual(['know1']);
  });

  it('짝이 없으면 받은 맵을 그대로 돌려준다', () => {
    const cells = c7Cells();
    const map = { chk01: ['know1'] };
    expect(applyImpliedSelection(map, find(cells, 'know1'), { tableCells: cells, groups })).toBe(
      map,
    );
  });

  it('따라 골라지는 그룹의 단독 선택 보기는 풀린다', () => {
    const cells = [...c7Cells(), opt('know-none', 'g-know', { exclusiveChoice: true })];
    const next = applyImpliedSelection(
      { chk02: ['apply1'], chk01: ['know-none'] },
      find(cells, 'apply1'),
      { tableCells: cells, groups },
    );
    expect(next).toEqual({ chk02: ['apply1'], chk01: ['know1'] });
  });

  it('다른 그룹에 골라져 있던 표 전체 단독 선택 보기도 빠진다', () => {
    const cells = [
      opt('a', 'g-benefit', { impliedCellIds: ['b'] }),
      opt('b', 'g-apply'),
      opt('none', 'g-know', { exclusiveChoice: true, exclusiveScope: 'table' }),
    ];
    const next = applyImpliedSelection({ chk03: ['a'], chk01: ['none'] }, cells[0]!, {
      tableCells: cells,
      groups,
    });
    expect(next).toEqual({ chk03: ['a'], chk02: ['b'] });
  });

  it('같은 그룹 안의 짝은 그 그룹 배열에 더한다', () => {
    const cells = [opt('a', 'g-know', { impliedCellIds: ['b'] }), opt('b', 'g-know')];
    expect(
      applyImpliedSelection({ chk01: ['a'] }, cells[0]!, { tableCells: cells, groups }),
    ).toEqual({ chk01: ['a', 'b'] });
  });
});

describe('보기 소스 표 — 그룹 없는 보기 칸은 문항 유형을 따른다', () => {
  const bare = (id: string, extra: Partial<TableCell> = {}): TableCell => ({
    id,
    type: 'choice_opt',
    content: '',
    ...extra,
  });

  it('체크박스 문항의 그룹 없는 보기 칸은 출발도 대상도 된다', () => {
    const scope = { groups: [], ungroupedSelectionType: 'checkbox' as const };
    expect(canImplySelection(bare('a'), scope)).toBe(true);
    expect(isImpliedSelectionTarget(bare('a'), scope)).toBe(true);
    expect(canImplySelection(bare('a', { exclusiveChoice: true }), scope)).toBe(false);
  });

  it.each([
    ['라디오 문항', 'radio' as const],
    ['테이블 유형 문항', null],
  ])('%s의 그룹 없는 보기 칸은 자격이 없다', (_name, ungroupedSelectionType) => {
    expect(canImplySelection(bare('a'), { groups: [], ungroupedSelectionType })).toBe(false);
  });

  it('그룹 문항에서 그룹 없는 칸·없어진 그룹·순위 그룹의 칸은 문항 유형의 선택 방식을 따른다', () => {
    const scope = {
      groups: [...groups, { id: 'g-rank', groupKey: 'rnk1', type: 'ranking' as const, label: '' }],
      ungroupedSelectionType: 'checkbox' as const,
    };
    for (const cell of [bare('a'), opt('b', 'g-gone'), opt('c', 'g-rank')]) {
      expect(canImplySelection(cell, scope)).toBe(true);
    }
    // 라디오 그룹에 속한 칸은 문항이 체크박스여도 라디오다
    expect(canImplySelection(opt('d', 'g-radio'), scope)).toBe(false);
  });

  it('순위 그룹을 가리키는 칸은 그 그룹의 키 아래에 따라 골라진다 — 화면이 읽는 키(getGroupKeyOfCell)와 같아야 한다', () => {
    const scope = {
      groups: [...groups, { id: 'g-rank', groupKey: 'rnk1', type: 'ranking' as const, label: '' }],
      ungroupedSelectionType: 'checkbox' as const,
    };
    const cells = [opt('a', 'g-know', { impliedCellIds: ['b'] }), opt('b', 'g-rank')];
    expect(
      applyImpliedSelection({ chk01: ['a'] }, cells[0]!, { tableCells: cells, ...scope }),
    ).toEqual({ chk01: ['a'], rnk1: ['b'] });
  });

  it('그룹 문항의 기본 묶음 칸은 응답 맵의 기본 키 아래에 따라 골라진다', () => {
    const cells = [opt('a', 'g-know', { impliedCellIds: ['b'] }), bare('b')];
    expect(
      applyImpliedSelection({ chk01: ['a'] }, cells[0]!, {
        tableCells: cells,
        groups,
        ungroupedSelectionType: 'checkbox',
      }),
    ).toEqual({ chk01: ['a'], default: ['b'] });
  });
});

describe('applyImpliedSelectionToList — 그룹 없는 체크박스 문항의 선택 목록', () => {
  const scope = { groups: [], ungroupedSelectionType: 'checkbox' as const };
  const bare = (id: string, extra: Partial<TableCell> = {}): TableCell => ({
    id,
    type: 'choice_opt',
    content: '',
    ...extra,
  });
  const cells = [
    bare('a', { impliedCellIds: ['b'] }),
    bare('b', { impliedCellIds: ['c'] }),
    bare('c'),
    bare('none', { exclusiveChoice: true }),
  ];

  it('고른 칸 뒤에 사슬의 칸을 더한다. 이미 골라진 칸은 두 번 넣지 않는다', () => {
    expect(applyImpliedSelectionToList(['a'], cells[0]!, { tableCells: cells, ...scope })).toEqual([
      'a',
      'b',
      'c',
    ]);
    expect(
      applyImpliedSelectionToList(['c', 'a'], cells[0]!, { tableCells: cells, ...scope }),
    ).toEqual(['c', 'a', 'b']);
  });

  it('짝이 없으면 받은 목록을 그대로 돌려준다', () => {
    const list = ['c'];
    expect(applyImpliedSelectionToList(list, cells[2]!, { tableCells: cells, ...scope })).toBe(
      list,
    );
  });

  it('목록에 남아 있던 단독 선택 보기는 따라 골라진 칸이 푼다', () => {
    expect(
      applyImpliedSelectionToList(['none', 'a'], cells[0]!, { tableCells: cells, ...scope }),
    ).toEqual(['a', 'b', 'c']);
  });

  it('보이지 않는 칸은 건너뛴다', () => {
    expect(
      applyImpliedSelectionToList(['a'], cells[0]!, {
        tableCells: cells,
        ...scope,
        visibleCellIds: new Set(['a']),
      }),
    ).toEqual(['a']);
  });
});
