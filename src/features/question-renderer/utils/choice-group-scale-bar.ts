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
 *   5칸 이하 칸 안 라벨, 6칸 이상(구간 줄 없음)은 막대 아래 칸 이름 목록
 *   칸 줄이 둘이면(이름 줄 + 번호 줄) 칸 글자는 아래 줄, 이름은 번호뿐이 아닌 가장 가까운 줄(cellNameAt)
 * - 구간 줄: 그 밖(여러 칸을 묶었거나 일부 칸만 이름이 있다) — 구간 띠·양끝/가운데 라벨·선택값 표시
 *   칸 글자가 빈 칸을 그 칸만 덮는 한 칸짜리 이름이 덮으면 그 이름이 칸 글자가 되고 구간에서는 빠진다
 *   (머리에만 「미참여」를 적고 칸에는 컨트롤만 둔 척도 밖 보기 칸)
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
  /**
   * 6칸 이상이고 칸마다 이름이 따로 있을 때 막대 아래 목록에 적는 그 칸의 이름 — 칸 폭(약 50px)에는
   * 이름이 들어가지 않고, 구간 줄이 없어 양끝 라벨·선택값 표시도 쓸 수 없는 척도다. 전부 있거나 전부 없다.
   */
  legendLabel?: string;
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
  /**
   * 막대 아래 라벨 — 6칸 이상만. 라벨은 제 구간에 붙는다: 왼쪽은 구간 첫 칸에서 오른쪽으로, 오른쪽은
   * 구간 끝 칸에서 왼쪽으로, 가운데는 구간 가운데에 둔다(배치는 `resolveScaleBarAnchorLayout`).
   * - `leftStart`·`rightEnd`: 라벨이 붙는 칸 — 막대의 첫 칸·끝 칸이면 싣지 않는다(척도 밖 보기 칸이
   *   끝에 낀 막대에서만 생긴다)
   * - `middle.index`: 가운데 구간의 첫 칸, `middle.span`: 그 구간의 칸 수(한 칸이면 싣지 않는다)
   */
  anchors: {
    left?: string;
    leftStart?: number;
    middle?: { label: string; index: number; span?: number };
    right?: string;
    rightEnd?: number;
  };
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
  /**
   * 가운데 구간 이름(`ChoiceGroup.mobileScaleBarMiddleLabel`) — 척도 한가운데의 여러 칸짜리 구간 이름도
   * 그 띠 아래에 둔다. 끄면(기본) 한 칸짜리 정가운데 구간만 가운데 라벨이다.
   */
  middleBandLabel?: boolean | undefined;
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

/** 막대 칸 글자 크기(13px) 기준 글자 폭 어림 — 한글·한자·전각은 한 글자 13px, 그 밖은 7.5px */
const WIDE_CHAR = /[\u1100-\u11FF\u2E80-\u9FFF\uAC00-\uD7AF\uF900-\uFAFF\uFF00-\uFFEF]/u;
/** 이 폭부터 긴 글자로 본다 — 한글 세 글자(「미참여」). 「10점」·「모름」·「N/A」는 좁은 칸에도 들어간다 */
const LONG_TEXT_MIN_PX = 36;
/** 칸 좌우 안쪽 여백(px-0.5 × 2)과 여유 */
const CELL_TEXT_PADDING_PX = 6;
/**
 * 넓힐지 가르는 기준 막대 폭 — 390px 화면에서 카드 안 막대가 차지하는 폭. 고르게 나눈 칸 폭이 글자보다
 * 넉넉한 막대(6·7칸에 낱말 라벨)는 넓히지 않는다 — 이미 들어가는 칸까지 건드리면 운영 중인 막대의 칸 폭이
 * 화면에 따라 달라진다.
 */
const REFERENCE_BAR_WIDTH_PX = 324;
/** 가장 좁은 화면(320px)에서의 막대 폭 — 넓힌 칸들이 이 폭 안에 나머지 칸의 자리를 남겨야 한다 */
const NARROW_BAR_WIDTH_PX = 254;
/** 넓히지 않는 칸에 남겨야 하는 최소 폭 — 번호 글자(13px)와 여백이 들어가는 폭 */
const OTHER_CELL_MIN_PX = 18;

/** 칸 글자가 길어 넓혀야 하는 칸의 폭 — 줄바꿈되는 자리(공백)로 나눈 가장 긴 낱말로 잰다(`break-keep`) */
function longTextWidth(text: string, count: number): number | undefined {
  const widest = Math.max(
    ...text.split(/\s+/).map((word) =>
      [...word].reduce((sum, char) => sum + (WIDE_CHAR.test(char) ? 13 : 7.5), 0),
    ),
  );
  if (widest < LONG_TEXT_MIN_PX) return undefined;
  const width = Math.ceil(widest) + CELL_TEXT_PADDING_PX;
  return width > REFERENCE_BAR_WIDTH_PX / count ? width : undefined;
}

/** 가운데 라벨이 쓸 수 있는 폭의 상한 — 넘으면 줄을 바꾼다(양끝 라벨의 자리를 남긴다) */
const SCALE_BAR_MIDDLE_LABEL_MAX = '40%';

/**
 * 막대 아래 라벨 줄의 배치 — 격자선은 막대와 같은 열 틀의 것이다.
 * - `spread`: 가운데 라벨이 없다. 라벨 줄(왼쪽 라벨의 첫 칸 ~ 오른쪽 라벨의 끝 칸) 안에서 양끝으로 벌린다.
 * - `centered`: 가운데 구간이 라벨 줄의 한가운데다. 세 자리 틀(양옆 같은 폭 · 가운데는 글자만큼)이라 양끝 라벨이
 *   남는 폭을 넉넉히 나눠 쓴다.
 * - `zones`: 가운데 구간이 한쪽으로 치우쳤거나 줄 안에 폭이 다른 칸이 있다. 세 자리 틀의 한가운데가 구간의
 *   가운데와 어긋나므로 라벨을 막대의 칸에 직접 붙인다 — 가운데 라벨은 제 구간 칸 아래, 양끝 라벨은 그 앞뒤 칸 아래.
 */
export type ScaleBarAnchorLayout =
  | { kind: 'spread'; gridColumn: string }
  | { kind: 'centered'; gridColumn: string; template: string }
  | { kind: 'zones'; left: string; middle: string; right: string };

/**
 * 막대 아래 라벨 줄의 배치. 라벨은 제 구간에 붙되(왼쪽은 구간 첫 칸에서, 오른쪽은 구간 끝 칸까지, 가운데는
 * 구간 가운데) **서로 겹치지 않게 자리를 나눠 쓰고, 길면 줄을 바꾼다** — 전에는 한 줄로 겹쳐 놓아
 * 긴 번역 라벨(베트남어 「Tốt hơn nhiều so với kỳ vọng」)이 서로를 덮었다(2026-11-24). 한 줄에 들어가는
 * 라벨은 자리가 종전과 같다.
 *
 * `unevenCells` 는 칸마다 「폭이 다른 칸인가」(글자가 길어 최소 폭을 받은 칸 — `resolveScaleBarCellMinWidths`).
 * 그런 칸이 라벨 줄 안에 있으면 줄의 한가운데가 가운데 구간의 가운데가 아니다.
 */
export function resolveScaleBarAnchorLayout(
  anchors: ScaleBarModel['anchors'],
  count: number,
  unevenCells: readonly boolean[] = [],
): ScaleBarAnchorLayout {
  const start = anchors.leftStart ?? 0;
  const end = anchors.rightEnd ?? count - 1;
  const gridColumn = `${start + 1} / ${end + 2}`;
  const middle = anchors.middle;
  if (!middle) return { kind: 'spread', gridColumn };
  const span = middle.span ?? 1;
  const before = middle.index - start;
  const after = end - (middle.index + span - 1);
  const even = !unevenCells.slice(start, end + 1).some(Boolean);
  if (before === after && before >= 0 && even) {
    return {
      kind: 'centered',
      gridColumn,
      template: `minmax(0, 1fr) fit-content(${SCALE_BAR_MIDDLE_LABEL_MAX}) minmax(0, 1fr)`,
    };
  }
  return {
    kind: 'zones',
    left: `${start + 1} / ${middle.index + 1}`,
    middle: `${middle.index + 1} / span ${span}`,
    right: `${middle.index + span + 1} / ${end + 2}`,
  };
}

/**
 * 막대 칸마다의 최소 폭(px) — 칸 글자가 고르게 나눈 칸 폭에 들어가지 않을 만큼 길 때만 값이 있다(「미참여」).
 * 막대는 그 칸을 글자만큼 넓히고 나머지 칸이 그만큼 좁아진다. 번호·짧은 낱말 칸과 칸이 넉넉한 막대는 없다.
 *
 * **화면에 보이는 글자**를 넘긴다 — 명단 토큰·응답 인용은 치환한 뒤의 글자여야 한다(토큰 이름의 길이로 재면
 * 보이는 글자와 무관하게 칸이 넓어진다). 그래서 투영(projectScaleBar)이 아니라 그리는 쪽이 부른다.
 *
 * 넓힐 칸이 많아 가장 좁은 화면에서 나머지 칸의 자리가 남지 않으면 아무 칸도 넓히지 않는다 — 최소 폭의 합이
 * 막대 폭을 넘으면 뒤쪽 칸이 화면 밖으로 밀려 누를 수 없게 된다. 그럴 때는 고르게 나누는 종전 모양이 낫다.
 */
export function resolveScaleBarCellMinWidths(texts: readonly string[]): (number | undefined)[] {
  const widths = texts.map((text) => longTextWidth(text, texts.length));
  const widened = widths.filter((width): width is number => width !== undefined);
  if (widened.length === 0) return widths;
  const needed =
    widened.reduce((sum, width) => sum + width, 0) +
    (texts.length - widened.length) * OTHER_CELL_MIN_PX;
  return needed <= NARROW_BAR_WIDTH_PX ? widths : texts.map(() => undefined);
}

function fallback(reason: ScaleBarFallbackReason): ScaleBarProjection {
  return { ok: false, reason };
}

/** 막대 판정이 보는 칸 — 숨김·병합으로 이어진 칸은 없는 칸이다. 행 판정·빌더 진단도 이 기준을 쓴다 */
export function isScaleBarVisibleCell(cell: TableCell): boolean {
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

/**
 * 다단 헤더(headerGrid)가 없는 표 — 헤더는 열 제목 한 줄이다. 그 줄을 칸 줄로 읽는다.
 * 빠뜨리면 「전혀 중요하지 않음 … 매우 중요」가 열 제목에만 있는 척도 표에서 막대에 번호만 남는다.
 */
function columnLabelLines(
  columns: ReadonlyArray<{ label?: string | undefined }>,
  first: number,
  count: number,
): HeaderLine[] {
  const segments: Segment[] = [];
  for (let i = 0; i < count; i += 1) {
    const label = normalizeLabel(columns[first + i]?.label ?? '');
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
    if (label !== '' && label !== text && !NUMBER_MARK.test(label)) return label;
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
    const hasNonChoice = between.some(
      (cell) => isScaleBarVisibleCell(cell) && cell.type !== 'choice_opt',
    );
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
      : columnLabelLines(columns, first, count);
  const cellLine = lastLine(lines, 'cells');
  const bandLine = lastLine(lines, 'bands') ?? [];

  // 칸 글자의 출처는 보기 칸 글자 → 칸 줄 → 그 칸만 덮는 한 칸짜리 구간 이름 순이다. 마지막은 머리에만
  // 「미참여」를 적고 칸에는 컨트롤만 둔 척도 밖 보기 칸이다 — 그 이름은 구간이 아니라 칸의 이름이라
  // 구간에서 뺀다(남기면 양끝 라벨·선택값 표시가 칸 글자를 되풀이하고 척도 끝 구간의 이름을 밀어낸다).
  // 보기 칸 글자가 있는 칸은 종전대로 읽는다 — 이 출처는 전에 「칸 글자 없음」 폴백이던 막대에서만 쓰인다.
  const texts: string[] = [];
  const namedByBand = new Set<number>();
  for (let i = 0; i < count; i += 1) {
    const own = normalizeLabel(targetCells[i]!.content ?? '');
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
    if (!ownBand) return fallback('missing-text');
    texts.push(ownBand.label);
    namedByBand.add(i);
  }

  const bands: ScaleBarBand[] = bandLine
    .filter((band) => !(band.span === 1 && namedByBand.has(band.start)))
    .map(({ label, start, span }) => ({ label, start, span }));
  const bandIndexAt = (i: number): number | null => {
    const found = bands.findIndex((band) => i >= band.start && i < band.start + band.span);
    return found < 0 ? null : found;
  };

  /** 6칸 이상 — 라벨을 칸 안이 아니라 막대 아래(양끝·가운데)와 선택값 표시로 보인다 */
  const labelsBelowBar = count > IN_CELL_LABEL_MAX_CELLS;
  // 5칸 이하는 칸 폭(약 70px)이 넉넉해 라벨을 칸 안에 넣는다 — 칸 줄의 이름(cellNameAt), 없으면 그 칸을
  // 덮는 한 칸짜리 구간 이름. 여러 칸짜리 구간 이름은 한 칸에 붙일 수 없어 구간 띠로만 드러낸다. 칸 글자와
  // 같은 라벨(보기 칸 글자가 곧 라벨이거나 칸 글자를 칸 줄에서 가져온 경우)은 되풀이하지 않는다.
  const inCellLabelAt = (i: number, text: string, bandIndex: number | null): string | undefined => {
    if (labelsBelowBar) return undefined;
    const fromCells = cellNameAt(lines, i, text);
    if (fromCells !== undefined) return fromCells;
    const band = bandIndex === null ? undefined : bands[bandIndex];
    const label = band?.span === 1 ? band.label : undefined;
    return label !== undefined && label !== '' && label !== text && !NUMBER_MARK.test(label)
      ? label
      : undefined;
  };

  // 6칸 이상인데 구간 줄이 없으면 칸 이름이 설 자리가 없다 — 칸마다 이름이 따로 있는 척도(「ⓞ 전혀
  // 관련 없음 · ① 전혀 도움되지 않음 …」)는 막대 아래에 「칸 글자 + 이름」 목록으로 적는다. 한 칸이라도
  // 이름이 없거나 번호뿐이거나 칸 글자와 같으면 목록을 두지 않는다(반쪽 목록은 빠진 칸을 숨긴다).
  const legendNames =
    labelsBelowBar && bands.length === 0 && cellLine
      ? texts.map((text, i) => cellNameAt(lines, i, text) ?? null)
      : [];
  const hasLegend = legendNames.length === count && legendNames.every((name) => name !== null);

  const cells: ScaleBarCell[] = targetCells.map((cell, i) => {
    const text = texts[i]!;
    const bandIndex = bandIndexAt(i);
    const inCellLabel = inCellLabelAt(i, text, bandIndex);
    return {
      cellId: cell.id,
      text,
      ...(inCellLabel !== undefined ? { inCellLabel } : {}),
      ...(hasLegend ? { legendLabel: legendNames[i]! } : {}),
      bandIndex,
    };
  });

  const anchors: ScaleBarModel['anchors'] = {};
  if (labelsBelowBar && bands.length > 0) {
    // 가운데 라벨은 정가운데 칸을 덮는 구간이 한 칸짜리일 때만 — 여러 칸짜리 구간 이름을 막대 아래에
    // 쓰면 긴 양끝 라벨과 겹친다. 그런 이름은 구간 띠와 선택값 표시로만 드러낸다.
    let middleBand: number | null = null;
    if (count % 2 === 1) {
      const index = (count - 1) / 2;
      const centerBand = cells[index]!.bandIndex;
      if (centerBand !== null && bands[centerBand]!.span === 1) middleBand = centerBand;
    }
    // 「가운데 구간 이름」을 켠 그룹은 여러 칸짜리도 쓴다 — 이름 있는 구간이 덮는 범위(척도 밖 보기 칸은
    // 구간 이름이 없어 빠진다)의 한가운데에 놓인 구간이다. 양끝 구간은 가운데가 될 수 없다.
    if (middleBand === null && input.middleBandLabel === true && bands.length >= 3) {
      const first = bands[0]!;
      const last = bands[bands.length - 1]!;
      const center = (first.start + last.start + last.span) / 2;
      const found = bands.findIndex(
        (band, index) =>
          index > 0 && index < bands.length - 1 && band.start + band.span / 2 === center,
      );
      if (found >= 0) middleBand = found;
    }
    if (middleBand !== null) {
      const band = bands[middleBand]!;
      anchors.middle = {
        label: band.label,
        index: band.start,
        ...(band.span > 1 ? { span: band.span } : {}),
      };
    }
    // 양끝 라벨은 첫 칸·끝 칸을 덮는 구간의 이름이다. 그 칸에 구간 이름이 없으면(「미참여」·「모름」 같은
    // 척도 밖 보기 칸) 이름 있는 첫·끝 구간을 쓰고 그 구간에 붙인다 — 비워 두면 척도의 한쪽 끝이 무엇인지
    // 보이지 않는다. 가운데로 쓴 구간과 반대쪽 라벨이 된 구간은 다시 쓰지 않는다.
    const leftBand = cells[0]!.bandIndex ?? (middleBand === 0 ? null : 0);
    if (leftBand !== null) {
      const band = bands[leftBand]!;
      anchors.left = band.label;
      if (band.start > 0) anchors.leftStart = band.start;
    }
    const lastBand = bands.length - 1;
    const rightBand =
      cells[count - 1]!.bandIndex ??
      (lastBand === middleBand || lastBand === leftBand ? null : lastBand);
    if (rightBand !== null) {
      const band = bands[rightBand]!;
      const end = band.start + band.span - 1;
      anchors.right = band.label;
      if (end < count - 1) anchors.rightEnd = end;
    }
  }

  return {
    ok: true,
    model: { cells, bands, anchors, showsSelectionLabel: labelsBelowBar && bands.length > 0 },
  };
}

export interface ScaleBarBandTone {
  /** 정가운데보다 왼쪽 구간은 negative, 오른쪽은 positive, 가운데를 덮는 구간은 neutral */
  side: 'negative' | 'neutral' | 'positive';
  /** 끝 구간(「매우 …」)은 짙게 — 그쪽에 구간이 둘 이상일 때만 */
  strong: boolean;
}

/**
 * 구간 띠의 색 — 왼쪽 붉은색 · 가운데 회색 · 오른쪽 파란색, 양끝 구간은 짙게. 빈도·중요도처럼 양극이
 * 아닌 척도도 같은 색이다(회색 농담만으로는 구간이 잘 구별되지 않는다는 판단, 2026-09-30).
 */
export function resolveScaleBarBandTones(
  bands: readonly ScaleBarBand[],
  count: number,
): ScaleBarBandTone[] {
  const mid = count / 2;
  const sides = bands.map((band): ScaleBarBandTone['side'] => {
    const end = band.start + band.span;
    if (end <= mid) return 'negative';
    if (band.start >= mid) return 'positive';
    return 'neutral';
  });
  const negatives = sides.filter((side) => side === 'negative').length;
  const positives = sides.filter((side) => side === 'positive').length;
  return bands.map((band, index) => {
    const side = sides[index]!;
    const strong =
      (side === 'negative' && band.start === 0 && negatives > 1) ||
      (side === 'positive' && band.start + band.span === count && positives > 1);
    return { side, strong };
  });
}
