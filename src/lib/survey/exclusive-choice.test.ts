import { describe, expect, it } from 'vitest';

import type { TableCell } from '@/types/survey';

import {
  applyExclusiveSelection,
  applyTableExclusiveToGroups,
  choiceValueKey,
  collectExclusiveChoiceCellIds,
  collectExclusiveChoiceCellIdsFromRows,
  collectTableExclusiveChoiceCellIds,
  hasTableExclusiveSelected,
  satisfiesMinSelections,
} from './exclusive-choice';

const isExclusive = (id: string) => id === 'none' || id === 'dontknow';

describe('단독 선택 보기 — 선택 규칙', () => {
  it('단독 선택 보기를 고르면 같은 그룹의 나머지가 전부 풀리고 그것만 남는다', () => {
    const result = applyExclusiveSelection(['a', 'b'], 'none', isExclusive);
    expect(result.next).toEqual(['none']);
    expect(result.released).toEqual(['a', 'b']);
  });

  it('일반 보기를 고르면 단독 선택 보기가 풀리고 일반 보기가 쌓인다', () => {
    const result = applyExclusiveSelection(['none'], 'a', isExclusive);
    expect(result.next).toEqual(['a']);
    expect(result.released).toEqual(['none']);
  });

  it('단독 선택 보기끼리도 배타 — 「모름」을 고르면 「없음」이 풀린다', () => {
    const result = applyExclusiveSelection(['none'], 'dontknow', isExclusive);
    expect(result.next).toEqual(['dontknow']);
    expect(result.released).toEqual(['none']);
  });

  it('단독 선택 보기가 없는 그룹은 기존처럼 뒤에 붙는다', () => {
    const result = applyExclusiveSelection(['a'], 'b', () => false);
    expect(result.next).toEqual(['a', 'b']);
    expect(result.released).toEqual([]);
  });

  it('값이 객체여도(기타 상세기재 선택값) 판정 함수가 결정한다', () => {
    const other = { selectedValue: 'a', text: '메모' };
    const result = applyExclusiveSelection<unknown>([other], 'none', (v) => v === 'none');
    expect(result.next).toEqual(['none']);
    expect(result.released).toEqual([other]);
  });
});

describe('단독 선택 보기 — 최소 선택 수', () => {
  it('단독 선택 보기 하나로 최소 선택 수를 충족한 것으로 본다', () => {
    expect(satisfiesMinSelections(['none'], 2, isExclusive)).toBe(true);
  });

  it('일반 보기만 있으면 개수로 판정한다', () => {
    expect(satisfiesMinSelections(['a'], 2, isExclusive)).toBe(false);
    expect(satisfiesMinSelections(['a', 'b'], 2, isExclusive)).toBe(true);
  });

  it('최소 선택 수가 없거나 0 이면 항상 충족이다', () => {
    expect(satisfiesMinSelections([], undefined, isExclusive)).toBe(true);
    expect(satisfiesMinSelections([], 0, isExclusive)).toBe(true);
  });
});

describe('단독 선택 보기 — 셀 수집과 값 키', () => {
  const cells: TableCell[] = [
    { id: 'a', type: 'choice_opt', content: '', choiceGroupId: 'g1' },
    { id: 'none1', type: 'choice_opt', content: '', choiceGroupId: 'g1', exclusiveChoice: true },
    { id: 'none2', type: 'choice_opt', content: '', choiceGroupId: 'g2', exclusiveChoice: true },
    { id: 'txt', type: 'text', content: '없음', exclusiveChoice: true },
  ];

  it('choice_opt 셀의 플래그만 세고, 그룹을 주면 그 그룹만 남는다', () => {
    expect([...collectExclusiveChoiceCellIds(cells)]).toEqual(['none1', 'none2']);
    expect([...collectExclusiveChoiceCellIds(cells, 'g2')]).toEqual(['none2']);
  });

  it('행 데이터에서 모을 때 숨은 셀은 뺀다', () => {
    const rows = [
      {
        id: 'r1',
        label: '',
        cells: [
          ...cells,
          { id: 'hid', type: 'choice_opt', content: '', exclusiveChoice: true, isHidden: true } as TableCell,
        ],
      },
    ];
    expect(collectExclusiveChoiceCellIdsFromRows(rows).has('hid')).toBe(false);
    expect(collectExclusiveChoiceCellIdsFromRows(rows).has('none1')).toBe(true);
  });

  it('값 키 — 문자열은 그대로, 기타 객체는 selectedValue, 그 외는 undefined', () => {
    expect(choiceValueKey('9')).toBe('9');
    expect(choiceValueKey({ selectedValue: '9', text: '메모' })).toBe('9');
    expect(choiceValueKey(3)).toBeUndefined();
  });
});

describe('단독 선택 보기 — 표 전체 범위', () => {
  const cells: TableCell[] = [
    { id: 'tv-now', type: 'choice_opt', content: '', choiceGroupId: 'g1' },
    { id: 'tv-plan', type: 'choice_opt', content: '', choiceGroupId: 'g2' },
    { id: 'none-plan', type: 'choice_opt', content: '', choiceGroupId: 'g2', exclusiveChoice: true, exclusiveScope: 'table' },
    { id: 'none-group', type: 'choice_opt', content: '', choiceGroupId: 'g1', exclusiveChoice: true },
  ];
  const tableIds = collectTableExclusiveChoiceCellIds(cells);

  it('범위가 표 전체인 단독 선택 보기만 모은다', () => {
    expect([...tableIds]).toEqual(['none-plan']);
  });

  it('표 전체 단독 보기를 고르면 다른 그룹의 선택이 전부 풀린다', () => {
    const next = applyTableExclusiveToGroups(
      { cb1: ['tv-now'], rad1: 'x', cb2: ['none-plan'] },
      'cb2',
      'none-plan',
      tableIds,
    );
    expect(next).toEqual({ cb2: ['none-plan'] });
  });

  it('다른 그룹에서 일반 보기를 고르면 표 전체 단독 보기가 풀린다', () => {
    const next = applyTableExclusiveToGroups(
      { cb1: ['tv-now'], cb2: ['none-plan'] },
      'cb1',
      'tv-now',
      tableIds,
    );
    expect(next).toEqual({ cb1: ['tv-now'] });
  });

  it('라디오 그룹에 있는 표 전체 단독 보기도 풀린다', () => {
    const next = applyTableExclusiveToGroups(
      { cb1: ['tv-now'], rad2: 'none-plan' },
      'cb1',
      'tv-now',
      new Set(['none-plan']),
    );
    expect(next).toEqual({ cb1: ['tv-now'] });
  });

  it('그룹 범위 단독 보기는 다른 그룹을 건드리지 않는다', () => {
    const next = applyTableExclusiveToGroups(
      { cb1: ['none-group'], cb2: ['tv-plan'] },
      'cb1',
      'none-group',
      tableIds,
    );
    expect(next).toEqual({ cb1: ['none-group'], cb2: ['tv-plan'] });
  });

  it('선택 맵에 표 전체 단독 보기가 들어 있는지 판정한다', () => {
    expect(hasTableExclusiveSelected({ cb2: ['none-plan'] }, tableIds)).toBe(true);
    expect(hasTableExclusiveSelected({ rad1: 'none-plan' }, tableIds)).toBe(true);
    expect(hasTableExclusiveSelected({ cb1: ['tv-now'] }, tableIds)).toBe(false);
  });
});
