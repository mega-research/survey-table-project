import { describe, expect, it } from 'vitest';

import {
  type ChoiceGroupOriginalLine,
  projectChoiceGroupOriginalLine,
  resolveWideTextInputFields,
} from '@/features/question-renderer/utils/choice-group-original-line';
import type { ChoiceGroup, HeaderCell, TableCell, TableColumn, TableRow } from '@/types/survey';

// 지원제도 표(해운물류 멘토 C4) 모양 — 구분·항목·활용 여부 2칸·만족도 11칸, 헤더 2단.
const col = (id: string, label: string): TableColumn => ({ id, label });
const columns: TableColumn[] = [
  col('category', '구분'),
  col('item', '평가항목'),
  col('use1', '활용함'),
  col('use2', '활용 안함'),
  ...Array.from({ length: 11 }, (_, n) => col(`s${n}`, `${n}점`)),
];
const head = (id: string, label: string, colspan: number, rowspan = 1): HeaderCell => ({
  id,
  label,
  colspan,
  rowspan,
  textBold: true,
});
const headerGrid: HeaderCell[][] = [
  [
    head('h-cat', '구분', 1, 2),
    head('h-item', '평가항목', 1, 2),
    head('h-use', '활용 여부', 2),
    head('h-sat', '만족도', 11),
  ],
  [
    head('h-u1', '활용함', 1),
    head('h-u2', '활용 안함', 1),
    head('h-0', '매우 불만족', 1),
    head('h-neg', '불만족', 4),
    head('h-5', '보통', 1),
    head('h-pos', '만족', 4),
    head('h-10', '매우 만족', 1),
  ],
];
const choice = (id: string, groupId: string, extra: Partial<TableCell> = {}): TableCell => ({
  id,
  type: 'choice_opt',
  content: id,
  choiceGroupId: groupId,
  ...extra,
});
const useCells = [choice('u1', 'g-use'), choice('u2', 'g-use')];
const scaleCells = Array.from({ length: 11 }, (_, n) => choice(`c${n}`, 'g-sat'));
const row: TableRow = {
  id: 'r1',
  label: '회의실 및 교통비 지원',
  cells: [
    { id: 'cat', type: 'text', content: '지원 제도', rowspan: 3 },
    { id: 'item', type: 'text', content: '회의실 및 교통비 지원' },
    ...useCells,
    ...scaleCells,
  ],
};
const satGroup: ChoiceGroup = {
  id: 'g-sat',
  groupKey: 'rad2',
  type: 'radio',
  label: '만족도',
  mobileOriginalLine: true,
};

const base = { columns, headerGrid, hideColumnLabels: false, row, groupCells: scaleCells };

describe('projectChoiceGroupOriginalLine', () => {
  it('그룹 열만 잘라 낸 원본 표 조각 — 열 11개, 2단 헤더, 보기 셀만 남은 행', () => {
    const line = projectChoiceGroupOriginalLine({ ...base, group: satGroup });
    expect(line).not.toBeNull();
    expect(line!.columns.map((c) => c.id)).toEqual(scaleCells.map((_, n) => `s${n}`));
    expect(line!.headerGrid!.map((r) => r.map((h) => [h.label, h.colspan]))).toEqual([
      [['만족도', 11]],
      [
        ['매우 불만족', 1],
        ['불만족', 4],
        ['보통', 1],
        ['만족', 4],
        ['매우 만족', 1],
      ],
    ]);
    expect(line!.showColumnHeader).toBe(true);
    expect(line!.row.id).toBe('r1');
    expect(line!.row.cells.map((c) => c.id)).toEqual(scaleCells.map((c) => c.id));
  });

  it('옵션을 켜지 않은 그룹·순위 그룹은 null — 종전 타일로 그린다', () => {
    expect(
      projectChoiceGroupOriginalLine({
        ...base,
        group: { ...satGroup, mobileOriginalLine: false },
      }),
    ).toBeNull();
    expect(projectChoiceGroupOriginalLine({ ...base, group: undefined })).toBeNull();
    expect(
      projectChoiceGroupOriginalLine({ ...base, group: { ...satGroup, type: 'ranking' } }),
    ).toBeNull();
  });

  it('척도 막대 그룹도 조각을 만든다 — 막대를 못 그릴 때의 폴백', () => {
    const { mobileOriginalLine: _off, ...rest } = satGroup;
    const line = projectChoiceGroupOriginalLine({
      ...base,
      group: { ...rest, mobileScaleBar: true },
    });
    expect(line!.row.cells.map((c) => c.id)).toEqual(scaleCells.map((c) => c.id));
  });

  it('상세기재 보기가 있어도 원본 조각으로 그린다 — 입력칸은 원본 셀이 그린다', () => {
    const withText = scaleCells.map((cell, n) =>
      n === 10 ? { ...cell, allowTextInput: true } : cell,
    );
    const line = projectChoiceGroupOriginalLine({
      ...base,
      group: satGroup,
      groupCells: withText,
      row: { ...row, cells: [...row.cells.slice(0, 4), ...withText] },
    });
    expect(line!.row.cells.at(-1)!.allowTextInput).toBe(true);
  });

  it('구분 셀의 행 병합은 조각에 남기지 않는다', () => {
    const line = projectChoiceGroupOriginalLine({
      ...base,
      group: { ...satGroup },
      groupCells: [...useCells],
    });
    expect(line!.row.cells.every((c) => c.rowspan === undefined)).toBe(true);
  });

  it('헤더 그리드가 없으면 열 제목으로, 열 제목을 숨겼으면 헤더 없이', () => {
    const noGrid = projectChoiceGroupOriginalLine({
      ...base,
      group: satGroup,
      headerGrid: undefined,
    });
    expect(noGrid!.headerGrid).toBeUndefined();
    expect(noGrid!.showColumnHeader).toBe(true);
    const hidden = projectChoiceGroupOriginalLine({
      ...base,
      group: satGroup,
      headerGrid: undefined,
      hideColumnLabels: true,
    });
    expect(hidden!.showColumnHeader).toBe(false);
  });

  it('보기 셀이 열과 짝이 안 맞으면 null', () => {
    expect(
      projectChoiceGroupOriginalLine({ ...base, group: satGroup, columns: columns.slice(0, 5) }),
    ).toBeNull();
  });
});

describe('resolveWideTextInputFields — 넓은 화면에서 라벨 + 넓은 입력칸으로 풀 조각', () => {
  const input = (id: string, extra: Partial<TableCell> = {}): TableCell => ({
    id,
    type: 'input',
    content: '',
    ...extra,
  });
  const piece = (
    cells: TableCell[],
    extra: Partial<ChoiceGroupOriginalLine> = {},
  ): ChoiceGroupOriginalLine => ({
    columns: cells.map((cell) => ({ id: `col-${cell.id}`, label: `${cell.id} 열` })),
    row: { id: 'r1', label: '', cells },
    showColumnHeader: true,
    ...extra,
  });

  it('칸이 전부 글자 입력칸이면 칸마다 열 이름과 함께 돌려준다', () => {
    const memo = input('memo');
    const note = input('note', { inputType: 'text' });
    expect(resolveWideTextInputFields(piece([memo, note]))).toEqual([
      { cell: memo, label: 'memo 열' },
      { cell: note, label: 'note 열' },
    ]);
  });

  it('형식 있는 입력칸이 끼면 조각으로 둔다 — 폭이 곧 뜻이다', () => {
    expect(resolveWideTextInputFields(piece([input('n', { inputType: 'number' })]))).toBeNull();
    expect(
      resolveWideTextInputFields(piece([input('memo'), input('tel', { inputType: 'phone' })])),
    ).toBeNull();
  });

  it('보기 칸·글자 칸이 섞인 조각은 조각으로 둔다', () => {
    expect(resolveWideTextInputFields(piece([choice('u1', 'g-use'), input('memo')]))).toBeNull();
    expect(
      resolveWideTextInputFields(piece([{ id: 't', type: 'text', content: '단위' }, input('memo')])),
    ).toBeNull();
  });

  it('숨은 칸·병합으로 이어진 칸은 세지 않고, 남는 칸이 없으면 조각으로 둔다', () => {
    const memo = input('memo');
    expect(
      resolveWideTextInputFields(piece([{ ...choice('u1', 'g-use'), isHidden: true }, memo])),
    ).toEqual([{ cell: memo, label: 'memo 열' }]);
    expect(resolveWideTextInputFields(piece([{ ...memo, isHidden: true }]))).toBeNull();
  });

  it('머리를 숨긴 조각은 라벨이 비고, 다단 헤더가 있으면 그 열만 덮는 머리 이름을 읽는다', () => {
    const memo = input('memo');
    expect(resolveWideTextInputFields(piece([memo], { showColumnHeader: false }))).toEqual([
      { cell: memo, label: '' },
    ]);
    expect(
      resolveWideTextInputFields(piece([memo], { headerGrid: [[head('h-memo', '개선 의견', 1)]] })),
    ).toEqual([{ cell: memo, label: '개선 의견' }]);
  });
});
