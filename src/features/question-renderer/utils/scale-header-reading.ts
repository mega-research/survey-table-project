import type { HeaderCell, TableCell, TableColumn, TableRow } from '@/types/survey';

import { expandHeaderGrid } from './expand-header-grid';

/**
 * 척도 한 줄의 **헤더 읽기 코어** — 대상 보기 칸이 선 열만 헤더에서 잘라 보고 칸 글자 · 칸 이름 · 구간을
 * 읽는다. 척도 막대 투영(choice-group-scale-bar)과 척도 슬라이더 투영이 함께 쓴다.
 *
 * ── 배선과 규칙 ──
 * - **모양을 모른다.** 눈금 수 상한(막대 12칸 · 슬라이더 13눈금)도, 칸 이름을 어디에 싣는지(막대의 칸 안
 *   라벨·이름 목록, 슬라이더의 타일)도 여기서 정하지 않는다. 읽은 것을 눈금 수와 무관하게 전부 싣고,
 *   무엇을 쓸지는 그 위의 투영이 고른다.
 * - 줄마다 역할을 정한다(다단 헤더가 없는 표는 열 제목 한 줄을 읽는다).
 *   - 제목 줄: 비지 않은 칸 하나가 대상 열 전체를 덮는다 — 버린다(그룹 이름과 겹친다)
 *   - 칸 줄: 비지 않은 칸이 전부 한 칸짜리이고 대상 열을 빠짐없이 덮는다 — 칸 글자의 대체 출처이자
 *     칸 이름의 출처. 칸 줄이 둘이면(이름 줄 + 번호 줄) 칸 글자는 아래 줄, 이름은 번호뿐이 아닌 가장
 *     가까운 줄에서 온다
 *   - 구간 줄: 그 밖(여러 칸을 묶었거나 일부 칸만 이름이 있다) — 가장 아래 구간 줄이 구간이다
 * - 칸 글자의 출처는 보기 칸 글자 → 칸 줄 → 그 칸만 덮는 한 칸짜리 구간 이름 순이다. 마지막은 머리에만
 *   「미참여」를 적고 칸에는 컨트롤만 둔 칸이다 — 그 이름은 구간이 아니라 칸의 이름이라 구간에서 뺀다.
 *   어디서도 못 읽으면 읽기 전체가 실패한다(null — 투영의 「칸 글자 없음」 폴백).
 * - 고정 문구는 없다. 모든 글자는 보기 칸의 평문 content 와 헤더에서만 읽는다 — exportLabel 은
 *   내보내기용이라 화면에 쓰지 않는다. 줄바꿈·앞뒤 공백은 한 칸 공백으로 잇는다(칸 글자와 머리를 비교하려면
 *   같은 규칙이어야 한다).
 * - 위 줄에서 세로 병합으로 내려온 머리도 그 줄을 덮는 것으로 본다.
 * - 대상 칸은 이어진 열에 서 있어야 한다 — 그 판정(`locateScaleColumnRun`)도 여기에 있고, 이유 코드는
 *   두 투영이 같은 어휘로 쓴다.
 */

/** 척도 판정이 보는 칸 — 숨김·병합으로 이어진 칸은 없는 칸이다. 행 판정·빌더 진단도 이 기준을 쓴다 */
export function isScaleVisibleCell(cell: TableCell): boolean {
  return !cell.isHidden && !cell._isContinuation;
}

/** 헤더 글자의 줄바꿈(`전혀\n그렇지\n않다`)은 공백으로 잇는다 — 보기 칸 글자도 같은 규칙이라야 둘을 비교할 수 있다 */
export function normalizeScaleLabel(label: string): string {
  return label.replace(/\s+/g, ' ').trim();
}

const NUMBER_MARK = /^[\s0-9０-９①-⑳⓪-⓿❶-➓().점-]+$/u;

/**
 * 번호뿐인 글자(`4` · `④` · `❹` · `4점`) — 이름이 아니라 칸 번호다. 보기 칸 글자가 라벨이고 칸 줄이
 * 번호인 헤더에서 번호가 칸 이름으로 읽히는 것을 막는다.
 */
export function isNumberMarkLabel(label: string): boolean {
  return NUMBER_MARK.test(label);
}

export type ScaleColumnRun =
  | { ok: true; first: number }
  | { ok: false; reason: 'non-choice-cell' | 'non-contiguous' };

export interface LocateScaleColumnRunInput {
  row: TableRow;
  /** 행의 셀과 인덱스가 맞는 열의 수 */
  columnCount: number;
  /** 이어져 있어야 하는 이 행의 보기 칸(행 순서) */
  targetCells: readonly TableCell[];
}

/**
 * 대상 칸이 이어진 열에 서 있는가 — 서 있으면 첫 칸의 열 자리(`first`). 칸 수는 따지지 않는다(대상 칸이
 * 없으면 `first` 는 -1 이다 — 칸 수 판정은 투영 몫).
 *
 * 사이에 낀 칸이 입력칸 등이면 「보기 칸이 아닌 것이 섞였다」, 다른 그룹 보기·병합 칸·숨은 칸이면 비연속이다.
 * 행에 없는 칸·열 밖의 칸이 대상이어도 비연속이다.
 */
export function locateScaleColumnRun(input: LocateScaleColumnRunInput): ScaleColumnRun {
  const { row, targetCells } = input;
  const indices = targetCells.map((cell) => row.cells.findIndex((c) => c.id === cell.id));
  if (indices.some((index) => index < 0 || index >= input.columnCount)) {
    return { ok: false, reason: 'non-contiguous' };
  }
  for (let i = 1; i < indices.length; i += 1) {
    const prev = indices[i - 1]!;
    const next = indices[i]!;
    if (next === prev + 1) continue;
    const between = row.cells.slice(prev + 1, Math.max(next, prev + 1));
    const hasNonChoice = between.some(
      (cell) => isScaleVisibleCell(cell) && cell.type !== 'choice_opt',
    );
    return { ok: false, reason: hasNonChoice ? 'non-choice-cell' : 'non-contiguous' };
  }
  return { ok: true, first: indices[0] ?? -1 };
}

export interface ScaleHeaderBand {
  label: string;
  /** 구간의 첫 칸 — 대상 칸 순서(0부터) */
  start: number;
  /** 구간이 덮는 칸 수 */
  span: number;
}

export interface ScaleHeaderCell {
  /** 원래 보기 칸 id — 저장 키 그대로 */
  cellId: string;
  /** 칸 글자 */
  text: string;
  /** 칸 이름 — 칸 줄에서 읽은 이름. 없거나 칸 글자와 같거나 번호뿐이면 싣지 않는다 */
  name?: string;
  /** 이 칸을 덮는 구간(`bands` 의 자리), 없으면 null */
  bandIndex: number | null;
}

export interface ScaleHeaderReading {
  /** 대상 칸 순서 그대로 */
  cells: ScaleHeaderCell[];
  bands: ScaleHeaderBand[];
}

export interface ReadScaleHeaderInput {
  /** 행의 셀과 인덱스가 맞는 열 — 표시 조건으로 걸러진 뒤의 열이어야 한다 */
  columns: readonly TableColumn[];
  /** columns 와 짝이 맞는(같이 걸러진) 헤더 격자 */
  headerGrid?: HeaderCell[][] | undefined;
  /** 대상 칸이 선 첫 열 자리 — `locateScaleColumnRun` 의 결과 */
  first: number;
  /** 이어진 열에 선 이 행의 보기 칸(행 순서) */
  targetCells: readonly TableCell[];
}

interface Segment {
  label: string;
  start: number;
  span: number;
}

type HeaderLine = { role: 'title' } | { role: 'cells' | 'bands'; segments: Segment[] };

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
      const label = normalizeScaleLabel(item.cell.label ?? '');
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

/**
 * 다단 헤더(headerGrid)가 없는 표 — 헤더는 열 제목 한 줄이다. 그 줄을 칸 줄로 읽는다.
 * 빠뜨리면 「전혀 중요하지 않음 … 매우 중요」가 열 제목에만 있는 척도 표에서 번호만 남는다.
 */
function columnLabelLines(
  columns: ReadonlyArray<{ label?: string | undefined }>,
  first: number,
  count: number,
): HeaderLine[] {
  const segments: Segment[] = [];
  for (let i = 0; i < count; i += 1) {
    const label = normalizeScaleLabel(columns[first + i]?.label ?? '');
    if (label !== '') segments.push({ label, start: i, span: 1 });
  }
  if (segments.length === 0) return [];
  return [{ role: segments.length === count ? 'cells' : 'bands', segments }];
}

/**
 * 칸 줄들에서 i번째 칸의 **이름** — 보기에 가까운 아래 줄부터 보고, 비었거나 칸 글자와 같거나 번호뿐인
 * 글자는 건너뛴다. 원문 조사표처럼 머리에 이름 줄(「전혀 그렇지 않다 …」)과 번호 줄(「① … ⑤」)이 함께
 * 있고 칸에는 컨트롤만 둔 표에서, 번호가 칸 글자가 되고 이름은 그 윗줄에서 온다.
 */
function cellNameAt(lines: HeaderLine[], i: number, text: string): string | undefined {
  for (let l = lines.length - 1; l >= 0; l -= 1) {
    const line = lines[l]!;
    if (line.role !== 'cells') continue;
    const label = line.segments[i]?.label ?? '';
    if (label !== '' && label !== text && !isNumberMarkLabel(label)) return label;
  }
  return undefined;
}

/** 가장 아래(보기에 가장 가까운) 해당 역할 줄 */
function lastLine(lines: HeaderLine[], role: 'cells' | 'bands'): Segment[] | undefined {
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = lines[i]!;
    if (line.role === role && line.segments.length > 0) return line.segments;
  }
  return undefined;
}

/** 대상 칸의 칸 글자 · 칸 이름 · 구간. 칸 글자를 읽을 수 없는 칸이 하나라도 있으면 null */
export function readScaleHeader(input: ReadScaleHeaderInput): ScaleHeaderReading | null {
  const { columns, first, targetCells } = input;
  const count = targetCells.length;
  const lines =
    input.headerGrid && input.headerGrid.length > 0
      ? classifyHeaderLines(input.headerGrid, first, count)
      : columnLabelLines(columns, first, count);
  const cellLine = lastLine(lines, 'cells');
  const bandLine = lastLine(lines, 'bands') ?? [];

  // 보기 칸 글자가 있는 칸은 그 글자를 쓴다. 한 칸짜리 구간 이름은 글자가 빈 칸에서만 칸 글자가 된다 —
  // 남기면 양끝 라벨·선택값 표시가 칸 글자를 되풀이하고 척도 끝 구간의 이름을 밀어낸다.
  const texts: string[] = [];
  const namedByBand = new Set<number>();
  for (let i = 0; i < count; i += 1) {
    const own = normalizeScaleLabel(targetCells[i]!.content ?? '');
    if (own !== '') {
      texts.push(own);
      continue;
    }
    const fromCellLine = cellLine?.[i]?.label ?? '';
    if (fromCellLine !== '') {
      texts.push(fromCellLine);
      continue;
    }
    const ownBand = bandLine.find((band) => band.start === i && band.span === 1);
    if (!ownBand) return null;
    texts.push(ownBand.label);
    namedByBand.add(i);
  }

  const bands: ScaleHeaderBand[] = bandLine
    .filter((band) => !(band.span === 1 && namedByBand.has(band.start)))
    .map(({ label, start, span }) => ({ label, start, span }));
  const bandIndexAt = (i: number): number | null => {
    const found = bands.findIndex((band) => i >= band.start && i < band.start + band.span);
    return found < 0 ? null : found;
  };

  const cells: ScaleHeaderCell[] = targetCells.map((cell, i) => {
    const text = texts[i]!;
    const name = cellNameAt(lines, i, text);
    return {
      cellId: cell.id,
      text,
      ...(name !== undefined ? { name } : {}),
      bandIndex: bandIndexAt(i),
    };
  });
  return { cells, bands };
}
