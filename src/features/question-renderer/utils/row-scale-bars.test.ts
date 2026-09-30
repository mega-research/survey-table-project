import { describe, expect, it } from 'vitest';

import {
  type ProjectRowScaleBarsInput,
  projectRowScaleBars,
} from '@/features/question-renderer/utils/row-scale-bars';
import type { ChoiceGroup, HeaderCell, TableCell, TableColumn, TableRow } from '@/types/survey';

// 해운물류 멘토 D1 모양 — 항목 1칸 + 0~10점 11칸, 행마다 보기 그룹 하나.
const CIRC = ['⓪', '①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧', '⑨', '⑩'];
const head = (id: string, label: string, colspan: number): HeaderCell => ({
  id,
  label,
  colspan,
  rowspan: 1,
});
const D1_HEADER: HeaderCell[][] = [
  [
    head('h-item', '항목', 1),
    head('h-0', '전혀\n그렇지\n않다', 2),
    head('h-2', '별로\n그렇지\n않다', 3),
    head('h-5', '보통', 1),
    head('h-6', '약간\n그렇다', 3),
    head('h-9', '매우\n그렇다', 2),
  ],
];
const columns: TableColumn[] = [
  { id: 'item', label: '항목' },
  ...CIRC.map((_, n) => ({ id: `s${n}`, label: '' })),
];
const group = (id: string, extra: Partial<ChoiceGroup> = {}): ChoiceGroup => ({
  id,
  groupKey: id,
  type: 'radio',
  label: '',
  ...extra,
});
const scale = (rowId: string, groupId: string | undefined): TableCell[] =>
  CIRC.map((content, n) => ({
    id: `${rowId}-c${n}`,
    type: 'choice_opt',
    content,
    ...(groupId ? { choiceGroupId: groupId } : {}),
  }));
const row = (id: string, cells: TableCell[]): TableRow => ({
  id,
  label: id,
  cells: [{ id: `${id}-item`, type: 'text', content: id }, ...cells],
});

function input(overrides: Partial<ProjectRowScaleBarsInput> = {}): ProjectRowScaleBarsInput {
  return {
    columns,
    headerGrid: D1_HEADER,
    row: row('r1', scale('r1', 'g1')),
    choiceGroups: [group('g1')],
    ungroupedSelectionType: null,
    ...overrides,
  };
}

describe('projectRowScaleBars — 행별 척도', () => {
  it('보기 그룹 하나인 행은 막대 하나 — 구간·가운데 라벨은 헤더에서', () => {
    const result = projectRowScaleBars(input());
    if (!result.ok) throw new Error(result.reason);
    expect(result.bars).toHaveLength(1);
    const [bar] = result.bars;
    expect(bar!.group?.id).toBe('g1');
    expect(bar!.cells.map((cell) => cell.id)).toEqual(CIRC.map((_, n) => `r1-c${n}`));
    expect(bar!.model.cells.map((cell) => cell.text)).toEqual(CIRC);
    expect(bar!.model.anchors).toEqual({
      left: '전혀 그렇지 않다',
      middle: { label: '보통', index: 5 },
      right: '매우 그렇다',
    });
  });

  it('보기 그룹이 둘이면 그룹마다 막대 하나, 행 순서대로', () => {
    const two = [
      ...scale('r1', 'g1').slice(0, 5),
      ...scale('r1', 'g2')
        .slice(5)
        .map((cell) => ({ ...cell })),
    ];
    const result = projectRowScaleBars(
      input({
        row: row('r1', two),
        choiceGroups: [group('g2'), group('g1')],
        headerGrid: undefined,
      }),
    );
    if (!result.ok) throw new Error(result.reason);
    expect(result.bars.map((bar) => bar.group?.id)).toEqual(['g1', 'g2']);
    expect(result.bars.map((bar) => bar.cells.length)).toEqual([5, 6]);
  });

  it('그룹 없는 보기 칸은 연속 묶음마다 막대 하나 — 보기 소스 표의 문항 선택 방식을 쓴다', () => {
    const cells = scale('r1', undefined);
    const split: TableCell[] = [
      ...cells.slice(0, 4),
      { id: 'gap', type: 'text', content: '|' },
      ...cells.slice(4),
    ];
    const result = projectRowScaleBars(
      input({
        row: row('r1', split),
        columns: [...columns, { id: 'extra', label: '' }],
        headerGrid: undefined,
        choiceGroups: [],
        ungroupedSelectionType: 'radio',
      }),
    );
    if (!result.ok) throw new Error(result.reason);
    expect(result.bars.map((bar) => bar.group)).toEqual([undefined, undefined]);
    expect(result.bars.map((bar) => bar.cells.length)).toEqual([4, 7]);
    expect(new Set(result.bars.map((bar) => bar.key)).size).toBe(2);
  });

  it('복수 선택 문항의 그룹 없는 보기 칸은 폴백', () => {
    const result = projectRowScaleBars(
      input({
        row: row('r1', scale('r1', undefined)),
        choiceGroups: [],
        ungroupedSelectionType: 'checkbox',
      }),
    );
    expect(result).toEqual({ ok: false, reason: 'not-single-choice' });
  });

  it('그룹 없는 보기 칸을 답할 수 없는 표(표 문항)에서는 그 칸을 막대로 만들지 않는다', () => {
    const result = projectRowScaleBars(
      input({
        row: row('r1', scale('r1', undefined)),
        choiceGroups: [],
        ungroupedSelectionType: null,
      }),
    );
    expect(result).toEqual({ ok: false, reason: 'cell-count' });
  });

  it('행에 입력칸 같은 다른 응답 칸이 있으면 행 전체가 폴백 — 막대만 그리면 그 칸이 사라진다', () => {
    const cells: TableCell[] = [...scale('r1', 'g1'), { id: 'memo', type: 'input', content: '' }];
    const result = projectRowScaleBars(
      input({ row: row('r1', cells), columns: [...columns, { id: 'memo-col', label: '' }] }),
    );
    expect(result).toEqual({ ok: false, reason: 'non-choice-cell' });
  });

  it('그룹 하나라도 막대로 못 그리면 행 전체가 폴백 — 이유는 그 그룹의 것', () => {
    const cells = scale('r1', 'g1').map((cell, n) =>
      n === 10 ? { ...cell, allowTextInput: true } : cell,
    );
    const result = projectRowScaleBars(input({ row: row('r1', cells) }));
    expect(result).toEqual({ ok: false, reason: 'text-input' });
  });

  it('숨은 칸·병합으로 이어진 칸은 보지 않는다', () => {
    const cells = [
      ...scale('r1', 'g1'),
      { id: 'hidden-input', type: 'input' as const, content: '', isHidden: true },
    ];
    const result = projectRowScaleBars(
      input({ row: row('r1', cells), columns: [...columns, { id: 'x', label: '' }] }),
    );
    expect(result.ok).toBe(true);
  });

  it('순위 그룹 칸은 막대가 아니다', () => {
    const result = projectRowScaleBars(input({ choiceGroups: [group('g1', { type: 'ranking' })] }));
    expect(result).toEqual({ ok: false, reason: 'not-single-choice' });
  });
});
