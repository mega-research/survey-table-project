import { describe, expect, it } from 'vitest';

import { MOBILE_TABLE_DISPLAY_MODES } from '@/types/survey';
import {
  clampMobileDrilldownOmitLeadingColumns,
  resolveMobileTableDisplayMode,
} from '@/utils/mobile-table-display-mode';

describe('resolveMobileTableDisplayMode', () => {
  it('런타임 registry를 survey 정본 모듈에서 re-export한다', () => {
    expect(MOBILE_TABLE_DISPLAY_MODES).toEqual([
      'auto',
      'drilldown-original-row',
      'original',
    ]);
  });

  it.each([
    ['auto', 'auto'],
    ['drilldown-original-row', 'drilldown-original-row'],
    ['original', 'original'],
  ] as const)('유효 enum %s를 정본으로 사용', (input, expected) => {
    expect(resolveMobileTableDisplayMode({ mobileTableDisplayMode: input, mobileOriginalTable: true }))
      .toBe(expected);
  });

  it('enum 키가 없는 과거 snapshot은 legacy true를 original로 복원', () => {
    expect(resolveMobileTableDisplayMode({ mobileOriginalTable: true })).toBe('original');
  });

  it('유효하지 않은 enum은 legacy boolean 후 auto 순서로 폴백', () => {
    expect(resolveMobileTableDisplayMode({ mobileTableDisplayMode: 'bad', mobileOriginalTable: true }))
      .toBe('original');
    expect(resolveMobileTableDisplayMode({ mobileTableDisplayMode: 'bad' })).toBe('auto');
  });
});

describe('clampMobileDrilldownOmitLeadingColumns', () => {
  it.each([
    [undefined, 11, 1],
    [0, 11, 0],
    [2, 11, 2],
    [99, 11, 10],
    [-2, 11, 0],
    [1.8, 11, 1],
    [1, 1, 0],
    [1, 0, 0],
  ])('값 %s, 열 %s개를 %s로 정규화', (value, count, expected) => {
    expect(clampMobileDrilldownOmitLeadingColumns(value, count)).toBe(expected);
  });
});
