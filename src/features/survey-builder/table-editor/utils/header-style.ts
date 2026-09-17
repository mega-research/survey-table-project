import type { HeaderCell, TableColumn } from '@/types/survey';
import { type CellStyleValues, normalizeCellHexColor } from '@/utils/cell-style';

export type HeaderBulkStyle = CellStyleValues;

export interface AppliedHeaderStyle {
  columns: TableColumn[];
  headerGrid: HeaderCell[][] | undefined;
}

export interface HeaderStyleState extends HeaderBulkStyle {
  /** 헤더 간 스타일이 균일하지 않은지 */
  isMixed: boolean;
  /** 배경색·글자색·굵게 중 하나라도 지정된 헤더 수 */
  styledCount: number;
}

const EMPTY_STYLE: HeaderBulkStyle = {
  textBold: false,
  backgroundColor: '',
  textColor: '',
};

export function withHeaderStyle<T extends TableColumn | HeaderCell>(
  value: T,
  style: HeaderBulkStyle,
): T {
  const next = { ...value };
  if (style.textBold) next.textBold = true;
  else delete next.textBold;
  if (style.backgroundColor) next.backgroundColor = style.backgroundColor;
  else delete next.backgroundColor;
  if (style.textColor) next.textColor = style.textColor;
  else delete next.textColor;
  return next;
}

/** 빈 문자열은 스타일 제거를 뜻하므로 그대로 통과시키고, 값이 있으면 HEX 로 정규화한다. */
function normalizeStyleColor(raw: string, label: string): string {
  if (!raw) return '';
  const normalized = normalizeCellHexColor(raw);
  if (!normalized) {
    throw new Error(`유효하지 않은 헤더 ${label}입니다.`);
  }
  return normalized;
}

export function applyHeaderBulkStyle(
  columns: TableColumn[],
  headerGrid: HeaderCell[][] | undefined,
  style: HeaderBulkStyle,
): AppliedHeaderStyle {
  const normalized: HeaderBulkStyle = {
    textBold: style.textBold,
    backgroundColor: normalizeStyleColor(style.backgroundColor, '배경색'),
    textColor: normalizeStyleColor(style.textColor, '글자색'),
  };

  return {
    columns: columns.map((column) => withHeaderStyle(column, normalized)),
    headerGrid: headerGrid?.map((row) => row.map((cell) => withHeaderStyle(cell, normalized))),
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
    header.textBold === true
    || Boolean(header.backgroundColor)
    || Boolean(header.textColor)
  )).length;

  const first = headers[0];
  if (!first) {
    return { ...EMPTY_STYLE, isMixed: false, styledCount };
  }

  const common: HeaderBulkStyle = {
    textBold: first.textBold === true,
    backgroundColor: first.backgroundColor ?? '',
    textColor: first.textColor ?? '',
  };
  const isUniform = headers.every((header) => (
    (header.textBold === true) === common.textBold
    && (header.backgroundColor ?? '') === common.backgroundColor
    && (header.textColor ?? '') === common.textColor
  ));

  return isUniform
    ? { ...common, isMixed: false, styledCount }
    : { ...EMPTY_STYLE, isMixed: true, styledCount };
}
