import { describe, expect, it } from 'vitest';

import type { TableCell } from '@/types/survey';

import {
  distinctSubscriptionKeys,
  findDistinctViolations,
  takenDistinctValues,
} from './distinct-select-group';

/**
 * 중복 불가 묶음 — 같은 묶음 이름을 가진 선택 칸끼리는 같은 보기를 두 번 고를 수 없다.
 * 화면의 회색 비활성(takenDistinctValues)과 차단 검증(findDistinctViolations)이 같은 판정을 쓴다.
 */

const OPTIONS = [
  { id: 'o1', label: '미국', value: 'us' },
  { id: 'o2', label: '일본', value: 'jp' },
  { id: 'o3', label: '중국', value: 'cn' },
];

function select(id: string, group?: string, extra: Partial<TableCell> = {}): TableCell {
  return {
    id,
    type: 'select',
    content: '',
    selectOptions: OPTIONS,
    ...(group !== undefined ? { distinctGroup: group } : {}),
    ...extra,
  };
}

/** 2025년 묶음 3칸 + 2026년 묶음 2칸 + 묶음 없는 칸 1 */
const cells: TableCell[] = [
  select('a1', '2025'),
  select('a2', '2025'),
  select('a3', '2025'),
  select('b1', '2026'),
  select('b2', '2026'),
  select('free'),
];

function taken(cellId: string, values: Record<string, unknown>, table = cells): string[] {
  const cell = table.find((c) => c.id === cellId)!;
  return [...takenDistinctValues(cell, table, values)].sort();
}

describe('takenDistinctValues — 이 칸의 목록에서 비활성으로 보일 보기', () => {
  it('같은 묶음의 다른 칸이 고른 보기가 든다', () => {
    expect(taken('a2', { a1: 'us' })).toEqual(['us']);
    expect(taken('a3', { a1: 'us', a2: 'jp' })).toEqual(['jp', 'us']);
  });

  it('자기가 고른 보기는 들지 않는다', () => {
    expect(taken('a1', { a1: 'us' })).toEqual([]);
  });

  it('다른 묶음의 선택은 상관없다 — 2025년에 고른 국가를 2026년에도 고른다', () => {
    expect(taken('b1', { a1: 'us', a2: 'jp' })).toEqual([]);
  });

  it('묶음 이름이 없는 칸은 아무것도 막지 않고 막히지도 않는다', () => {
    expect(taken('free', { a1: 'us' })).toEqual([]);
    expect(taken('a1', { free: 'us' })).toEqual([]);
  });

  it('공백뿐인 이름은 미지정이다', () => {
    const table = [select('x1', '  '), select('x2', '  ')];
    expect(taken('x2', { x1: 'us' }, table)).toEqual([]);
  });

  it('선택 칸이 아닌 칸의 이름은 무시한다', () => {
    const table: TableCell[] = [
      { id: 'in', type: 'input', content: '', distinctGroup: '2025' },
      select('x2', '2025'),
    ];
    expect(taken('x2', { in: 'us' }, table)).toEqual([]);
  });

  it('병합에 가려진 칸은 묶음 구성원이 아니다', () => {
    const table = [select('x1', 'g', { isHidden: true }), select('x2', 'g')];
    expect(taken('x2', { x1: 'us' }, table)).toEqual([]);
  });

  it('셀 게이팅으로 닫힌 칸의 선택은 고른 것으로 치지 않는다', () => {
    const table: TableCell[] = [
      { id: 'amount', type: 'input', content: '', inputType: 'number' },
      select('x1', 'g', {
        enabledWhen: { kind: 'numeric', op: '>', value: 0, controllerCellId: 'amount' },
      }),
      select('x2', 'g'),
    ];
    expect(taken('x2', { x1: 'us' }, table)).toEqual([]);
    expect(taken('x2', { amount: '5', x1: 'us' }, table)).toEqual(['us']);
  });

  it('value 가 없는 보기는 id 로 비교한다', () => {
    const noValue = [
      { id: 'o1', label: '미국' },
      { id: 'o2', label: '일본' },
    ] as NonNullable<TableCell['selectOptions']>;
    const table = [
      select('x1', 'g', { selectOptions: noValue }),
      select('x2', 'g', { selectOptions: noValue }),
    ];
    expect(taken('x2', { x1: 'o1' }, table)).toEqual(['o1']);
  });
});

describe('findDistinctViolations — 같은 묶음에 같은 보기가 둘 이상', () => {
  it('중복이 없으면 빈 목록', () => {
    expect(findDistinctViolations(cells, { a1: 'us', a2: 'jp', b1: 'us' })).toEqual([]);
  });

  it('같은 묶음에서 겹친 칸을 전부 짚는다', () => {
    expect(findDistinctViolations(cells, { a1: 'us', a2: 'jp', a3: 'us' }).sort()).toEqual([
      'a1',
      'a3',
    ]);
  });

  it('묶음마다 따로 본다', () => {
    const values = { a1: 'us', a2: 'us', b1: 'jp', b2: 'jp', free: 'us' };
    expect(findDistinctViolations(cells, values).sort()).toEqual(['a1', 'a2', 'b1', 'b2']);
  });

  it('빈 선택끼리는 중복이 아니다', () => {
    expect(findDistinctViolations(cells, { a1: '', a2: '' })).toEqual([]);
  });
});

/**
 * 게이팅과의 결합 — 칸이 「지금 열려 있는가」는 셀 게이팅 평가기가 정한다. 보기 선택으로 열리는
 * 칸(choice-selected)은 표 응답 안 예약 키의 선택을, 컨트롤러가 다시 게이팅 칸이면 그 상류 값을
 * 봐야 한다 — 빠뜨리면 실제로 열린 칸이 닫힌 것으로 판정되어 중복이 통과한다.
 */
describe('중복 불가 묶음 — 보기 선택 · 상류 게이팅으로 열리는 칸', () => {
  const choiceGated: TableCell[] = [
    { id: 'opt1', type: 'choice_opt', content: '수출함', choiceGroupId: 'g1' },
    select('x1', 'g', { enabledWhen: { kind: 'choice-selected', controllerCellId: 'opt1' } }),
    select('x2', 'g', { enabledWhen: { kind: 'choice-selected', controllerCellId: 'opt1' } }),
  ];

  it('보기를 골라 열린 칸끼리의 중복을 잡는다', () => {
    const values = { x1: 'us', x2: 'us', __choiceGroups: { g1: 'opt1' } };
    expect(findDistinctViolations(choiceGated, values).sort()).toEqual(['x1', 'x2']);
    expect(taken('x2', values, choiceGated)).toEqual(['us']);
  });

  it('보기를 고르지 않아 닫힌 칸의 잔존값은 고른 것으로 치지 않는다', () => {
    const values = { x1: 'us', x2: 'us' };
    expect(findDistinctViolations(choiceGated, values)).toEqual([]);
    expect(taken('x2', values, choiceGated)).toEqual([]);
  });

  it('구독 키에 보기 선택 예약 키가 든다', () => {
    expect(distinctSubscriptionKeys(choiceGated[2]!, choiceGated).sort()).toEqual([
      '__choiceGroups',
      'x1',
    ]);
  });

  it('구독 키에 컨트롤러의 컨트롤러까지 든다', () => {
    const chained: TableCell[] = [
      { id: 'top', type: 'input', content: '', inputType: 'number' },
      {
        id: 'mid',
        type: 'input',
        content: '',
        inputType: 'number',
        enabledWhen: { kind: 'numeric', op: '>', value: 0, controllerCellId: 'top' },
      },
      select('y1', 'g', {
        enabledWhen: { kind: 'numeric', op: '>', value: 0, controllerCellId: 'mid' },
      }),
      select('y2', 'g'),
    ];
    expect(distinctSubscriptionKeys(chained[3]!, chained).sort()).toEqual(['mid', 'top', 'y1']);
    // 상류가 닫히면 중간 컨트롤러의 잔존값은 없는 것이다 → y1 은 닫힌 칸
    expect(taken('y2', { mid: '5', y1: 'us' }, chained)).toEqual([]);
    expect(taken('y2', { top: '1', mid: '5', y1: 'us' }, chained)).toEqual(['us']);
  });
});
