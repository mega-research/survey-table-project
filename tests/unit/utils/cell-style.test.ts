import { describe, expect, it } from 'vitest';
import {
  getCellBackgroundStyle,
  getCellTextClassName,
  normalizeCellHexColor,
} from '@/utils/cell-style';

describe('cell style', () => {
  it.each([
    ['abc', '#AABBCC'],
    ['#abc', '#AABBCC'],
    ['a1b2c3', '#A1B2C3'],
    ['#A1B2C3', '#A1B2C3'],
  ])('HEX %s를 canonical 색상으로 정규화한다', (raw, expected) => {
    expect(normalizeCellHexColor(raw)).toBe(expected);
  });

  it.each(['', '#12', 'GGGGGG', '#12345', '#12345678'])(
    '잘못된 HEX %s는 거부한다',
    (raw) => expect(normalizeCellHexColor(raw)).toBeNull(),
  );

  it('스타일 필드가 없으면 렌더링 기본값을 건드리지 않는다', () => {
    expect(getCellBackgroundStyle({})).toBeUndefined();
    expect(getCellTextClassName({})).toBeUndefined();
  });

  it('명시 스타일만 렌더링 값으로 변환한다', () => {
    expect(getCellBackgroundStyle({ backgroundColor: '#AABBCC' })).toEqual({
      backgroundColor: '#AABBCC',
    });
    expect(getCellTextClassName({ textBold: true })).toBe('font-bold');
  });
});
