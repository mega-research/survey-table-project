import type { HeaderCell, TableColumn } from '@/types/survey';
import { normalizeCellHexColor } from '@/utils/cell-style';

export interface HeaderBulkStyle {
  textBold: boolean;
  backgroundColor: string;
}

export interface AppliedHeaderStyle {
  columns: TableColumn[];
  headerGrid: HeaderCell[][] | undefined;
}

function withHeaderStyle<T extends TableColumn | HeaderCell>(
  value: T,
  textBold: boolean,
  backgroundColor: string | undefined,
): T {
  const next = { ...value };
  if (textBold) next.textBold = true;
  else delete next.textBold;
  if (backgroundColor) next.backgroundColor = backgroundColor;
  else delete next.backgroundColor;
  return next;
}

export function applyHeaderBulkStyle(
  columns: TableColumn[],
  headerGrid: HeaderCell[][] | undefined,
  style: HeaderBulkStyle,
): AppliedHeaderStyle {
  let backgroundColor: string | undefined;
  if (style.backgroundColor) {
    const normalizedColor = normalizeCellHexColor(style.backgroundColor);
    if (!normalizedColor) {
      throw new Error('유효하지 않은 헤더 배경색입니다.');
    }
    backgroundColor = normalizedColor;
  }

  return {
    columns: columns.map((column) => withHeaderStyle(
      column,
      style.textBold,
      backgroundColor,
    )),
    headerGrid: headerGrid?.map((row) => row.map((cell) => withHeaderStyle(
      cell,
      style.textBold,
      backgroundColor,
    ))),
  };
}

export function getCommonHeaderStyle(
  columns: TableColumn[],
  headerGrid: HeaderCell[][] | undefined,
): HeaderBulkStyle {
  const headers = [...columns, ...(headerGrid?.flat() ?? [])];
  const first = headers[0];
  if (!first) return { textBold: false, backgroundColor: '' };

  const textBold = first.textBold === true;
  const backgroundColor = first.backgroundColor ?? '';
  const isUniform = headers.every((header) => (
    (header.textBold === true) === textBold
    && (header.backgroundColor ?? '') === backgroundColor
  ));

  return isUniform
    ? { textBold, backgroundColor }
    : { textBold: false, backgroundColor: '' };
}
