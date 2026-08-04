import type { CSSProperties } from 'react';

export interface CellVisualStyle {
  textBold?: boolean | undefined;
  backgroundColor?: string | undefined;
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

export interface CellStyleFieldProps {
  textBold: boolean;
  backgroundColor: string;
  onTextBoldChange: (value: boolean) => void;
  onBackgroundColorChange: (value: string) => void;
}

/**
 * 셀의 현재 스타일을 CellStyleFields props 로 바꾸고, 두 콜백을
 * commit(textBold, backgroundColor) 한 번의 호출로 합친다.
 * 한 축을 바꿀 때 다른 축의 현재 값이 함께 실려 나가므로 호출부가 축을 따로 챙기지 않아도 된다.
 */
export function toCellStyleFieldProps(
  style: CellVisualStyle,
  commit: (textBold: boolean, backgroundColor: string) => void,
): CellStyleFieldProps {
  const textBold = style.textBold === true;
  const backgroundColor = style.backgroundColor ?? '';

  return {
    textBold,
    backgroundColor,
    onTextBoldChange: (value) => commit(value, backgroundColor),
    onBackgroundColorChange: (value) => commit(textBold, value),
  };
}
