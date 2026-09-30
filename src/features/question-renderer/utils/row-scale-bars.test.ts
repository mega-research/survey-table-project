import { describe, expect, it } from 'vitest';

import {
  type ProjectRowScaleLayoutInput,
  type RowScaleSegment,
  projectRowScaleLayout,
} from '@/features/question-renderer/utils/row-scale-bars';
import type { ChoiceGroup, HeaderCell, TableCell, TableColumn, TableRow } from '@/types/survey';

// 해운물류 멘토 C4 모양 한 행 — 항목 글자 · 활용 여부 2칸 · 만족도 11칸(⓪~⑩).
const CIRC = ['⓪', '①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧', '⑨', '⑩'];
const head = (id: string, label: string, colspan: number): HeaderCell => ({
  id,
  label,
  colspan,
  rowspan: 1,
});
const HEADER: HeaderCell[][] = [
  [
    head('h-item', '평가항목', 1),
    head('h-u1', '활용함', 1),
    head('h-u2', '활용 안함', 1),
    head('h-0', '매우 불만족', 1),
    head('h-neg', '불만족', 4),
    head('h-5', '보통', 1),
    head('h-pos', '만족', 4),
    head('h-10', '매우 만족', 1),
  ],
];
const columns: TableColumn[] = [
  { id: 'item', label: '평가항목' },
  { id: 'u1', label: '활용함' },
  { id: 'u2', label: '활용 안함' },
  ...CIRC.map((_, n) => ({ id: `s${n}`, label: '' })),
];
const USE: ChoiceGroup = { id: 'g-use', groupKey: 'rad1', type: 'radio', label: '활용 여부' };
const SAT: ChoiceGroup = {
  id: 'g-sat',
  groupKey: 'rad2',
  type: 'radio',
  label: '만족도',
  mobileScaleBar: true,
};
const useCells: TableCell[] = [
  { id: 'use1', type: 'choice_opt', content: '①', choiceGroupId: 'g-use' },
  { id: 'use2', type: 'choice_opt', content: '②', choiceGroupId: 'g-use' },
];
const satCells = (edit: (cell: TableCell, n: number) => TableCell = (c) => c): TableCell[] =>
  CIRC.map((content, n) =>
    edit({ id: `sat${n}`, type: 'choice_opt', content, choiceGroupId: 'g-sat' }, n),
  );
const row = (cells: TableCell[]): TableRow => ({
  id: 'r1',
  label: '회의실 지원',
  cells: [{ id: 'item-cell', type: 'text', content: '회의실 지원' }, ...cells],
});

function input(overrides: Partial<ProjectRowScaleLayoutInput> = {}): ProjectRowScaleLayoutInput {
  return {
    columns,
    barHeaderGrid: HEADER,
    pieceHeaderGrid: HEADER,
    showPieceHeader: true,
    row: row([...useCells, ...satCells()]),
    choiceGroups: [USE, SAT],
    ungroupedSelectionType: null,
    ...overrides,
  };
}

const kinds = (segments: RowScaleSegment[] | null) =>
  segments?.map((segment) =>
    segment.kind === 'bar'
      ? `bar:${segment.bar.key}`
      : `original:${segment.piece.columns.map((c) => c.id).join(',')}`,
  ) ?? null;

describe('projectRowScaleLayout — 행별 척도의 한 행', () => {
  it('「척도 막대」로 고른 그룹만 막대, 나머지 응답 칸은 열 순서대로 원본 표 조각이다', () => {
    const layout = projectRowScaleLayout(input());
    // 항목 글자만 있는 열은 응답 칸이 없어 조각이 되지 않는다(행 제목이 이미 보인다)
    expect(kinds(layout.segments)).toEqual(['original:u1,u2', 'bar:g-sat']);
    expect(layout.fallbacks).toEqual([]);
  });

  it('막대 칸 글자와 구간은 막대용 헤더에서, 조각의 헤더는 조각용 헤더에서 잘라 온다', () => {
    const layout = projectRowScaleLayout(input());
    const [piece, bar] = layout.segments!;
    if (piece?.kind !== 'original' || bar?.kind !== 'bar') throw new Error('모양이 다르다');
    expect(bar.bar.model.anchors).toEqual({
      left: '매우 불만족',
      middle: { label: '보통', index: 5 },
      right: '매우 만족',
    });
    expect(piece.piece.headerGrid?.[0]?.map((h) => h.label)).toEqual(['활용함', '활용 안함']);
    expect(piece.piece.showColumnHeader).toBe(true);
  });

  it('원본 조각에 헤더를 그리지 않는 설정이면 조각에 헤더가 없어도 막대 라벨은 남는다', () => {
    const layout = projectRowScaleLayout(
      input({ pieceHeaderGrid: undefined, showPieceHeader: false }),
    );
    const [piece, bar] = layout.segments!;
    if (piece?.kind !== 'original' || bar?.kind !== 'bar') throw new Error('모양이 다르다');
    expect(piece.piece.showColumnHeader).toBe(false);
    expect(bar.bar.model.anchors.middle?.label).toBe('보통');
  });

  it('막대로 고른 그룹이 없으면 행 전체가 원본 표 조각이다(segments null)', () => {
    const { mobileScaleBar: _bar, ...tiles } = SAT;
    const layout = projectRowScaleLayout(input({ choiceGroups: [USE, tiles] }));
    expect(layout.segments).toBeNull();
    expect(layout.fallbacks).toEqual([]);
  });

  it('입력칸은 막대 뒤 원본 조각으로 남는다', () => {
    const layout = projectRowScaleLayout(
      input({
        row: row([...useCells, ...satCells(), { id: 'memo', type: 'input', content: '' }]),
        columns: [...columns, { id: 'memo-col', label: '메모' }],
      }),
    );
    expect(kinds(layout.segments)).toEqual(['original:u1,u2', 'bar:g-sat', 'original:memo-col']);
  });

  it('막대로 고른 그룹을 못 그리면 그 그룹 열은 원본 조각으로 떨어지고 이유가 남는다', () => {
    const layout = projectRowScaleLayout(
      input({
        row: row([
          ...useCells,
          ...satCells((cell, n) => (n === 10 ? { ...cell, allowTextInput: true } : cell)),
        ]),
      }),
    );
    expect(layout.segments).toBeNull();
    expect(layout.fallbacks).toEqual([{ key: 'g-sat', group: SAT, reason: 'text-input' }]);
  });

  it('그룹이 둘이고 하나만 폴백하면 폴백한 그룹은 원본 조각, 다른 그룹은 막대다', () => {
    const second: ChoiceGroup = { ...SAT, id: 'g-sat2', groupKey: 'rad3' };
    const cells = [
      ...satCells().slice(0, 5),
      ...satCells()
        .slice(5)
        .map((cell, n) => ({
          ...cell,
          choiceGroupId: 'g-sat2',
          ...(n === 0 ? { exclusiveChoice: true } : {}),
        })),
    ];
    const layout = projectRowScaleLayout(
      input({
        row: row([...useCells, ...cells]),
        choiceGroups: [USE, SAT, second],
        barHeaderGrid: undefined,
      }),
    );
    expect(kinds(layout.segments)).toEqual([
      'original:u1,u2',
      'bar:g-sat',
      'original:s5,s6,s7,s8,s9,s10',
    ]);
    expect(layout.fallbacks.map((f) => [f.key, f.reason])).toEqual([
      ['g-sat2', 'exclusive-choice'],
    ]);
  });

  it('그룹 없는 보기 칸은 보기 소스 표에서 모드만으로 막대다 — 이어진 묶음마다 하나', () => {
    const plain = satCells().map(({ choiceGroupId: _g, ...cell }) => cell);
    const layout = projectRowScaleLayout(
      input({
        row: row([
          ...plain.slice(0, 4),
          { id: 'gap', type: 'input', content: '' },
          ...plain.slice(4),
        ]),
        columns: [
          ...columns.slice(0, 1),
          ...CIRC.slice(0, 4).map((_, n) => ({ id: `a${n}`, label: '' })),
          { id: 'gap-col', label: '' },
          ...CIRC.slice(4).map((_, n) => ({ id: `b${n}`, label: '' })),
        ],
        barHeaderGrid: undefined,
        pieceHeaderGrid: undefined,
        choiceGroups: [],
        ungroupedSelectionType: 'radio',
      }),
    );
    expect(kinds(layout.segments)).toEqual(['bar:run:sat0', 'original:gap-col', 'bar:run:sat4']);
  });

  it('checkbox 문항의 그룹 없는 보기 칸은 복수 선택이라 폴백한다', () => {
    const plain = satCells().map(({ choiceGroupId: _g, ...cell }) => cell);
    const layout = projectRowScaleLayout(
      input({ row: row(plain), choiceGroups: [], ungroupedSelectionType: 'checkbox' }),
    );
    expect(layout.segments).toBeNull();
    expect(layout.fallbacks.map((f) => f.reason)).toEqual(['not-single-choice']);
  });

  it('표 문항의 그룹 없는 보기 칸은 막대 후보가 아니다', () => {
    const plain = satCells().map(({ choiceGroupId: _g, ...cell }) => cell);
    const layout = projectRowScaleLayout(input({ row: row(plain), choiceGroups: [] }));
    expect(layout).toEqual({ segments: null, fallbacks: [] });
  });

  it('숨은 칸은 조각을 만들지 않는다', () => {
    const layout = projectRowScaleLayout(
      input({
        row: row([
          ...useCells,
          ...satCells(),
          { id: 'hidden-memo', type: 'input', content: '', isHidden: true },
        ]),
        columns: [...columns, { id: 'x', label: '' }],
      }),
    );
    expect(kinds(layout.segments)).toEqual(['original:u1,u2', 'bar:g-sat']);
  });
});
