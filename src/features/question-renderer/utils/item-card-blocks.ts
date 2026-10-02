/**
 * 「블록 단위로 세우기」 투영 (CONTEXT.md "블록 단위로 세우기") — 「항목 단위 카드」의 옵션.
 * 표 두 벌을 좌우로 붙인 표(학력별 인력 | 경력별 인력)는 행 순서로 훑으면 두 표의 항목이 번갈아
 * 나온다. 저작자가 **블록이 시작하는 열**을 적으면 블록마다 항목 카드를 끝까지 세운 뒤 다음 블록으로
 * 넘어간다.
 *
 * - 블록 경계는 저작자가 지정한다. 자동 추정은 없다 — "입력 칸 뒤에 라벨이 다시 나온다"는 신호는
 *   양식형 표의 평범한 항목 경계((1) 기업명 | 입력 | (2) 대표자 성별 | 선택)와 구별되지 않는다.
 * - 열 번호는 **작성 열 순서**(1부터)다. 표시 조건으로 열이 숨어도 남은 열이 제 블록에 그대로 든다.
 *   1은 적지 않아도 된다 — 첫 블록은 언제나 첫 열에서 시작한다.
 * - 블록 안의 카드는 항목 단위 카드와 같은 규칙(`buildItemCards`)으로 만든다.
 * - 입력 칸이 전부 계산 칸인 카드(합계 행)는 카드가 아니라 **블록 머리의 요약**이다.
 * - 블록 제목은 블록 첫 열의 헤더 글자다. 입력 칸 라벨은 셀의 모바일 라벨이 없으면 그 열의 헤더
 *   글자를 쓴다(`columnLabels`) — 블록이 없는 항목 단위 카드는 종전대로 모바일 라벨만 쓴다.
 *
 * 응답값·검증·내보내기는 무변경 — 표시 순서만 바뀐다.
 */
import type { HeaderCell, TableColumn, TableRow } from '@/types/survey';

import { headerPath } from './column-axis-cards';
import { type ItemCard, buildItemCards } from './item-cards';

export interface ItemCardBlock {
  /** 안정 키 — 블록 첫 (표시) 열의 id */
  key: string;
  /** 블록 첫 열의 헤더 글자. 헤더가 비면 빈 문자열 */
  title: string;
  /** 계산 칸만 있는 카드 — 블록 머리에 값으로 올린다 */
  summaries: ItemCard[];
  cards: ItemCard[];
}

export interface ItemCardBlocks {
  blocks: ItemCardBlock[];
  /** 표시 열 인덱스 → 그 열을 덮는 가장 아래 헤더 글자 (입력 칸 라벨 폴백) */
  columnLabels: string[];
}

/**
 * 블록 시작 열 정규화 — 정수만, 1 이상 열 수 이하, 중복 제거·오름차순, 1은 뺀다(첫 블록은 암묵).
 * 지정이 하나라도 있었으면(1만 적었어도) 배열을, 없었으면 null 을 돌려준다.
 */
export function normalizeItemCardBlockColumns(
  value: readonly number[] | null | undefined,
  columnCount: number,
): number[] | null {
  if (!value || value.length === 0) return null;
  const starts = [...new Set(value)]
    .filter((n) => Number.isInteger(n) && n >= 1 && n <= columnCount)
    .sort((a, b) => a - b);
  if (starts.length === 0) return null;
  return starts[0] === 1 ? starts : [1, ...starts];
}

/** 「1, 5」 같은 입력 글자 → 열 번호 배열. 빈 글자는 null(블록 없음), 못 읽으면 ok:false */
export function parseItemCardBlockColumnsText(
  text: string,
  columnCount: number,
): { ok: true; value: number[] | null } | { ok: false } {
  const tokens = text
    .split(/[\s,]+/)
    .map((token) => token.trim())
    .filter(Boolean);
  if (tokens.length === 0) return { ok: true, value: null };
  const numbers = tokens.map((token) => (/^\d+$/.test(token) ? Number(token) : Number.NaN));
  if (numbers.some((n) => !Number.isInteger(n) || n < 1 || n > columnCount)) return { ok: false };
  return { ok: true, value: normalizeItemCardBlockColumns(numbers, columnCount) };
}

export function formatItemCardBlockColumns(value: readonly number[] | null | undefined): string {
  return (value ?? []).join(', ');
}

function isSummaryCard(card: ItemCard): boolean {
  return card.inputs.length > 0 && card.inputs.every((entry) => entry.cell.type === 'calc');
}

/**
 * 블록이 지정되지 않았으면 null — 호출부는 종전 항목 단위 카드를 그린다.
 * `visibleColumns` 와 `displayRows` 의 셀은 인덱스가 맞아야 한다(표시 조건으로 걸러진 뒤).
 */
export function buildItemCardBlocks(input: {
  /** 작성 열 전체 — 블록 시작 열 번호의 기준 */
  authoredColumns: readonly TableColumn[];
  visibleColumns: readonly TableColumn[];
  visibleHeaderGrid?: HeaderCell[][] | undefined;
  displayRows: TableRow[];
  blockStartColumns: readonly number[] | null | undefined;
}): ItemCardBlocks | null {
  const starts = normalizeItemCardBlockColumns(
    input.blockStartColumns,
    input.authoredColumns.length,
  );
  if (!starts) return null;

  const authoredIndexById = new Map(
    input.authoredColumns.map((column, index) => [column.id, index]),
  );
  // 표시 열마다 속한 블록 — 작성 순서에서 그 열 이하인 마지막 시작 열
  const blockOfVisible = input.visibleColumns.map((column) => {
    const authored = (authoredIndexById.get(column.id) ?? 0) + 1;
    let block = 0;
    starts.forEach((start, index) => {
      if (start <= authored) block = index;
    });
    return block;
  });

  const columnLabels = input.visibleColumns.map(
    (_, index) => headerPath(input.visibleColumns, input.visibleHeaderGrid, index).at(-1) ?? '',
  );

  const blocks: ItemCardBlock[] = [];
  starts.forEach((_, blockIndex) => {
    const start = blockOfVisible.indexOf(blockIndex);
    if (start < 0) return; // 블록의 열이 전부 숨었다
    const end = blockOfVisible.lastIndexOf(blockIndex) + 1;
    const all = buildItemCards(input.displayRows, { start, end });
    if (all.length === 0) return;
    blocks.push({
      key: input.visibleColumns[start]!.id,
      title: columnLabels[start] ?? '',
      summaries: all.filter(isSummaryCard),
      cards: all.filter((card) => !isSummaryCard(card)),
    });
  });

  return { blocks, columnLabels };
}
