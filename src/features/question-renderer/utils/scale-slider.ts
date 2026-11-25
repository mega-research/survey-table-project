import type { ScaleSliderDirection } from '@/types/scale-slider';
import type { ChoiceGroup, HeaderCell, TableCell, TableColumn, TableRow } from '@/types/survey';

import {
  isNumberMarkLabel,
  locateScaleColumnRun,
  normalizeScaleLabel,
  readOwnColumnHeaderName,
  readScaleHeader,
} from './scale-header-reading';

/**
 * 척도 한 줄을 **척도 슬라이더**(타일 줄 + 트랙)로 그리기 위한 투영 — 슬라이더를 그릴지와 무엇을 쓸지의
 * 유일한 판정 지점이다(CONTEXT.md 「척도 슬라이더」). 응답 화면과 빌더 경고가 같은 함수를 부른다.
 *
 * ── 배선과 규칙 ──
 * - 척도 막대 투영(choice-group-scale-bar)과 같은 층·같은 입력 모양에 긍정 방향을 더한다. 헤더 읽기는 둘이
 *   함께 쓰는 코어(scale-header-reading)가 하고, 이 투영은 그 결과를 슬라이더의 모양으로 옮긴다.
 *   **값은 건드리지 않는다** — 모델이 싣는 id 는 호스트의 기존 토글이 받는 id 그대로다.
 * - **모델은 「칸」이 아니라 「고르는 것」을 싣는다**(`choiceId`). 표에서는 보기 칸 id 이고, 보통 라디오 문항의
 *   보기 목록을 같은 모델로 옮기는 투영이 같은 타입을 쓴다.
 * - **대상 칸을 둘로 가른다** — 「평균에서 제외」(`excludeFromMean`)가 붙은 칸은 척도 밖 보기(트랙 옆 체크),
 *   나머지는 눈금이다. 눈금 수는 2~13 이고 척도 밖 보기는 세지 않는다.
 * - **타일 종류**는 셋 중 하나다.
 *   - `point`: 눈금마다 이름이 있다 — 칸 줄의 이름(코어의 칸 이름), 없으면 번호뿐이 아닌 칸 글자 자체.
 *     눈금마다 타일 한 장이고 누를 수 있다. 한 눈금이라도 이름이 없으면 점 타일이 아니다(반쪽 타일 줄은
 *     빠진 눈금을 숨긴다).
 *   - `band`: 점 이름은 없고 구간이 있다. 구간마다 타일 한 장이고 누를 수 없으며, 폭은 덮는 눈금 수다.
 *     **타일 상자는 구간이 눈금을 빠짐없이 덮을 때만 그린다**(`bandsCoverAllTicks`). 양끝에만 이름이 있는
 *     11점처럼 덮지 못하는 척도는 구간 이름을 글자로만 둔다 — 좁은 폭에서 한 칸짜리 타일에 이름이 들어가지
 *     않는다. 그 글자의 자리는 `resolveScaleSliderBandTextLayout` 이 정한다.
 *   - `none`: 이름도 구간도 없다(번호뿐인 척도).
 *   - 점 이름과 구간이 둘 다 있으면 점 타일이다. 구간은 `bands` 에 남아 고른 값 표시에만 쓰인다.
 * - **눈금 글자**(`mark`): 눈금 아래에 적는 칸 글자. 그 눈금의 타일 이름과 같으면 싣지 않는다(한 번만 보인다).
 * - **고른 값 표시**(「칸 글자 · 구간 이름」)는 구간이 있을 때만 쓴다. 점 타일만 있는 척도는 고른 타일이 곧 표시다.
 * - **쪽**(부정 · 중립 · 긍정)은 눈금 줄의 정가운데 기준이다. 눈금은 제 자리로, 구간은 구간의 가운데 자리로
 *   가른다. 정가운데면 중립이라 짝수 눈금에는 중립 눈금이 없다(정가운데에 놓인 구간은 짝수에서도 중립이다).
 *   긍정 방향이 왼쪽이면 뒤집는다. 방향은 색만 정한다 — 눈금 순서는 그대로다.
 * - **척도 밖 보기의 글자**: 그 칸의 글자, 비어 있으면 그 칸만 덮는 한 칸짜리 머리 이름. 칸 글자가 번호뿐이고
 *   (「⑨」) 머리에 이름이 있으면(「모름」) 머리 이름이다 — 눈금은 번호와 이름을 둘 다 싣지만 체크는 글자가
 *   하나뿐이라, 번호만 보이면 무엇을 고르는지 알 수 없다.
 * - **폴백**: 그릴 수 없으면 이유 코드를 돌려주고 호출부는 다음 모양(원본 한 줄)으로 그린다. 이유 코드는
 *   척도 막대와 같은 글자를 쓴다 — 빌더 경고가 이유별 문구로 옮긴다. 판정 순서도 막대와 같다.
 *   - 대상 칸(눈금 + 척도 밖 보기) 전체가 이어진 열에 서 있어야 하고, 그 안에서 눈금끼리도 이어져야 한다.
 *     즉 척도 밖 보기는 눈금 줄의 앞이나 뒤에만 붙을 수 있다 — 눈금 사이에 끼면 비연속이다.
 *   - 상세 기재·단독 선택은 눈금과 척도 밖 보기 어느 쪽에 있어도 폴백이다(체크에도 입력칸을 붙일 수 없다).
 * - 고정 문구는 없다. 모든 글자는 보기 칸의 평문 content 와 헤더에서만 읽는다(토큰은 그리는 쪽이 푼다).
 */

export type ScaleSliderSide = 'negative' | 'neutral' | 'positive';

export type ScaleSliderTileKind = 'point' | 'band' | 'none';

export interface ScaleSliderTick {
  /** 고르는 것의 id — 표에서는 보기 칸 id. 호스트의 토글에 그대로 넘긴다 */
  choiceId: string;
  /** 칸 글자 — 고른 값 표시(「칸 글자 · 구간 이름」)와 낭독의 재료. 언제나 있다 */
  text: string;
  /** 점 타일의 이름 — 타일 종류가 `point` 일 때만, 그때는 모든 눈금에 있다 */
  name?: string;
  /** 눈금 아래에 적는 글자 — 타일 이름과 같으면 없다 */
  mark?: string;
  side: ScaleSliderSide;
  /** 이 눈금을 덮는 구간(`bands` 의 자리), 없으면 null */
  bandIndex: number | null;
}

export interface ScaleSliderBand {
  label: string;
  /** 구간의 첫 눈금(0부터) */
  start: number;
  /** 구간이 덮는 눈금 수 */
  span: number;
  side: ScaleSliderSide;
}

/** 척도 밖 보기 — 눈금이 아니라 트랙 옆 체크로 뗀다 */
export interface ScaleSliderOffScaleChoice {
  choiceId: string;
  label: string;
}

export interface ScaleSliderModel {
  tileKind: ScaleSliderTileKind;
  /** 눈금 — 행 순서 그대로 */
  ticks: ScaleSliderTick[];
  /** 구간 — 타일 종류가 `band` 면 이것이 타일 줄이고, `point` 면 고른 값 표시에만 쓴다 */
  bands: ScaleSliderBand[];
  /** 척도 밖 보기 — 행 순서 그대로 */
  offScale: ScaleSliderOffScaleChoice[];
  /** 고른 눈금의 「칸 글자 · 구간 이름」 표시를 쓰는가 — 구간이 있을 때 */
  showsSelectionLabel: boolean;
  /**
   * 구간이 눈금을 빠짐없이 덮는가 — 타일 종류가 `band` 일 때 타일 상자를 그릴지를 가른다. 덮지 못하면
   * 구간 이름을 글자로만 둔다. 구간이 없으면 false.
   */
  bandsCoverAllTicks: boolean;
}

/** 척도 막대의 폴백 이유와 같은 글자다 — `cell-count` 는 여기서 눈금 수(2~13)를 뜻한다 */
export type ScaleSliderFallbackReason =
  | 'not-single-choice'
  | 'non-choice-cell'
  | 'non-contiguous'
  | 'cell-count'
  | 'text-input'
  | 'exclusive-choice'
  | 'missing-text';

export type ScaleSliderProjection =
  { ok: true; model: ScaleSliderModel } | { ok: false; reason: ScaleSliderFallbackReason };

export interface ProjectScaleSliderInput {
  /** 선택 방식 — 보기 그룹이면 그룹 종류, 그룹 없는 행이면 문항의 선택 방식 */
  selectionType: ChoiceGroup['type'];
  /** 행의 셀과 인덱스가 맞는 열 — 표시 조건으로 걸러진 뒤의 열이어야 한다 */
  columns: readonly TableColumn[];
  /** columns 와 짝이 맞는(같이 걸러진) 헤더 격자 */
  headerGrid?: HeaderCell[][] | undefined;
  row: TableRow;
  /** 슬라이더가 될 이 행의 보기 칸(보이는 것만, 행 순서) — 눈금과 척도 밖 보기를 함께 넘긴다 */
  targetCells: readonly TableCell[];
  /** 긍정 방향 — 묶음·문항의 슬라이더 방향 값 */
  direction: ScaleSliderDirection;
}

/** 좁은 화면(390px)에서 눈금 간격이 26px 남짓 되는 한계 */
export const SCALE_SLIDER_MAX_TICKS = 13;
export const SCALE_SLIDER_MIN_TICKS = 2;

/**
 * 쪽 — 눈금 줄의 정가운데보다 왼쪽·오른쪽·한가운데. 반 칸을 정수로 다루려고 자리를 두 배로 견준다
 * (`doubledCenter`: 눈금 i 는 2i, 구간은 2·start + span − 1).
 */
function sideOf(
  doubledCenter: number,
  tickCount: number,
  direction: ScaleSliderDirection,
): ScaleSliderSide {
  const middle = tickCount - 1;
  if (doubledCenter === middle) return 'neutral';
  const leftOfMiddle = doubledCenter < middle;
  return leftOfMiddle === (direction === 'positive-left') ? 'positive' : 'negative';
}
export { sideOf as resolveScaleSliderSide }; // 라디오 보기 투영(radio-option-scale-slider)이 같은 쪽 계산을 쓴다

/** 구간이 첫 눈금부터 끝 눈금까지 틈 없이 이어지는가 */
function coversAllTicks(bands: readonly ScaleSliderBand[], tickCount: number): boolean {
  let next = 0;
  for (const band of bands) {
    if (band.start !== next) return false;
    next = band.start + band.span;
  }
  return bands.length > 0 && next === tickCount;
}

function fallback(reason: ScaleSliderFallbackReason): ScaleSliderProjection {
  return { ok: false, reason };
}

export function projectScaleSlider(input: ProjectScaleSliderInput): ScaleSliderProjection {
  const { row, targetCells, columns, direction } = input;
  if (input.selectionType !== 'radio') return fallback('not-single-choice');
  if (targetCells.some((cell) => cell.type !== 'choice_opt')) return fallback('non-choice-cell');

  const columnCount = columns.length;
  const run = locateScaleColumnRun({ row, columnCount, targetCells });
  if (!run.ok) return fallback(run.reason);

  const tickCells = targetCells.filter((cell) => cell.excludeFromMean !== true);
  const offScaleCells = targetCells.filter((cell) => cell.excludeFromMean === true);
  // 대상 전체는 이어져 있으므로 여기서 끊기는 것은 척도 밖 보기가 눈금 사이에 낀 경우뿐이다
  const tickRun = locateScaleColumnRun({ row, columnCount, targetCells: tickCells });
  if (!tickRun.ok) return fallback(tickRun.reason);

  const count = tickCells.length;
  if (count < SCALE_SLIDER_MIN_TICKS || count > SCALE_SLIDER_MAX_TICKS) {
    return fallback('cell-count');
  }
  if (targetCells.some((cell) => cell.allowTextInput === true)) return fallback('text-input');
  if (targetCells.some((cell) => cell.exclusiveChoice === true)) {
    return fallback('exclusive-choice');
  }

  const reading = readScaleHeader({
    columns,
    headerGrid: input.headerGrid,
    first: tickRun.first,
    targetCells: tickCells,
  });
  if (!reading) return fallback('missing-text');

  const offScale: ScaleSliderOffScaleChoice[] = [];
  for (const cell of offScaleCells) {
    const own = normalizeScaleLabel(cell.content ?? '');
    const ownIsName = own !== '' && !isNumberMarkLabel(own);
    const headName = ownIsName
      ? undefined
      : readOwnColumnHeaderName({
          columns,
          headerGrid: input.headerGrid,
          index: row.cells.findIndex((c) => c.id === cell.id),
        });
    // 칸 글자가 번호뿐이면 머리의 이름이 이긴다. 머리도 번호뿐이면 칸에 적힌 글자를 그대로 둔다
    const headWins = headName !== undefined && (own === '' || !isNumberMarkLabel(headName));
    const label = headWins ? headName : own !== '' ? own : undefined;
    if (label === undefined) return fallback('missing-text');
    offScale.push({ choiceId: cell.id, label });
  }

  // 점 타일의 이름 — 칸 줄의 이름, 없으면 번호뿐이 아닌 칸 글자 자체. 코어의 칸 이름은 칸 글자와 같거나
  // 번호뿐이면 이미 빠져 있다.
  const names = reading.cells.map(
    (cell) => cell.name ?? (isNumberMarkLabel(cell.text) ? undefined : cell.text),
  );
  const hasPointNames = names.every((name) => name !== undefined);
  const tileKind: ScaleSliderTileKind = hasPointNames
    ? 'point'
    : reading.bands.length > 0
      ? 'band'
      : 'none';

  const ticks: ScaleSliderTick[] = reading.cells.map((cell, i) => {
    const name = hasPointNames ? names[i] : undefined;
    return {
      choiceId: cell.cellId,
      text: cell.text,
      ...(name !== undefined ? { name } : {}),
      ...(name !== cell.text ? { mark: cell.text } : {}),
      side: sideOf(2 * i, count, direction),
      bandIndex: cell.bandIndex,
    };
  });
  const bands: ScaleSliderBand[] = reading.bands.map((band) => ({
    label: band.label,
    start: band.start,
    span: band.span,
    side: sideOf(2 * band.start + band.span - 1, count, direction),
  }));

  return {
    ok: true,
    model: {
      tileKind,
      ticks,
      bands,
      offScale,
      showsSelectionLabel: bands.length > 0,
      bandsCoverAllTicks: coversAllTicks(bands, count),
    },
  };
}

/** 글자로만 두는 구간 이름 하나의 자리 — 눈금 열 `start` 부터 `span` 칸, 그 안에서 붙는 쪽 */
export interface ScaleSliderBandTextPlacement {
  /** 이름이 쓰는 첫 눈금 열(0부터) */
  start: number;
  /** 이름이 쓰는 눈금 열 수 */
  span: number;
  align: 'start' | 'center' | 'end';
}

/**
 * 구간이 눈금 전부를 덮지 않는 척도에서 **구간 이름을 글자로만 둘 때의 자리**(구간 순서 그대로).
 *
 * - 첫 눈금에서 시작하는 구간은 왼쪽, 끝 눈금에서 끝나는 구간은 오른쪽, 그 밖은 구간 가운데에 붙는다.
 * - 이름은 제 구간 옆의 빈 눈금까지 자리를 쓴다(한 칸에는 이름이 들어가지 않는다). 이웃 구간과의 빈 자리는
 *   반씩 나누고(홀수면 가운데 한 칸은 비운다), 이웃이 없는 쪽은 척도 끝까지 쓴다.
 * - 가운데 구간은 양옆으로 같은 만큼만 넓힌다 — 한쪽만 넓히면 이름이 제 구간의 가운데에서 벗어난다.
 */
export function resolveScaleSliderBandTextLayout(
  bands: readonly ScaleSliderBand[],
  tickCount: number,
): ScaleSliderBandTextPlacement[] {
  return bands.map((band, i) => {
    const end = band.start + band.span;
    const prev = bands[i - 1];
    const next = bands[i + 1];
    const leftRoom = prev ? Math.floor((band.start - (prev.start + prev.span)) / 2) : band.start;
    const rightRoom = next ? Math.floor((next.start - end) / 2) : tickCount - end;
    if (band.start === 0) return { start: 0, span: end + rightRoom, align: 'start' as const };
    if (end === tickCount) {
      return { start: band.start - leftRoom, span: band.span + leftRoom, align: 'end' as const };
    }
    const room = Math.min(leftRoom, rightRoom);
    return { start: band.start - room, span: band.span + 2 * room, align: 'center' as const };
  });
}
