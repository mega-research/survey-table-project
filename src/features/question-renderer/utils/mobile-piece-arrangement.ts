/**
 * 조각 재배치 — 좁은 화면의 원본 표 조각을 「어떤 순서·어떤 폭 규칙으로 그릴 것인가」의 유일한 판정 지점.
 * (CONTEXT.md 「조각 좌우 반전」·「조각 한 화면 칸 수」, 설정은 원본 행 상세 설정 묶음의 문항 값 둘)
 *
 * ── 배선과 규칙 ──
 * - **그리기 직전에만 부른다.** 조각 투영(`projectMobileOriginalRow`)은 「어느 열을 남기는가」만 정하고, 이 모듈이
 *   순서와 폭 규칙을 정한다. 척도 막대·슬라이더의 머리 읽기, 행 제목·섹션 판정, 「제목 아래 입력칸」 판정은
 *   뒤집기 전 조각을 읽어야 하므로 투영 안에 넣지 않는다.
 * - **설정이 꺼져 있거나 적용할 수 없으면 넣은 조각을 같은 참조로 돌려준다** — 끈 문항의 화면이 바뀌지 않는다.
 * - 입력을 바꾸지 않는다. 칸 id · 열 id 는 그대로다 — 응답 키와 셀 표시 인스턴스가 여기에 걸려 있다.
 *
 * 좌우 반전
 * - 열 · 머리 격자 · 본문 행(반복 헤더 행 + 응답 행)을 같은 순서로 뒤집는다. 가로로 합친 칸은 통째로 옮긴다.
 * - **고정 칸**: 응답 행에서 조각의 왼쪽 끝 또는 오른쪽 끝에 이어 붙은 「평균에서 제외」(`excludeFromMean`) 칸의
 *   열은 제자리에 둔다(「해당없음」이 맨 앞으로 오지 않게). 라벨로 추정하지 않고 표식만 본다.
 * - **세로선 숨김은 경계를 따라간다**: `hideRightBorder` 는 「이 칸과 오른쪽 칸 사이」의 선이다. 칸에 붙인 채 옮기면
 *   선이 엉뚱한 경계에 생기므로, 뒤집은 뒤 각 칸은 「원래 자기 왼쪽 경계」의 숨김을 물려받는다(구간의 첫 칸은
 *   구간 오른쪽 끝 경계를 물려받는다 — 그 경계는 고정 칸과의 사이라 자리가 바뀌지 않는다).
 * - **폴백 `merged-across-pinned`**: 뒤집는 구간과 고정 칸을 함께 덮는 합친 칸(머리·열 머리글·본문)이 있으면
 *   쪼갤 수 없으므로 작성 순서 그대로 그린다.
 *
 * 한 화면 칸 수
 * - 응답 행의 응답 칸이 전부 「좁은 칸에 들어가는 보기 칸」일 때만 대상이다 — 보기 칸(choice_opt), 보기가 하나뿐인
 *   라디오·체크박스 칸(행렬 척도). 입력 칸·드롭다운·순위·보기가 여럿 든 칸이 섞이면 균등 폭이 맞지 않아
 *   원본 폭 그대로다(폴백 `non-choice-answer-cell`).
 * - 나누는 수는 `min(칸 수, 조각 열 수)` — 열이 적으면 자리를 꽉 채운다. 실제 px 는 그리는 쪽이 자리 폭으로 낸다.
 *
 * 머리 글자 넘김 방향(`resolveHeaderOverflowDirections`)
 * - 한 화면 칸 수가 적용된 조각에서 머리 글자가 칸에 안 들어갈 때 넘길 쪽 = 이웃과의 세로선이 숨겨진 쪽.
 *   표의 마지막 열에 닿는 칸의 오른쪽 선은 끝선이라 숨겨지지 않는다(`getHeaderRightBorderClass` 와 같은 규칙).
 *   반전 뒤의 조각을 넣어야 한다.
 *
 * 빌더 경고(`survey-builder/lib/mobile-piece-diagnostics`)는 이 판정의 폴백 사유를 그대로 보인다.
 */
import type { HeaderCell, TableCell, TableColumn, TableRow } from '@/types/survey';
import { resolveMobilePieceColumnsPerView } from '@/types/mobile-table-display';

import { expandHeaderGrid } from './expand-header-grid';
import { isMobileOriginalRowInteractiveCell } from './mobile-original-row';

export interface MobilePieceSettings {
  reverseColumns?: boolean | null | undefined;
  columnsPerView?: number | null | undefined;
}

/** 그릴 조각 — 열 · 머리 격자 · 본문 행(반복 헤더 행들 + 응답 행) */
export interface MobilePiece {
  columns: TableColumn[];
  headerGrid?: HeaderCell[][] | undefined;
  rows: TableRow[];
  interactiveRowId: string;
}

export type MobilePieceReverseFallback = 'merged-across-pinned';
export type MobilePieceFitFallback = 'non-choice-answer-cell' | 'no-answer-cell';

export interface MobilePieceFit {
  /** 저작자가 고른 칸 수 */
  columnsPerView: number;
  /** 자리 폭을 나눌 수 — `min(칸 수, 조각 열 수)` */
  divisor: number;
}

export interface MobilePieceArrangement {
  piece: MobilePiece;
  reversed: boolean;
  /** 반전을 켰는데 적용하지 못한 이유 */
  reverseFallback: MobilePieceReverseFallback | null;
  /** 한 화면 칸 수가 적용되면 그 값, 아니면 null(원본 열 폭) */
  fit: MobilePieceFit | null;
  /** 칸 수를 켰는데 적용하지 못한 이유 */
  fitFallback: MobilePieceFitFallback | null;
}

export type HeaderOverflowDirection = 'right' | 'left' | 'both' | 'none';

/** 자리 [start, end) — 0부터 세는 열 번호 */
interface Span {
  start: number;
  end: number;
}

function straddles(span: Span, a: number, b: number): boolean {
  const crosses = (edge: number) => span.start < edge && span.end > edge;
  return crosses(a) || crosses(b);
}

/** 가로로 합친 칸과 그 칸이 덮은 자리를 한 덩어리로 묶은 자리 목록 */
function unitSpans<T>(items: readonly T[], lengthAt: (item: T) => number): Span[] {
  const spans: Span[] = [];
  let index = 0;
  while (index < items.length) {
    const length = Math.max(1, Math.min(lengthAt(items[index]!), items.length - index));
    spans.push({ start: index, end: index + length });
    index += length;
  }
  return spans;
}

const columnUnitLength = (column: TableColumn) =>
  column.isHeaderHidden ? 1 : Math.max(1, column.colspan ?? 1);
const cellUnitLength = (cell: TableCell) =>
  cell.isHidden || cell._isContinuation ? 1 : Math.max(1, cell.colspan ?? 1);

function withRightBorderHidden<T extends { hideRightBorder?: boolean }>(item: T, hidden: boolean): T {
  if ((item.hideRightBorder === true) === hidden) return item;
  const next = { ...item };
  if (hidden) next.hideRightBorder = true;
  else delete next.hideRightBorder;
  return next;
}

/**
 * 한 줄(열 목록 · 본문 행의 칸 목록)의 [a, b) 구간을 덩어리 단위로 뒤집는다. 세로선 숨김은 경계를 따라간다 —
 * 표식은 덩어리의 첫 칸(합친 칸의 닻)이 쥔다.
 */
function mirrorLine<T extends { hideRightBorder?: boolean }>(
  items: readonly T[],
  lengthAt: (item: T) => number,
  a: number,
  b: number,
): T[] {
  const units = unitSpans(items, lengthAt).filter((unit) => unit.start >= a && unit.end <= b);
  /** 원래 줄에서 자리 p 의 왼쪽 경계(= p−1 과 p 사이)가 숨겨져 있었는가 */
  const hiddenAtEnd = new Map(units.map((unit) => [unit.end, items[unit.start]!.hideRightBorder === true]));
  const mirrored = [...units].reverse().flatMap((unit) => {
    const inherited = unit.start === a ? hiddenAtEnd.get(b) : hiddenAtEnd.get(unit.start);
    const anchor = withRightBorderHidden(items[unit.start]!, inherited === true);
    return [anchor, ...items.slice(unit.start + 1, unit.end)];
  });
  return [...items.slice(0, a), ...mirrored, ...items.slice(b)];
}

function mirrorHeaderGrid(headerGrid: HeaderCell[][], a: number, b: number): HeaderCell[][] {
  const placed = expandHeaderGrid(headerGrid).map((entry) => ({
    ...entry,
    span: { start: entry.startCol - 1, end: entry.startCol - 1 + entry.colSpan },
  }));
  /** 줄마다 자리 → 그 자리를 덮는 칸(세로로 합친 칸은 덮는 줄 전부에) */
  const ownerByRow = headerGrid.map(() => new Map<number, HeaderCell>());
  for (const entry of placed) {
    for (let r = entry.rowIdx; r < entry.rowIdx + entry.rowSpan && r < headerGrid.length; r += 1) {
      for (let c = entry.span.start; c < entry.span.end; c += 1) ownerByRow[r]!.set(c, entry.cell);
    }
  }

  const rows: { cell: HeaderCell; start: number }[][] = headerGrid.map(() => []);
  for (const entry of placed) {
    const inside = entry.span.start >= a && entry.span.end <= b;
    if (!inside) {
      rows[entry.rowIdx]!.push({ cell: entry.cell, start: entry.span.start });
      continue;
    }
    // 뒤집힌 뒤의 오른쪽 경계 = 원래의 왼쪽 경계. 구간의 첫 칸은 구간 오른쪽 끝 경계를 물려받는다
    const boundaryOwner = ownerByRow[entry.rowIdx]!.get(
      entry.span.start === a ? b - 1 : entry.span.start - 1,
    );
    rows[entry.rowIdx]!.push({
      cell: withRightBorderHidden(entry.cell, boundaryOwner?.hideRightBorder === true),
      start: a + b - entry.span.end,
    });
  }
  return rows.map((row) => row.sort((left, right) => left.start - right.start).map((it) => it.cell));
}

/** 응답 행의 양끝에 이어 붙은 「평균에서 제외」 칸을 뺀, 뒤집을 구간 [a, b) */
function resolveReverseRange(interactiveRow: TableRow, columnCount: number): Span {
  const isPinned = (index: number) => {
    const cell = interactiveRow.cells[index];
    return cell !== undefined && !cell.isHidden && !cell._isContinuation && cell.excludeFromMean === true;
  };
  let start = 0;
  while (start < columnCount && isPinned(start)) start += 1;
  let end = columnCount;
  while (end > start && isPinned(end - 1)) end -= 1;
  return { start, end };
}

function hasMergedAcrossPinned(piece: MobilePiece, a: number, b: number): boolean {
  if (unitSpans(piece.columns, columnUnitLength).some((span) => straddles(span, a, b))) return true;
  if (
    expandHeaderGrid(piece.headerGrid ?? []).some(({ startCol, colSpan }) =>
      straddles({ start: startCol - 1, end: startCol - 1 + colSpan }, a, b),
    )
  ) {
    return true;
  }
  return piece.rows.some((row) =>
    unitSpans(row.cells, cellUnitLength).some((span) => straddles(span, a, b)),
  );
}

function reversePiece(
  piece: MobilePiece,
  interactiveRow: TableRow,
): { piece: MobilePiece; reversed: boolean; fallback: MobilePieceReverseFallback | null } {
  const { start: a, end: b } = resolveReverseRange(interactiveRow, piece.columns.length);
  if (b - a <= 1) return { piece, reversed: false, fallback: null };
  if (hasMergedAcrossPinned(piece, a, b)) {
    return { piece, reversed: false, fallback: 'merged-across-pinned' };
  }
  return {
    piece: {
      ...piece,
      columns: mirrorLine(piece.columns, columnUnitLength, a, b),
      ...(piece.headerGrid ? { headerGrid: mirrorHeaderGrid(piece.headerGrid, a, b) } : {}),
      rows: piece.rows.map((row) => ({
        ...row,
        cells: mirrorLine(row.cells, cellUnitLength, a, b),
      })),
    },
    reversed: true,
    fallback: null,
  };
}

/** 좁은 칸(46px 안팎)에 컨트롤 하나로 들어가는 응답 칸인가 */
function fitsNarrowCell(cell: TableCell): boolean {
  if (cell.type === 'choice_opt') return true;
  if (cell.type === 'radio') return (cell.radioOptions?.length ?? 0) <= 1;
  if (cell.type === 'checkbox') return (cell.checkboxOptions?.length ?? 0) <= 1;
  return false;
}

function resolveFit(
  piece: MobilePiece,
  interactiveRow: TableRow,
  columnsPerView: number | null,
): { fit: MobilePieceFit | null; fallback: MobilePieceFitFallback | null } {
  if (columnsPerView === null) return { fit: null, fallback: null };
  const answerCells = interactiveRow.cells.filter(isMobileOriginalRowInteractiveCell);
  if (answerCells.length === 0) return { fit: null, fallback: 'no-answer-cell' };
  if (!answerCells.every(fitsNarrowCell)) return { fit: null, fallback: 'non-choice-answer-cell' };
  return {
    fit: { columnsPerView, divisor: Math.max(1, Math.min(columnsPerView, piece.columns.length)) },
    fallback: null,
  };
}

export function arrangeMobilePiece(
  piece: MobilePiece,
  settings: MobilePieceSettings,
): MobilePieceArrangement {
  const untouched: MobilePieceArrangement = {
    piece,
    reversed: false,
    reverseFallback: null,
    fit: null,
    fitFallback: null,
  };
  const wantsReverse = settings.reverseColumns === true;
  const columnsPerView = resolveMobilePieceColumnsPerView(settings.columnsPerView);
  if (!wantsReverse && columnsPerView === null) return untouched;

  const interactiveRow = piece.rows.find((row) => row.id === piece.interactiveRowId);
  if (!interactiveRow) return untouched;

  const reverse = wantsReverse
    ? reversePiece(piece, interactiveRow)
    : { piece, reversed: false, fallback: null };
  const fit = resolveFit(piece, interactiveRow, columnsPerView);
  return {
    piece: reverse.piece,
    reversed: reverse.reversed,
    reverseFallback: reverse.fallback,
    fit: fit.fit,
    fitFallback: fit.fallback,
  };
}

function direction(leftHidden: boolean, rightHidden: boolean): HeaderOverflowDirection {
  if (leftHidden && rightHidden) return 'both';
  if (rightHidden) return 'right';
  if (leftHidden) return 'left';
  return 'none';
}

/**
 * 머리 칸마다 글자를 넘길 방향 — 키는 머리 격자 칸 id, 다단 헤더가 없는 조각은 열 id(가려진 열 머리글은 뺀다).
 * 그려지는 머리(`TablePreview` 의 다단 헤더 / 한 줄 머리글 폴백)와 같은 쪽을 본다.
 */
export function resolveHeaderOverflowDirections(
  piece: Pick<MobilePiece, 'columns' | 'headerGrid'>,
): Map<string, HeaderOverflowDirection> {
  const columnCount = piece.columns.length;
  const result = new Map<string, HeaderOverflowDirection>();

  if (piece.headerGrid && piece.headerGrid.length > 0) {
    const placed = expandHeaderGrid(piece.headerGrid);
    const ownerByRow = piece.headerGrid.map(() => new Map<number, HeaderCell>());
    for (const entry of placed) {
      const lastRow = Math.min(entry.rowIdx + entry.rowSpan, piece.headerGrid.length);
      for (let r = entry.rowIdx; r < lastRow; r += 1) {
        for (let c = entry.startCol; c < entry.startCol + entry.colSpan; c += 1) {
          ownerByRow[r]!.set(c, entry.cell);
        }
      }
    }
    for (const entry of placed) {
      const endCol = entry.startCol + entry.colSpan - 1;
      const leftNeighbor = ownerByRow[entry.rowIdx]!.get(entry.startCol - 1);
      result.set(
        entry.cell.id,
        direction(
          leftNeighbor?.hideRightBorder === true,
          entry.cell.hideRightBorder === true && endCol < columnCount,
        ),
      );
    }
    return result;
  }

  const units = unitSpans(piece.columns, columnUnitLength);
  units.forEach((unit, index) => {
    const column = piece.columns[unit.start]!;
    if (column.isHeaderHidden) return;
    const previous = index > 0 ? piece.columns[units[index - 1]!.start] : undefined;
    result.set(
      column.id,
      direction(
        previous?.hideRightBorder === true,
        column.hideRightBorder === true && unit.end < columnCount,
      ),
    );
  });
  return result;
}

/** 조각 격자의 왼쪽 테두리(px) — 첫 칸이 이만큼 밀려 시작한다 */
const PIECE_LEFT_BORDER_PX = 1;

/**
 * 한 화면 칸 수가 적용된 조각의 칸 폭(px) — 자리 폭에서 왼쪽 테두리를 빼고 나눈다. 그래야 N번째 칸의 오른쪽
 * 선이 자리 끝에 정확히 온다(테두리를 빼지 않으면 N번째 칸이 1px 잘려 흐림 띠 아래로 들어간다).
 * 자리 폭을 아직 못 쟀으면(0) null — 그리는 쪽은 원본 폭으로 둔다.
 */
export function resolvePieceFitColumnWidth(slotWidth: number, fit: MobilePieceFit): number | null {
  if (!Number.isFinite(slotWidth) || slotWidth <= PIECE_LEFT_BORDER_PX) return null;
  return (slotWidth - PIECE_LEFT_BORDER_PX) / fit.divisor;
}
