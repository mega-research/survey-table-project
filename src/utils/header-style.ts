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

export interface HeaderStyleState extends HeaderBulkStyle {
  /** 헤더 간 스타일이 균일하지 않은지 */
  isMixed: boolean;
  /** 배경색이 있거나 textBold 인 헤더 수 */
  styledCount: number;
}

export function withHeaderStyle<T extends TableColumn | HeaderCell>(
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

/**
 * 전체 헤더의 공통 스타일과 혼합 여부를 한 번의 순회로 낸다.
 * isMixed 는 일괄 적용이 개별 작업을 덮어쓰는지 판단하는 트리거다.
 * 이미 일괄로 전부 같은 색을 칠해둔 상태는 잃을 개별 작업이 없으므로 isMixed 가 false 다.
 */
export function getCommonHeaderStyle(
  columns: TableColumn[],
  headerGrid: HeaderCell[][] | undefined,
): HeaderStyleState {
  const headers = [...columns, ...(headerGrid?.flat() ?? [])];

  const styledCount = headers.filter((header) => (
    header.textBold === true || Boolean(header.backgroundColor)
  )).length;

  const first = headers[0];
  if (!first) {
    return { textBold: false, backgroundColor: '', isMixed: false, styledCount };
  }

  const textBold = first.textBold === true;
  const backgroundColor = first.backgroundColor ?? '';
  const isUniform = headers.every((header) => (
    (header.textBold === true) === textBold
    && (header.backgroundColor ?? '') === backgroundColor
  ));

  return isUniform
    ? { textBold, backgroundColor, isMixed: false, styledCount }
    : { textBold: false, backgroundColor: '', isMixed: true, styledCount };
}
