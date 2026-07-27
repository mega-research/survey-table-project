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
