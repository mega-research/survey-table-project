import { describe, expect, it } from 'vitest';

import type { ChoiceGroup, Question, TableCell, TableColumn, TableRow } from '@/types/survey';

import {
  canChoiceTableUseQuestionScaleSlider,
  resolveChoiceTableQuestionSliderDirection,
  tableHasScaleSliderRow,
} from './scale-slider-table-layout';

/**
 * 묶음 없는 보기 소스 표의 척도 슬라이더 — 묶음별 설정이 없어 **문항 설정**(`Question.scaleSlider`)이 켠다
 * (CONTEXT.md 「척도 슬라이더」). 읽는 조건은 한 곳이고 응답 호스트와 빌더의 스위치가 같이 쓴다.
 */

const CIRC = ['①', '②', '③', '④', '⑤'];
const columns: TableColumn[] = [
  { id: 'item', label: '평가항목' },
  ...CIRC.map((_, n) => ({ id: `s${n}`, label: `${n + 1}점` })),
];
const scaleRow = (id: string, edit: (cell: TableCell, n: number) => TableCell = (c) => c): TableRow => ({
  id,
  label: id,
  cells: [
    { id: `${id}-item`, type: 'text', content: id },
    ...CIRC.map((content, n) => edit({ id: `${id}-sat${n}`, type: 'choice_opt', content }, n)),
  ],
});
const RADIO_GROUP: ChoiceGroup = { id: 'g1', groupKey: 'rad1', type: 'radio', label: '만족도' };
const CHECKBOX_GROUP: ChoiceGroup = { id: 'g2', groupKey: 'chk1', type: 'checkbox', label: '경험' };
const RANKING_GROUP: ChoiceGroup = { id: 'g3', groupKey: 'rank1', type: 'ranking', label: '순위' };

const question = (extra: Partial<Question>): Question =>
  ({
    id: 'q1',
    type: 'radio',
    title: '만족도',
    required: false,
    order: 0,
    tableColumns: columns,
    tableRowsData: [scaleRow('r1')],
    ...extra,
  }) as unknown as Question;

describe('canChoiceTableUseQuestionScaleSlider — 문항 설정이 켜는 표인가', () => {
  it('라디오 문항이고 라디오·체크박스 묶음이 하나도 없으면 참이다', () => {
    expect(canChoiceTableUseQuestionScaleSlider({ type: 'radio', choiceGroups: [] })).toBe(true);
    expect(canChoiceTableUseQuestionScaleSlider({ type: 'radio', choiceGroups: undefined })).toBe(
      true,
    );
  });

  it('라디오 묶음이 있으면 거짓이다 — 그 표는 묶음 설정만 따른다', () => {
    expect(
      canChoiceTableUseQuestionScaleSlider({ type: 'radio', choiceGroups: [RADIO_GROUP] }),
    ).toBe(false);
  });

  it('체크박스 묶음만 있어도 거짓이다 — 응답이 묶음 맵인 표다', () => {
    expect(
      canChoiceTableUseQuestionScaleSlider({ type: 'radio', choiceGroups: [CHECKBOX_GROUP] }),
    ).toBe(false);
  });

  it('순위 묶음만 있는 표는 묶음 없는 표다', () => {
    expect(
      canChoiceTableUseQuestionScaleSlider({ type: 'radio', choiceGroups: [RANKING_GROUP] }),
    ).toBe(true);
  });

  it('체크박스 문항은 대상이 아니다', () => {
    expect(canChoiceTableUseQuestionScaleSlider({ type: 'checkbox', choiceGroups: [] })).toBe(false);
  });
});

describe('resolveChoiceTableQuestionSliderDirection — 보기 소스 표가 읽는 문항 설정', () => {
  it('묶음 없는 라디오 보기 소스 표는 문항의 방향을 읽는다', () => {
    expect(resolveChoiceTableQuestionSliderDirection(question({ scaleSlider: 'positive-left' }))).toBe(
      'positive-left',
    );
  });

  it('값이 없거나 null(빌더가 끈 값)이거나 어휘 밖이면 꺼진 것이다', () => {
    expect(resolveChoiceTableQuestionSliderDirection(question({}))).toBeNull();
    expect(resolveChoiceTableQuestionSliderDirection(question({ scaleSlider: null }))).toBeNull();
    expect(
      resolveChoiceTableQuestionSliderDirection(
        question({ scaleSlider: 'up' as unknown as 'positive-right' }),
      ),
    ).toBeNull();
  });

  it('묶음이 있는 표는 문항 설정이 켜져 있어도 읽지 않는다', () => {
    expect(
      resolveChoiceTableQuestionSliderDirection(
        question({ scaleSlider: 'positive-right', choiceGroups: [RADIO_GROUP] }),
      ),
    ).toBeNull();
  });

  it('체크박스 문항은 값이 실려 있어도 읽지 않는다', () => {
    expect(
      resolveChoiceTableQuestionSliderDirection(
        question({ type: 'checkbox', scaleSlider: 'positive-right' }),
      ),
    ).toBeNull();
  });
});

describe('tableHasScaleSliderRow — 묶음 없는 보기 칸', () => {
  const base = {
    columns,
    rows: [scaleRow('r1'), scaleRow('r2')],
    choiceGroups: [] as ChoiceGroup[],
    ungroupedSelectionType: 'radio' as const,
  };

  it('문항 설정의 방향이 있고 그려지는 행이 있으면 참이다', () => {
    expect(tableHasScaleSliderRow({ ...base, ungroupedSliderDirection: 'positive-right' })).toBe(
      true,
    );
  });

  it('방향이 없으면 거짓이다 — 묶음 설정도 없는 표는 지금과 같다', () => {
    expect(tableHasScaleSliderRow(base)).toBe(false);
    expect(tableHasScaleSliderRow({ ...base, ungroupedSliderDirection: null })).toBe(false);
  });

  it('방향은 있는데 모든 행이 폴백이면 거짓이다', () => {
    const withDetail = (id: string) =>
      scaleRow(id, (cell, n) => (n === 4 ? { ...cell, allowTextInput: true } : cell));
    expect(
      tableHasScaleSliderRow({
        ...base,
        rows: [withDetail('r1'), withDetail('r2')],
        ungroupedSliderDirection: 'positive-right',
      }),
    ).toBe(false);
  });

  it('행마다 보기 칸이 하나뿐인 표(행이 곧 보기)는 그려지는 행이 없다', () => {
    const optionRow = (id: string): TableRow => ({
      id,
      label: id,
      cells: [
        { id: `${id}-item`, type: 'text', content: id },
        { id: `${id}-pick`, type: 'choice_opt', content: '', choiceLabel: id },
      ],
    });
    expect(
      tableHasScaleSliderRow({
        columns: columns.slice(0, 2),
        rows: [optionRow('r1'), optionRow('r2'), optionRow('r3')],
        choiceGroups: [],
        ungroupedSelectionType: 'radio',
        ungroupedSliderDirection: 'positive-right',
      }),
    ).toBe(false);
  });
});
