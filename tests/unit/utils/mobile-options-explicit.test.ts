import { describe, expect, it } from 'vitest';

import type { TableCell } from '@/types/survey';
import {
  overrideCellOptionsColumnsForCard,
  resolveMobileOptionsColumns,
} from '@/utils/mobile-card-options';

function radioCell(overrides: Partial<TableCell>): TableCell {
  return {
    id: 'cell-1',
    content: '',
    type: 'radio',
    radioOptions: [
      { id: 'opt-0', label: '남성', value: '1' },
      { id: 'opt-1', label: '여성', value: '2' },
    ],
    ...overrides,
  };
}

describe('resolveMobileOptionsColumns', () => {
  it('명시값이 있으면 휴리스틱 대신 그 값을 반환한다', () => {
    expect(resolveMobileOptionsColumns(4, ['남성', '여성'])).toBe(4);
    expect(resolveMobileOptionsColumns(0, ['남성', '여성'])).toBe(0);
  });

  it('null/undefined 면 라벨 길이 휴리스틱으로 폴백한다', () => {
    expect(resolveMobileOptionsColumns(null, ['남성', '여성'])).toBe(2);
    expect(resolveMobileOptionsColumns(undefined, ['열 글자를 확실히 넘는 아주 긴 라벨'])).toBe(1);
  });
});

describe('overrideCellOptionsColumnsForCard — mobileOptionsColumns 우선', () => {
  it('셀 명시값이 있으면 휴리스틱과 가로 한 줄 예외보다 우선한다', () => {
    const cell = radioCell({ optionsColumns: 0, mobileOptionsColumns: 3 });
    expect(overrideCellOptionsColumnsForCard(cell).optionsColumns).toBe(3);
  });

  it('명시값이 기존 optionsColumns 와 같으면 원본 참조를 반환한다', () => {
    const cell = radioCell({ optionsColumns: 2, mobileOptionsColumns: 2 });
    expect(overrideCellOptionsColumnsForCard(cell)).toBe(cell);
  });

  it('명시값이 없으면 기존 휴리스틱 동작이 유지된다', () => {
    expect(overrideCellOptionsColumnsForCard(radioCell({})).optionsColumns).toBe(2);
    expect(overrideCellOptionsColumnsForCard(radioCell({ optionsColumns: 0 })).optionsColumns).toBe(0);
  });
});
