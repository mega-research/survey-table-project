import { describe, expect, it } from 'vitest';

import type { ChoiceGroup, HeaderCell, TableCell, TableColumn, TableRow } from '@/types/survey';

import {
  type ProjectRowScaleLayoutInput,
  type RowScaleSegment,
  projectRowScaleLayout,
} from './row-scale-bars';

/**
 * 「행별 척도」의 한 행 — 보기 모양이 척도 슬라이더인 묶음. 슬라이더 조각이 생기기 전까지는 원본 한 줄로
 * 고른 묶음과 같이 그 묶음 열의 원본 표 조각이다(막대 폴백이 아니라 이유도 남지 않는다). 슬라이더 조각이
 * 생기면 이 파일의 기대가 바뀐다.
 */

const CIRC = ['①', '②', '③', '④', '⑤'];
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
    head('h-lo', '불만족', 2),
    head('h-mid', '보통', 1),
    head('h-hi', '만족', 2),
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
  scaleSlider: 'positive-right',
};
const useCells: TableCell[] = [
  { id: 'use1', type: 'choice_opt', content: '①', choiceGroupId: 'g-use' },
  { id: 'use2', type: 'choice_opt', content: '②', choiceGroupId: 'g-use' },
];
const satCells: TableCell[] = CIRC.map((content, n) => ({
  id: `sat${n}`,
  type: 'choice_opt',
  content,
  choiceGroupId: 'g-sat',
}));
const row: TableRow = {
  id: 'r1',
  label: '회의실 지원',
  cells: [{ id: 'item-cell', type: 'text', content: '회의실 지원' }, ...useCells, ...satCells],
};

function input(overrides: Partial<ProjectRowScaleLayoutInput> = {}): ProjectRowScaleLayoutInput {
  return {
    columns,
    barHeaderGrid: HEADER,
    pieceHeaderGrid: HEADER,
    showPieceHeader: true,
    row,
    choiceGroups: [USE, SAT],
    ungroupedSelectionType: null,
    ...overrides,
  };
}

const kinds = (segments: RowScaleSegment[] | null) =>
  segments?.map((segment) =>
    segment.kind === 'bar'
      ? `bar:${segment.bar.key}`
      : segment.kind === 'tiles'
        ? `tiles:${segment.group.id}`
        : `original:${segment.piece.columns.map((c) => c.id).join(',')}`,
  ) ?? null;

describe('projectRowScaleLayout — 척도 슬라이더 묶음', () => {
  it('슬라이더 묶음은 그 묶음 열의 원본 조각이고 막대 폴백 이유는 남지 않는다', () => {
    const layout = projectRowScaleLayout(input());
    expect(kinds(layout.segments)).toEqual(['tiles:g-use', 'original:s0,s1,s2,s3,s4']);
    expect(layout.fallbacks).toEqual([]);
  });

  it('척도 막대 필드가 함께 켜져 있어도 막대가 되지 않는다', () => {
    const layout = projectRowScaleLayout(
      input({ choiceGroups: [USE, { ...SAT, mobileScaleBar: true }] }),
    );
    expect(kinds(layout.segments)).toEqual(['tiles:g-use', 'original:s0,s1,s2,s3,s4']);
    expect(layout.fallbacks).toEqual([]);
  });

  it('행의 묶음이 슬라이더뿐이면 행 전체를 원본 표 조각으로 그린다', () => {
    const onlySat: TableRow = {
      ...row,
      cells: [row.cells[0]!, { id: 'pad1', type: 'text', content: '' }, { id: 'pad2', type: 'text', content: '' }, ...satCells],
    };
    const layout = projectRowScaleLayout(input({ row: onlySat, choiceGroups: [SAT] }));
    expect(layout.segments).toBeNull();
    expect(layout.fallbacks).toEqual([]);
  });

  it('체크박스 묶음에 적힌 슬라이더 방향은 읽지 않는다 — 제 보기 모양(세로 타일) 그대로다', () => {
    const layout = projectRowScaleLayout(
      input({ choiceGroups: [USE, { ...SAT, type: 'checkbox' }] }),
    );
    expect(kinds(layout.segments)).toEqual(['tiles:g-use', 'tiles:g-sat']);
  });
});
