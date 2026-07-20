import { describe, expect, it } from 'vitest';

import type { TableCell } from '@/types/survey';
import { overrideCellOptionsColumnsForCard } from '@/utils/mobile-card-options';

/**
 * 모바일 카드는 셀 optionsColumns 를 라벨 길이 휴리스틱(≤10자 → 2열, 초과 → 1열)으로
 * override 하는데, 셀 저작자가 명시한 "가로 한 줄"(optionsColumns === 0, flex-wrap)은
 * 존중해야 한다. 0~10점 스케일처럼 한 글자 라벨 11개짜리 라디오가 2열 그리드로
 * 강제되면 폭을 채우는 wrap 흐름이 사라진다.
 */

function radioCell(overrides: Partial<TableCell>): TableCell {
  return {
    id: 'cell-1',
    content: '',
    type: 'radio',
    radioOptions: Array.from({ length: 11 }, (_, i) => ({
      id: `opt-${i}`,
      label: String.fromCharCode(0x24ea + i), // ⓪①…⑩ 한 글자 라벨
      value: String(i),
    })),
    ...overrides,
  };
}

describe('overrideCellOptionsColumnsForCard', () => {
  it('가로 한 줄(optionsColumns=0) 셀은 override 하지 않고 원본 참조를 반환한다', () => {
    const cell = radioCell({ optionsColumns: 0 });
    const result = overrideCellOptionsColumnsForCard(cell);
    expect(result).toBe(cell);
    expect(result.optionsColumns).toBe(0);
  });

  it('짧은 라벨 + 레이아웃 미지정 셀은 기존 휴리스틱대로 2열로 override 한다', () => {
    const cell = radioCell({});
    expect(overrideCellOptionsColumnsForCard(cell).optionsColumns).toBe(2);
  });

  it('10자 초과 라벨 셀은 기존 휴리스틱대로 1열로 override 한다', () => {
    const cell = radioCell({
      radioOptions: [
        { id: 'opt-0', label: '열 글자를 확실히 넘는 아주 긴 라벨', value: '0' },
        { id: 'opt-1', label: '짧은 라벨', value: '1' },
      ],
    });
    expect(overrideCellOptionsColumnsForCard(cell).optionsColumns).toBe(1);
  });

  it('옵션이 없는 셀은 원본 참조를 그대로 반환한다', () => {
    const cell = radioCell({ radioOptions: [] });
    expect(overrideCellOptionsColumnsForCard(cell)).toBe(cell);
  });
});
