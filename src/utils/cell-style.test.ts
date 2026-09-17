import { describe, expect, it, vi } from 'vitest';
import {
  getCellBackgroundStyle,
  getCellTextClassName,
  normalizeCellHexColor,
  toCellStyleFieldProps,
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

describe('toCellStyleFieldProps', () => {
  it('글자색을 바꾸면 나머지 축의 현재 값을 유지한 채 commit 한다', () => {
    const commit = vi.fn();
    const props = toCellStyleFieldProps({ textBold: true, backgroundColor: '#AABBCC' }, commit);

    props.onTextColorChange('#FFFFFF');

    expect(commit).toHaveBeenCalledWith({
      textBold: true,
      backgroundColor: '#AABBCC',
      textColor: '#FFFFFF',
    });
  });

  it('기존 글자색은 다른 축을 바꿀 때도 실려 나간다', () => {
    const commit = vi.fn();
    const props = toCellStyleFieldProps({ textColor: '#FF0000' }, commit);

    props.onTextBoldChange(true);

    expect(commit).toHaveBeenCalledWith({
      textBold: true,
      backgroundColor: '',
      textColor: '#FF0000',
    });
  });

  it('빈 스타일을 CellStyleFields 가 쓰는 기본값으로 바꾼다', () => {
    const props = toCellStyleFieldProps({}, () => {});

    expect(props.textBold).toBe(false);
    expect(props.backgroundColor).toBe('');
  });

  it('굵게를 바꾸면 기존 배경색을 유지한 채 commit 한다', () => {
    const commit = vi.fn();
    const props = toCellStyleFieldProps({ backgroundColor: '#AABBCC' }, commit);

    props.onTextBoldChange(true);

    expect(commit).toHaveBeenCalledWith({
      textBold: true,
      backgroundColor: '#AABBCC',
      textColor: '',
    });
  });

  it('배경색을 바꾸면 기존 굵게를 유지한 채 commit 한다', () => {
    const commit = vi.fn();
    const props = toCellStyleFieldProps({ textBold: true }, commit);

    props.onBackgroundColorChange('#112233');

    expect(commit).toHaveBeenCalledWith({
      textBold: true,
      backgroundColor: '#112233',
      textColor: '',
    });
  });

  it('배경색을 비우면 빈 문자열로 commit 한다', () => {
    const commit = vi.fn();
    const props = toCellStyleFieldProps({ backgroundColor: '#AABBCC' }, commit);

    props.onBackgroundColorChange('');

    expect(commit).toHaveBeenCalledWith({
      textBold: false,
      backgroundColor: '',
      textColor: '',
    });
  });
});
