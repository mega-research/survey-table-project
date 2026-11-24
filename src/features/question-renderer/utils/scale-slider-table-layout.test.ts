import { describe, expect, it } from 'vitest';

import { MOBILE_TABLE_DISPLAY_MODES } from '@/types/mobile-table-display';
import type { ChoiceGroup, HeaderCell, TableCell, TableColumn, TableRow } from '@/types/survey';

import { resolveScaleSliderTableLayout, tableHasScaleSliderRow } from './scale-slider-table-layout';

/**
 * 표 배치 판정 — 슬라이더가 켜진 표를 어느 배치로 그리는가(스펙 「3. 화면」의 표).
 * 재료는 셋이다: 슬라이더로 그려지는 행이 있는가 · 폭 · 모바일 표시 방식.
 */

const CIRC = ['①', '②', '③', '④', '⑤'];
const head = (id: string, label: string, colspan: number): HeaderCell => ({
  id,
  label,
  colspan,
  rowspan: 1,
});
const HEADER: HeaderCell[][] = [
  [head('h-item', '평가항목', 1), head('h-lo', '불만족', 2), head('h-mid', '보통', 1), head('h-hi', '만족', 2)],
];
const columns: TableColumn[] = [
  { id: 'item', label: '평가항목' },
  ...CIRC.map((_, n) => ({ id: `s${n}`, label: '' })),
];
const SAT: ChoiceGroup = {
  id: 'g-sat',
  groupKey: 'rad1',
  type: 'radio',
  label: '만족도',
  scaleSlider: 'positive-right',
};
const scaleRow = (id: string, edit: (cell: TableCell, n: number) => TableCell = (c) => c): TableRow => ({
  id,
  label: id,
  cells: [
    { id: `${id}-item`, type: 'text', content: id },
    ...CIRC.map((content, n) =>
      edit({ id: `${id}-sat${n}`, type: 'choice_opt', content, choiceGroupId: 'g-sat' }, n),
    ),
  ],
});
/** 상세 기재 보기가 낀 행 — 슬라이더로 그릴 수 없다 */
const fallbackRow = (id: string) =>
  scaleRow(id, (cell, n) => (n === 4 ? { ...cell, allowTextInput: true } : cell));

describe('resolveScaleSliderTableLayout — 표 배치 판정', () => {
  it('슬라이더로 그려지는 행이 없으면 폭·표시 방식과 무관하게 지금과 같다', () => {
    for (const narrow of [false, true]) {
      for (const mobileMode of MOBILE_TABLE_DISPLAY_MODES) {
        expect(resolveScaleSliderTableLayout({ hasSliderRow: false, narrow, mobileMode })).toBe(
          'unchanged',
        );
      }
    }
  });

  it('그려지는 행이 있고 폭이 넓으면 표시 방식과 무관하게 행 단위 배치다', () => {
    for (const mobileMode of MOBILE_TABLE_DISPLAY_MODES) {
      expect(resolveScaleSliderTableLayout({ hasSliderRow: true, narrow: false, mobileMode })).toBe(
        'row-wise',
      );
    }
  });

  it('그려지는 행이 있고 폭이 좁으며 「행 단위 그룹 카드」면 그 카드 안에서 그린다', () => {
    expect(
      resolveScaleSliderTableLayout({
        hasSliderRow: true,
        narrow: true,
        mobileMode: 'row-group-cards',
      }),
    ).toBe('row-group-cards');
  });

  it('그려지는 행이 있고 폭이 좁으면 그 밖의 표시 방식은 전부 행 단위 배치다', () => {
    for (const mobileMode of MOBILE_TABLE_DISPLAY_MODES) {
      if (mobileMode === 'row-group-cards') continue;
      expect(resolveScaleSliderTableLayout({ hasSliderRow: true, narrow: true, mobileMode })).toBe(
        'row-wise',
      );
    }
  });
});

describe('tableHasScaleSliderRow — 슬라이더로 그려지는 행이 있는가', () => {
  const base = { columns, headerGrid: HEADER, ungroupedSelectionType: null } as const;

  it('슬라이더 묶음이 그려지는 행이 하나라도 있으면 참이다', () => {
    expect(
      tableHasScaleSliderRow({
        ...base,
        rows: [fallbackRow('r1'), scaleRow('r2')],
        choiceGroups: [SAT],
      }),
    ).toBe(true);
  });

  it('슬라이더 설정이 없으면 거짓이다 — 척도 막대·원본 한 줄 묶음은 세지 않는다', () => {
    const plain: ChoiceGroup = { id: 'g-sat', groupKey: 'rad1', type: 'radio', label: '만족도' };
    for (const group of [
      plain,
      { ...plain, mobileScaleBar: true },
      { ...plain, mobileOriginalLine: true },
    ] satisfies ChoiceGroup[]) {
      expect(
        tableHasScaleSliderRow({ ...base, rows: [scaleRow('r1')], choiceGroups: [group] }),
      ).toBe(false);
    }
  });

  it('설정은 있는데 모든 행이 폴백이면 거짓이다 — 배치는 지금과 같다', () => {
    const hasSliderRow = tableHasScaleSliderRow({
      ...base,
      rows: [fallbackRow('r1'), fallbackRow('r2')],
      choiceGroups: [SAT],
    });
    expect(hasSliderRow).toBe(false);
    for (const narrow of [false, true]) {
      expect(
        resolveScaleSliderTableLayout({ hasSliderRow, narrow, mobileMode: 'auto' }),
      ).toBe('unchanged');
    }
  });

  it('체크박스 묶음에 적힌 방향은 읽지 않는다', () => {
    expect(
      tableHasScaleSliderRow({
        ...base,
        rows: [scaleRow('r1')],
        choiceGroups: [{ ...SAT, type: 'checkbox' }],
      }),
    ).toBe(false);
  });

  it('슬라이더 묶음의 칸이 하나도 없는 표는 거짓이다', () => {
    const textOnly: TableRow = {
      id: 'r1',
      label: 'r1',
      cells: columns.map((column) => ({ id: `t-${column.id}`, type: 'text', content: '' })),
    };
    expect(tableHasScaleSliderRow({ ...base, rows: [textOnly], choiceGroups: [SAT] })).toBe(false);
  });
});
