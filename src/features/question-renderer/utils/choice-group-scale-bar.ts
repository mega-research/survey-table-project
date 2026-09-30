import type { ChoiceGroup, HeaderCell, TableCell, TableColumn, TableRow } from '@/types/survey';

import { expandHeaderGrid } from './expand-header-grid';

/**
 * 척도 한 줄을 모바일 폭에 맞는 **척도 막대**로 그리기 위한 투영 — 막대를 그릴지와 무엇을 쓸지의
 * 유일한 판정 지점이다(CONTEXT.md 「척도 막대」).
 *
 * 원본 한 줄 투영(choice-group-original-line)과 같은 층·같은 입력 모양이다. 대상 보기 칸이 선
 * 열만 헤더 격자에서 잘라 보고, 줄마다 역할을 정한다.
 *
 * - 제목 줄: 비지 않은 칸 하나가 대상 열 전체를 덮는다 — 버린다(카드의 그룹 이름과 겹친다)
 * - 칸 줄: 비지 않은 칸이 전부 한 칸짜리이고 대상 열을 빠짐없이 덮는다 — 칸 글자의 대체 출처,
 *   5칸 이하 칸 안 라벨
 * - 구간 줄: 그 밖(여러 칸을 묶었거나 일부 칸만 이름이 있다) — 구간 띠·양끝/가운데 라벨·선택값 표시
 *
 * 고정 문구는 없다. 모든 글자는 보기 칸의 평문 content 와 헤더에서만 읽는다 — exportLabel 은
 * 내보내기용이라 화면에 쓰지 않는다. 그릴 수 없으면 이유 코드와 함께 폴백을 돌려주고, 호출부는
 * 원본 표 조각으로 그린다. 이유 코드는 빌더가 폴백 경고에 쓰려고 함께 싣는다.
 */

export interface ScaleBarCell {
  /** 원래 보기 칸 id — 저장 키 그대로 */
  cellId: string;
  /** 막대 칸 글자 */
  text: string;
  /** 5칸 이하일 때 칸 글자 아래 라벨 — 칸 글자와 같으면 두지 않는다(한 번만 보인다) */
  inCellLabel?: string;
  bandIndex: number | null;
}

export interface ScaleBarBand {
  label: string;
  start: number;
  span: number;
}

export interface ScaleBarModel {
  cells: ScaleBarCell[];
  bands: ScaleBarBand[];
  /** 막대 아래 라벨 — 6칸 이상만 */
  anchors: { left?: string; middle?: { label: string; index: number }; right?: string };
  /** 고른 칸의 「글자 · 구간 이름」 표시 — 6칸 이상이고 구간이 있을 때 */
  showsSelectionLabel: boolean;
}

export type ScaleBarFallbackReason =
  | 'not-single-choice'
  | 'non-choice-cell'
  | 'non-contiguous'
  | 'cell-count'
  | 'text-input'
  | 'exclusive-choice'
  | 'missing-text';

export type ScaleBarProjection =
  { ok: true; model: ScaleBarModel } | { ok: false; reason: ScaleBarFallbackReason };

export interface ProjectScaleBarInput {
  /** 선택 방식 — 보기 그룹이면 그룹 종류, 그룹 없는 행이면 문항의 선택 방식 */
  selectionType: ChoiceGroup['type'];
  /** 행의 셀과 인덱스가 맞는 열 — 표시 조건으로 걸러진 뒤의 열이어야 한다 */
  columns: readonly TableColumn[];
  /** columns 와 짝이 맞는(같이 걸러진) 헤더 격자 */
  headerGrid?: HeaderCell[][] | undefined;
  row: TableRow;
  /** 막대 칸이 될 이 행의 보기 칸(보이는 것만, 행 순서) */
  targetCells: readonly TableCell[];
}

/** 카드 안 칸 폭이 약 29px 이 되는 한계 — 11점 척도 + 여유 1칸 */
export const SCALE_BAR_MAX_CELLS = 12;
const MIN_CELLS = 2;
/** 이 칸 수 이하는 막대 아래 라벨·선택값 표시를 두지 않는다 — 칸 폭이 넉넉해 라벨은 칸 안 몫이다 */
const IN_CELL_LABEL_MAX_CELLS = 5;

interface Segment {
  label: string;
  start: number;
  span: number;
}

type HeaderLine = { role: 'title' } | { role: 'cells' | 'bands'; segments: Segment[] };

function fallback(reason: ScaleBarFallbackReason): ScaleBarProjection {
  return { ok: false, reason };
}

function isVisible(cell: TableCell): boolean {
  return !cell.isHidden && !cell._isContinuation;
}

/** 헤더 글자의 줄바꿈(`전혀\n그렇지\n않다`)은 공백으로 잇는다 — 보기 칸 글자도 같은 규칙이라야 둘을 비교할 수 있다 */
function normalizeLabel(label: string): string {
  return label.replace(/\s+/g, ' ').trim();
}

/**
 * 번호뿐인 글자(`4` · `④` · `❹` · `4점`) — 라벨이 아니라 칸 번호다. 보기 칸 글자가 라벨이고 칸 줄이
 * 번호인 헤더에서 라벨 아래 번호가 붙는(거꾸로 된) 칸 안 라벨을 막는다.
 */
const NUMBER_MARK = /^[\s0-9０-９\u2460-\u2473\u24EA-\u24FF\u2776-\u2793().점-]+$/u;

/**
 * 헤더 격자를 대상 열 [first, first + count) 로 잘라 줄마다 역할을 정한다. 위 줄에서 세로 병합으로
 * 내려온 칸도 그 줄을 덮는 것으로 본다 — 「매우 불만족」이 구간 줄과 칸 줄을 함께 덮는 헤더가 있다.
 */
function classifyHeaderLines(
  headerGrid: HeaderCell[][],
  first: number,
  count: number,
): HeaderLine[] {
  const placed = expandHeaderGrid(headerGrid);
  return headerGrid.map((_, rowIdx) => {
    const segments: Segment[] = [];
    for (const item of placed) {
      if (rowIdx < item.rowIdx || rowIdx >= item.rowIdx + item.rowSpan) continue;
      const label = normalizeLabel(item.cell.label ?? '');
      if (label === '') continue;
      const cellStart = item.startCol - 1 - first;
      const start = Math.max(cellStart, 0);
      const end = Math.min(cellStart + item.colSpan, count);
      if (end <= start) continue;
      segments.push({ label, start, span: end - start });
    }
    segments.sort((a, b) => a.start - b.start);
    if (segments.length === 1 && segments[0]!.span === count) return { role: 'title' };
    const coversAll =
      segments.length === count && segments.every((segment, i) => segment.start === i);
    if (segments.every((segment) => segment.span === 1) && coversAll) {
      return { role: 'cells', segments };
    }
    return { role: 'bands', segments };
  });
}

/** 가장 아래(보기에 가장 가까운) 해당 역할 줄 */
function lastLine(lines: HeaderLine[], role: 'cells' | 'bands'): Segment[] | undefined {
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = lines[i]!;
    if (line.role === role && line.segments.length > 0) return line.segments;
  }
  return undefined;
}

export function projectScaleBar(input: ProjectScaleBarInput): ScaleBarProjection {
  const { row, targetCells, columns } = input;
  if (input.selectionType !== 'radio') return fallback('not-single-choice');
  if (targetCells.some((cell) => cell.type !== 'choice_opt')) return fallback('non-choice-cell');

  const indices = targetCells.map((cell) => row.cells.findIndex((c) => c.id === cell.id));
  if (indices.some((index) => index < 0 || index >= columns.length)) {
    return fallback('non-contiguous');
  }
  for (let i = 1; i < indices.length; i += 1) {
    const prev = indices[i - 1]!;
    const next = indices[i]!;
    if (next === prev + 1) continue;
    // 사이에 낀 칸이 입력칸 등이면 「보기 칸이 아닌 것이 섞였다」, 다른 그룹 보기·병합 칸이면 비연속
    const between = row.cells.slice(prev + 1, Math.max(next, prev + 1));
    const hasNonChoice = between.some((cell) => isVisible(cell) && cell.type !== 'choice_opt');
    return fallback(hasNonChoice ? 'non-choice-cell' : 'non-contiguous');
  }

  const count = targetCells.length;
  if (count < MIN_CELLS || count > SCALE_BAR_MAX_CELLS) return fallback('cell-count');
  if (targetCells.some((cell) => cell.allowTextInput === true)) return fallback('text-input');
  if (targetCells.some((cell) => cell.exclusiveChoice === true)) {
    return fallback('exclusive-choice');
  }

  const first = indices[0]!;
  const lines =
    input.headerGrid && input.headerGrid.length > 0
      ? classifyHeaderLines(input.headerGrid, first, count)
      : [];
  const cellLine = lastLine(lines, 'cells');

  const texts: string[] = [];
  for (let i = 0; i < count; i += 1) {
    const own = normalizeLabel(targetCells[i]!.content ?? '');
    if (own !== '') {
      texts.push(own);
      continue;
    }
    const fromHeader = cellLine?.[i]?.label ?? '';
    if (fromHeader === '') return fallback('missing-text');
    texts.push(fromHeader);
  }

  const bands: ScaleBarBand[] = (lastLine(lines, 'bands') ?? []).map(({ label, start, span }) => ({
    label,
    start,
    span,
  }));
  const bandIndexAt = (i: number): number | null => {
    const found = bands.findIndex((band) => i >= band.start && i < band.start + band.span);
    return found < 0 ? null : found;
  };

  /** 6칸 이상 — 라벨을 칸 안이 아니라 막대 아래(양끝·가운데)와 선택값 표시로 보인다 */
  const labelsBelowBar = count > IN_CELL_LABEL_MAX_CELLS;
  // 5칸 이하는 칸 폭(약 70px)이 넉넉해 라벨을 칸 안에 넣는다 — 칸 줄 글자, 없으면 그 칸을 덮는 한 칸짜리
  // 구간 이름. 여러 칸짜리 구간 이름은 한 칸에 붙일 수 없어 구간 띠로만 드러낸다. 칸 글자와 같은
  // 라벨(보기 칸 글자가 곧 라벨이거나 칸 글자를 칸 줄에서 가져온 경우)은 되풀이하지 않는다.
  const inCellLabelAt = (i: number, text: string, bandIndex: number | null): string | undefined => {
    if (labelsBelowBar) return undefined;
    const band = bandIndex === null ? undefined : bands[bandIndex];
    const candidates = [cellLine?.[i]?.label, band?.span === 1 ? band.label : undefined];
    return candidates.find(
      (label) => label !== undefined && label !== '' && label !== text && !NUMBER_MARK.test(label),
    );
  };

  const cells: ScaleBarCell[] = targetCells.map((cell, i) => {
    const text = texts[i]!;
    const bandIndex = bandIndexAt(i);
    const inCellLabel = inCellLabelAt(i, text, bandIndex);
    return {
      cellId: cell.id,
      text,
      ...(inCellLabel !== undefined ? { inCellLabel } : {}),
      bandIndex,
    };
  });

  const anchors: ScaleBarModel['anchors'] = {};
  if (labelsBelowBar && bands.length > 0) {
    const leftBand = cells[0]!.bandIndex;
    const rightBand = cells[count - 1]!.bandIndex;
    if (leftBand !== null) anchors.left = bands[leftBand]!.label;
    if (rightBand !== null) anchors.right = bands[rightBand]!.label;
    // 가운데 라벨은 정가운데 칸을 덮는 구간이 한 칸짜리일 때만 — 여러 칸짜리 구간 이름을 막대 아래에
    // 쓰면 긴 양끝 라벨과 겹친다. 그런 이름은 구간 띠와 선택값 표시로만 드러낸다.
    if (count % 2 === 1) {
      const index = (count - 1) / 2;
      const middleBand = cells[index]!.bandIndex;
      if (middleBand !== null && bands[middleBand]!.span === 1) {
        anchors.middle = { label: bands[middleBand]!.label, index };
      }
    }
  }

  return {
    ok: true,
    model: { cells, bands, anchors, showsSelectionLabel: labelsBelowBar && bands.length > 0 },
  };
}
