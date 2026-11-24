import { describe, expect, it } from 'vitest';

import { MOBILE_TABLE_DISPLAY_MODES } from '@/types/mobile-table-display';
import type { Question, TableCell } from '@/types/survey';

import {
  choiceTableHasScaleSliderRow,
  resolveChoiceTableRenderedDisplay,
  resolveRenderedTableDisplay,
} from './scale-slider-table-layout';

/**
 * 지금 유효한 표시 방식 — 슬라이더가 배치를 가져간 표에서 호스트가 읽을 값(CONTEXT.md 「척도 슬라이더」).
 *
 * 저작자가 고른 모바일 표시 방식을 호스트가 직접 견주면, 슬라이더가 행 단위 배치로 바꾼 화면에 그 방식
 * 전용 장치가 샌다. 그래서 「실제로 그려지는 방식」을 한 곳에서 내고 호스트는 그 값만 읽는다.
 */

describe('resolveRenderedTableDisplay — 지금 유효한 표시 방식', () => {
  it('슬라이더로 그려지는 행이 없고 폭이 넓으면 격자 표다 — 유효한 방식은 저작 값, 화면을 정하는 방식은 없다', () => {
    for (const mobileMode of MOBILE_TABLE_DISPLAY_MODES) {
      expect(
        resolveRenderedTableDisplay({ hasSliderRow: false, narrow: false, mobileMode }),
      ).toEqual({ layout: 'unchanged', mode: mobileMode, activeMode: null });
    }
  });

  it('슬라이더로 그려지는 행이 없고 폭이 좁으면 저작자가 고른 방식 그대로다', () => {
    for (const mobileMode of MOBILE_TABLE_DISPLAY_MODES) {
      expect(
        resolveRenderedTableDisplay({ hasSliderRow: false, narrow: true, mobileMode }),
      ).toEqual({ layout: 'unchanged', mode: mobileMode, activeMode: mobileMode });
    }
  });

  it('그려지는 행이 있고 폭이 넓으면 무엇을 골랐든 「행별 척도」가 화면을 정한다', () => {
    for (const mobileMode of MOBILE_TABLE_DISPLAY_MODES) {
      expect(
        resolveRenderedTableDisplay({ hasSliderRow: true, narrow: false, mobileMode }),
      ).toEqual({ layout: 'row-wise', mode: 'row-wise-scale', activeMode: 'row-wise-scale' });
    }
  });

  it('그려지는 행이 있고 폭이 좁으면 「행 단위 그룹 카드」만 그대로이고 그 밖은 전부 「행별 척도」다', () => {
    for (const mobileMode of MOBILE_TABLE_DISPLAY_MODES) {
      const expected =
        mobileMode === 'row-group-cards'
          ? { layout: 'row-group-cards', mode: 'row-group-cards', activeMode: 'row-group-cards' }
          : { layout: 'row-wise', mode: 'row-wise-scale', activeMode: 'row-wise-scale' };
      expect(resolveRenderedTableDisplay({ hasSliderRow: true, narrow: true, mobileMode })).toEqual(
        expected,
      );
    }
  });
});

const NAMES = ['매우 불만족', '불만족', '보통', '만족', '매우 만족'];
const CIRC = ['①', '②', '③', '④', '⑤'];

function choiceTable(extra: Partial<Question>, editCell: (cell: TableCell) => TableCell = (c) => c) {
  return {
    id: 'q1',
    type: 'radio',
    title: '만족도',
    required: false,
    order: 0,
    tableColumns: [
      { id: 'item', label: '구분' },
      ...NAMES.map((label, n) => ({ id: `s${n}`, label })),
    ],
    tableRowsData: [
      {
        id: 'r1',
        label: '주차',
        cells: [
          { id: 'r1-item', type: 'text', content: '주차' },
          ...CIRC.map((content, n) =>
            editCell({
              id: `r1-sat${n}`,
              type: 'choice_opt',
              content,
              choiceLabel: NAMES[n]!,
            }),
          ),
        ],
      },
    ],
    ...extra,
  } as unknown as Question;
}
const inGroup = (cell: TableCell): TableCell => ({ ...cell, choiceGroupId: 'g-sat' });
const SAT_GROUP = { id: 'g-sat', groupKey: 'rad1', type: 'radio' as const, label: '만족도' };

describe('보기 소스 표 — 문항에서 바로 읽는 판정', () => {
  it('그룹의 보기 모양이 슬라이더면 그려지는 행이 있다', () => {
    const question = choiceTable(
      { choiceGroups: [{ ...SAT_GROUP, scaleSlider: 'positive-right' }] },
      inGroup,
    );
    expect(choiceTableHasScaleSliderRow(question)).toBe(true);
  });

  it('그룹 없는 라디오 표는 문항 설정이 켠다', () => {
    expect(choiceTableHasScaleSliderRow(choiceTable({ scaleSlider: 'positive-left' }))).toBe(true);
    expect(choiceTableHasScaleSliderRow(choiceTable({}))).toBe(false);
    expect(choiceTableHasScaleSliderRow(choiceTable({ scaleSlider: null }))).toBe(false);
  });

  it('표가 없는 문항과 슬라이더 설정이 없는 표는 그려지는 행이 없다', () => {
    expect(
      choiceTableHasScaleSliderRow({ type: 'radio', scaleSlider: 'positive-right' } as Question),
    ).toBe(false);
    expect(choiceTableHasScaleSliderRow(choiceTable({ choiceGroups: [SAT_GROUP] }, inGroup))).toBe(
      false,
    );
  });

  it('유효한 표시 방식은 문항의 표시 방식 설정과 슬라이더 판정을 함께 읽는다', () => {
    const slider = choiceTable(
      {
        mobileTableDisplayMode: 'axis-cards',
        choiceGroups: [{ ...SAT_GROUP, scaleSlider: 'positive-right' }],
      },
      inGroup,
    );
    expect(resolveChoiceTableRenderedDisplay(slider, true).activeMode).toBe('row-wise-scale');
    expect(resolveChoiceTableRenderedDisplay(slider, false).activeMode).toBe('row-wise-scale');

    const plain = choiceTable(
      { mobileTableDisplayMode: 'axis-cards', choiceGroups: [SAT_GROUP] },
      inGroup,
    );
    expect(resolveChoiceTableRenderedDisplay(plain, true).activeMode).toBe('axis-cards');
    expect(resolveChoiceTableRenderedDisplay(plain, false).activeMode).toBeNull();
    // 표시 방식 값이 없으면 종전 폴백 그대로다 — 「모바일 원본 표」 옛 스위치, 없으면 자동
    expect(resolveChoiceTableRenderedDisplay(choiceTable({}), true).activeMode).toBe('auto');
    expect(
      resolveChoiceTableRenderedDisplay(choiceTable({ mobileOriginalTable: true }), true).activeMode,
    ).toBe('original');
  });
});
