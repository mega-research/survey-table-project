import type {
  CheckboxOption,
  HeaderCell,
  QuestionOption,
  RadioOption,
  TableCell,
  TableColumn,
  TableRow,
} from '@/types/survey';

import { buildColumnAxisCards } from './column-axis-cards';

/**
 * 「상세 기재 입력칸을 표 아래에」(`TableCell.optionTextBelowTable`) — 체크박스·라디오·선택 칸의
 * 「기타」 입력칸을 좁은 칸 안이 아니라 표 아래 한 줄로 옮긴다.
 *
 * 칸이 좁으면(연도 열 120px 등) 칸 안 입력칸은 라벨 칩과 안내 문구가 다 잘린다. 옮기는 것은
 * 그리는 자리뿐이고 값이 사는 자리(옵션 텍스트 원본의 [문항][보기 id])는 같다.
 *
 * 어느 칸의 입력인지는 라벨로 가린다 — 행 제목 · 열 제목 (· 보기 라벨). 행 제목·열 제목은
 * 「축 단위 카드」가 쓰는 규칙 그대로다(행의 응답 칸 앞 마지막 글자 셀, 열을 덮는 가장 아래 헤더).
 */

type TextOption = CheckboxOption | RadioOption | QuestionOption;

export interface BelowTableOptionText {
  cell: TableCell;
  option: TextOption;
  /** 라벨 조각(행 제목 · 열 제목 · 보기 라벨) — 빈 조각과 앞 조각과 같은 글자는 뺐다. 토큰 치환 전 */
  labelParts: string[];
}

export interface BelowTableCandidate {
  cell: TableCell;
  /** 상세 기재를 받는 보기들(저작 순서) */
  options: TextOption[];
  rowLabel: string;
  columnLabel: string;
}

const flat = (text: string | undefined): string => (text ?? '').replace(/\s+/g, ' ').trim();

const optionKey = (option: TextOption): string => option.value ?? option.id;

function textOptionsOf(cell: TableCell): TextOption[] {
  const options: TextOption[] | undefined =
    cell.type === 'checkbox'
      ? cell.checkboxOptions
      : cell.type === 'radio'
        ? cell.radioOptions
        : cell.type === 'select'
          ? cell.selectOptions
          : undefined;
  return (options ?? []).filter((option) => option.allowTextInput);
}

/** 이 칸이 상세 기재 입력칸을 표 아래로 내보내는가 — 옵션이 켜져 있고 상세 기재 보기가 있을 때만 */
export function movesOptionTextBelowTable(cell: TableCell): boolean {
  return cell.optionTextBelowTable === true && !cell.isHidden && textOptionsOf(cell).length > 0;
}

/**
 * 표 아래로 입력칸을 내보내는 칸들 — 화면에 그려지는 행·열 기준, 읽는 순서(행 → 열).
 * `columns` 와 `displayRows` 의 셀은 인덱스가 맞아야 한다(표시 조건으로 걸러진 뒤의 열·행).
 */
export function collectBelowTableCandidates(input: {
  columns: readonly TableColumn[];
  headerGrid?: HeaderCell[][] | undefined;
  displayRows: TableRow[];
}): BelowTableCandidate[] {
  if (!input.displayRows.some((row) => row.cells.some(movesOptionTextBelowTable))) return [];
  const context = new Map<string, { rowLabel: string; columnLabel: string }>();
  for (const card of buildColumnAxisCards(input)) {
    for (const item of card.items) {
      context.set(item.cell.id, { rowLabel: flat(item.label), columnLabel: flat(card.title) });
    }
  }
  const candidates: BelowTableCandidate[] = [];
  for (const row of input.displayRows) {
    for (const cell of row.cells) {
      if (!movesOptionTextBelowTable(cell)) continue;
      const labels = context.get(cell.id) ?? { rowLabel: flat(row.label), columnLabel: '' };
      candidates.push({ cell, options: textOptionsOf(cell), ...labels });
    }
  }
  return candidates;
}

function labelPartsOf(
  context: Pick<BelowTableCandidate, 'rowLabel' | 'columnLabel'>,
  option: TextOption,
): string[] {
  const parts: string[] = [];
  for (const part of [context.rowLabel, context.columnLabel, flat(option.label)]) {
    if (part && !parts.includes(part)) parts.push(part);
  }
  return parts;
}

function selectedKeys(cell: TableCell, cellResponse: unknown): string[] {
  if (cell.type === 'checkbox') {
    return Array.isArray(cellResponse)
      ? cellResponse.filter((key): key is string => typeof key === 'string')
      : [];
  }
  return typeof cellResponse === 'string' && cellResponse !== '' ? [cellResponse] : [];
}

/**
 * 지금 선택된 상세 기재 보기 — 표 응답(`{ [cellId]: 값 }`)에서 읽는다. 게이팅으로 닫힌 칸은
 * 값이 지워지므로 따로 걸러내지 않는다.
 */
export function selectBelowTableOptionTexts(
  candidates: readonly BelowTableCandidate[],
  tableResponse: unknown,
): BelowTableOptionText[] {
  if (candidates.length === 0) return [];
  const response =
    typeof tableResponse === 'object' && tableResponse !== null
      ? (tableResponse as Record<string, unknown>)
      : {};
  const entries: BelowTableOptionText[] = [];
  for (const { cell, options, rowLabel, columnLabel } of candidates) {
    const selected = new Set(selectedKeys(cell, response[cell.id]));
    if (selected.size === 0) continue;
    for (const option of options) {
      if (!selected.has(optionKey(option))) continue;
      entries.push({ cell, option, labelParts: labelPartsOf({ rowLabel, columnLabel }, option) });
    }
  }
  return entries;
}

const pairKey = (cellId: string, optionId: string): string => `${cellId}:${optionId}`;

/**
 * 구독 키 — 선택된 (칸, 보기) 쌍이 그대로면 같은 글자다. 표 응답 객체는 칸 하나만 바뀌어도 새
 * 참조라, 구독자는 이 글자를 구독하고 `belowTableOptionTextsFromKey` 로 목록을 되살린다.
 */
export function belowTableSelectionKey(
  candidates: readonly BelowTableCandidate[],
  tableResponse: unknown,
): string {
  return selectBelowTableOptionTexts(candidates, tableResponse)
    .map((entry) => pairKey(entry.cell.id, entry.option.id))
    .join('|');
}

/** 구독 키에서 입력칸 목록을 되살린다 — `selectBelowTableOptionTexts` 와 같은 결과 */
export function belowTableOptionTextsFromKey(
  candidates: readonly BelowTableCandidate[],
  selectionKey: string,
): BelowTableOptionText[] {
  if (selectionKey === '') return [];
  const selected = new Set(selectionKey.split('|'));
  const entries: BelowTableOptionText[] = [];
  for (const candidate of candidates) {
    for (const option of candidate.options) {
      if (!selected.has(pairKey(candidate.cell.id, option.id))) continue;
      entries.push({ cell: candidate.cell, option, labelParts: labelPartsOf(candidate, option) });
    }
  }
  return entries;
}
