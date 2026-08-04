import type { CSSProperties } from 'react';

export interface CellVisualStyle {
  textBold?: boolean | undefined;
  backgroundColor?: string | undefined;
  textColor?: string | undefined;
}

/** 셀 스타일의 값 축. 굵게는 boolean 이라 별도로 다룬다. */
export interface CellStyleValues {
  textBold: boolean;
  backgroundColor: string;
  textColor: string;
}

export function normalizeCellHexColor(raw: string): string | null {
  const value = raw.trim().replace(/^#/, '');
  if (/^[0-9a-fA-F]{3}$/.test(value)) {
    return `#${value
      .split('')
      .map((char) => char + char)
      .join('')
      .toUpperCase()}`;
  }
  if (/^[0-9a-fA-F]{6}$/.test(value)) return `#${value.toUpperCase()}`;
  return null;
}

export function getCellBackgroundStyle(
  style: CellVisualStyle,
): CSSProperties | undefined {
  return style.backgroundColor ? { backgroundColor: style.backgroundColor } : undefined;
}

export function getCellTextClassName(style: CellVisualStyle): string | undefined {
  return style.textBold ? 'font-bold' : undefined;
}

/**
 * 글자색을 inline style 로 낸다.
 * 텍스트를 담은 요소에는 대체로 text-gray-800 같은 Tailwind 색 클래스가 이미 붙어 있어
 * 상위 컨테이너의 상속으로는 덮이지 않는다. 그래서 getCellTextClassName 을 쓰는 바로 그 요소에
 * 이 style 을 함께 얹어 클래스보다 우선하게 한다.
 */
export function getCellTextStyle(style: CellVisualStyle): CSSProperties | undefined {
  return style.textColor ? { color: style.textColor } : undefined;
}

export interface CellStyleFieldProps extends CellStyleValues {
  onTextBoldChange: (value: boolean) => void;
  onBackgroundColorChange: (value: string) => void;
  onTextColorChange: (value: string) => void;
}

/**
 * 셀의 현재 스타일을 CellStyleFields props 로 바꾸고, 축별 콜백을
 * commit(values) 한 번의 호출로 합친다.
 * 한 축을 바꿀 때 나머지 축의 현재 값이 함께 실려 나가므로 호출부가 축을 따로 챙기지 않아도 된다.
 */
export function toCellStyleFieldProps(
  style: CellVisualStyle,
  commit: (values: CellStyleValues) => void,
): CellStyleFieldProps {
  const current: CellStyleValues = {
    textBold: style.textBold === true,
    backgroundColor: style.backgroundColor ?? '',
    textColor: style.textColor ?? '',
  };

  return {
    ...current,
    onTextBoldChange: (value) => commit({ ...current, textBold: value }),
    onBackgroundColorChange: (value) => commit({ ...current, backgroundColor: value }),
    onTextColorChange: (value) => commit({ ...current, textColor: value }),
  };
}
