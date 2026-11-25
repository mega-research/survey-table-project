import type { HeaderCell, TableColumn } from '@/types/survey';
import { type CellStyleValues, normalizeCellHexColor } from '@/utils/cell-style';

/** 머리글 한 칸의 굵기·색 — 칸마다 고치는 자리가 쓴다 */
export type HeaderCellStyle = CellStyleValues;

/** 전체 헤더 스타일 — 굵기·색에 오른쪽 세로선 숨김을 더한 네 축. 적용하면 모든 머리글이 이 값이 된다 */
export interface HeaderBulkStyle extends CellStyleValues {
  hideRightBorder: boolean;
}

export interface AppliedHeaderStyle {
  columns: TableColumn[];
  headerGrid: HeaderCell[][] | undefined;
}

export interface HeaderStyleState extends HeaderBulkStyle {
  /** 헤더 간 스타일이 균일하지 않은지 */
  isMixed: boolean;
  /** 배경색·글자색·굵게·오른쪽 세로선 숨김 중 하나라도 지정된 헤더 수 */
  styledCount: number;
}

const EMPTY_STYLE: HeaderBulkStyle = {
  textBold: false,
  backgroundColor: '',
  textColor: '',
  hideRightBorder: false,
};

/** 오른쪽 세로선 숨김을 켜고 끈다 — 끄면 키를 지운다(JSONB 에 false 를 남기지 않는다) */
export function withHeaderRightBorder<T extends TableColumn | HeaderCell>(
  value: T,
  hidden: boolean,
): T {
  const next = { ...value };
  if (hidden) next.hideRightBorder = true;
  else delete next.hideRightBorder;
  return next;
}

export function withHeaderStyle<T extends TableColumn | HeaderCell>(
  value: T,
  style: HeaderCellStyle,
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
    hideRightBorder: style.hideRightBorder,
  };
  const apply = <T extends TableColumn | HeaderCell>(header: T): T =>
    withHeaderRightBorder(withHeaderStyle(header, normalized), normalized.hideRightBorder);

  return {
    columns: columns.map(apply),
    headerGrid: headerGrid?.map((row) => row.map(apply)),
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
    || header.hideRightBorder === true
  )).length;

  const first = headers[0];
  if (!first) {
    return { ...EMPTY_STYLE, isMixed: false, styledCount };
  }

  const common: HeaderBulkStyle = {
    textBold: first.textBold === true,
    backgroundColor: first.backgroundColor ?? '',
    textColor: first.textColor ?? '',
    hideRightBorder: first.hideRightBorder === true,
  };
  const isUniform = headers.every((header) => (
    (header.textBold === true) === common.textBold
    && (header.backgroundColor ?? '') === common.backgroundColor
    && (header.textColor ?? '') === common.textColor
    && (header.hideRightBorder === true) === common.hideRightBorder
  ));

  return isUniform
    ? { ...common, isMixed: false, styledCount }
    : { ...EMPTY_STYLE, isMixed: true, styledCount };
}
