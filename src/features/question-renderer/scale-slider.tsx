'use client';

import { Check } from 'lucide-react';
import React, { useRef, useState } from 'react';

import {
  useAnswerQuotes,
  useContactAttrs,
} from '@/features/question-renderer/contact-attrs-context';
import {
  type ScaleSliderBand,
  type ScaleSliderModel,
  type ScaleSliderSide,
  type ScaleSliderTick,
  resolveScaleSliderBandTextLayout,
} from '@/features/question-renderer/utils/scale-slider';
import {
  classifyScaleSliderGesture,
  resolveNearestScaleSliderTick,
} from '@/features/question-renderer/utils/scale-slider-drag';
import { substituteTokens } from '@/lib/survey/substitute-tokens';
import { cn } from '@/lib/utils';

/**
 * 척도 슬라이더 — 척도 한 줄을 타일 줄과 그 아래 트랙으로 그린다(CONTEXT.md 「척도 슬라이더」).
 *
 * ── 배선과 규칙 ──
 * - **그리기만 한다.** 그릴지·무엇을 쓸지는 투영(utils/scale-slider)이 끝냈고, 고른 것과 토글 콜백은 호출부가
 *   넘긴다(척도 막대 컴포넌트와 같은 계약). 스토어를 모른다 — 표 문항 · 보기 소스 표 · 보통 라디오 문항이
 *   각자의 기존 선택 쓰기를 `onToggleChoice` 에 잇는다. 고르기와 「고른 것을 다시 누르면 풀기」는 그 토글의
 *   규칙이라, 여기서는 누른 것의 id 를 넘기기만 한다. 응답 모양·저장·검증은 달라질 수 없다.
 * - **눈금과 척도 밖 체크는 native radio 묶음 하나다**(같은 `name`). 낭독기는 라디오 묶음으로 읽고, 문항을
 *   감싼 `fieldset disabled` 가 그대로 먹는다. 눈금의 라디오는 보이지 않게 제 눈금 자리에 겹쳐 둔다
 *   (낭독기의 손가락 탐색이 자리로 찾는다) — 포인터는 받지 않고 트랙이 받는다.
 * - **포인터**(트랙): 누르면 그 자리의 눈금이 미리보기가 된다. 가로로 문턱 넘게 움직이면 끌기이고, 한 번
 *   끌기가 된 손짓은 끝까지 끌기다. 손을 떼면 —
 *   - 누르기였으면 누른 눈금으로 토글을 한 번 부른다(고른 눈금이면 호스트의 토글이 답을 푼다).
 *   - 끌기였고 놓은 눈금이 고른 눈금과 다르면 토글을 한 번, 같으면 부르지 않는다(풀리지 않는다).
 *   - 취소(`pointercancel`)·포인터 붙잡기를 잃으면 미리보기를 버린다.
 *   **끄는 동안에는 콜백을 부르지 않는다.** 미리보기는 이 컴포넌트 안의 상태뿐이라, 스친 눈금 때문에 뒤
 *   문항의 표시 조건이 돌거나 숨은 답이 지워지지 않는다. 전역 리스너를 달지 않으므로(포인터 붙잡기) 화면에서
 *   사라지면 손짓도 함께 끝난다.
 * - 트랙은 세로 이동을 브라우저에 맡긴다(`touch-action: pan-y`) — 화면을 넘기다 스친 손짓은 취소로 온다.
 * - **자리**: 트랙은 눈금 수만큼 같은 폭의 칸으로 나뉘고 눈금은 칸마다 한가운데에 선다(끌기 계산의 전제).
 *   타일 줄 · 구간 이름 · 눈금 글자가 같은 열 틀을 쓰고 열 사이 틈을 두지 않아(틈은 타일의 바깥 여백이다)
 *   눈금이 타일 가운데 바로 아래에 온다.
 * - **색**: 채움 · 손잡이 · 고른 값 표시 · 고른 점 타일은 고른(또는 미리보기) 눈금의 쪽을 따른다. 구간 타일은
 *   언제나 제 구간의 쪽 색이고 손잡이가 들어오면 짙어진다 — 짝수 눈금 척도의 가운데 구간은 중립색 타일이고
 *   그 안의 눈금은 붉은색·푸른색이다. 색 계열은 척도 막대와 같다(붉은색 · 회색 · 푸른색). 채움은 방향과
 *   무관하게 손잡이에서 오른쪽 끝까지다.
 * - **타일**: 점 타일은 그 눈금 라디오의 라벨이라 누르면 토글이 불린다. 구간 타일은 버튼이 아니다(동그라미가
 *   없다). 구간이 눈금을 다 덮지 못하면 타일 상자 없이 이름을 글자로만 둔다.
 * - 고정 문구가 없다. 모든 글자는 모델(보기 칸 글자·헤더·보기 라벨)에서 오고 명단 토큰·인용만 여기서 푼다.
 * - `invalid`(필수 강조) · `disabledChoiceIds`(비활성) · `narrow`(좁은 화면)와 키보드 이동은 계약만 선언돼
 *   있다 — 호스트가 먼저 배선할 수 있게 받기만 하고, 동작은 아직 없다.
 */

export interface ScaleSliderProps {
  questionId: string;
  /**
   * 문항 안에서 슬라이더를 가르는 id — 보기 묶음 id, 묶음 없는 행은 행 배치 투영의 묶음 키, 보통 라디오
   * 문항은 문항 id. 입력 name 과 테스트 id 에 쓴다.
   */
  sliderId: string;
  /** 투영이 돌려준 슬라이더 모델 */
  model: ScaleSliderModel;
  /** 머리 줄에 보이는 제목 — 고른 값 표시와 나란히 둔다. 비면 `ariaLabel` 이 묶음 이름이다 */
  label: string;
  /** 제목을 보이지 않는 자리(행 제목이 위에 따로 있는 행 단위 배치)의 낭독용 이름 — 묶음 이름·행 제목 */
  ariaLabel?: string | undefined;
  /** 고른 것의 id — 눈금이든 척도 밖 보기든. 없으면 답하기 전이다 */
  selectedChoiceId: string | undefined;
  /**
   * 눈금·점 타일·척도 밖 체크를 눌렀을 때(끌기는 손을 뗄 때 한 번). 고르기와 다시 누르면 풀기는 호출부
   * 문항의 선택 쓰기 규칙이다.
   */
  onToggleChoice: (choiceId: string) => void;
  /** 미충족 필수 — 트랙과 머리 줄을 강조하고 묶음을 오류 상태로 */
  invalid?: boolean | undefined;
  /** 누를 수 없는 것의 id — 누르기·끌기 착지·화살표에서 건너뛴다 */
  disabledChoiceIds?: ReadonlySet<string> | undefined;
  /** 좁은 화면(기존 모바일 판정) — 번호 타일과 이름 목록, 척도 밖 체크를 트랙 아래 줄로 */
  narrow?: boolean | undefined;
  /** 같은 문항이 여러 번 그려지는 자리에서 입력 id 가 겹치지 않게 */
  inputIdScope?: string | undefined;
}

/** 타일·손잡이의 상태 — 고르지 않음 / 끄는 중 손잡이가 지나는 자리 / 고름 */
type ShownState = 'idle' | 'preview' | 'selected';

interface SideStyle {
  /** 채움 — 답이 정해진 뒤 */
  fill: string;
  /** 채움 — 끄는 중(흐리게) */
  fillPreview: string;
  /** 손잡이 테두리 */
  thumb: string;
  /** 끄는 중 손잡이 둘레의 테 */
  thumbHalo: string;
  /** 타일 — 상태별 바탕·테두리·글자 */
  tile: Readonly<Record<ShownState, string>>;
  /** 점 타일의 동그라미 — 상태별 */
  dot: Readonly<Record<ShownState, string>>;
  /** 고른 값 표시 */
  pill: string;
  /** 강조 글자(고른 눈금 글자 · 글자로만 두는 구간 이름) */
  text: string;
}

/** 쪽 색 — 척도 막대와 같은 계열(붉은색 · 회색 · 푸른색) */
const SIDE_STYLE: Readonly<Record<ScaleSliderSide, SideStyle>> = {
  negative: {
    fill: 'bg-red-600',
    fillPreview: 'bg-red-300',
    thumb: 'border-red-600',
    thumbHalo: 'ring-red-200',
    tile: {
      idle: 'border-red-100 bg-red-50 text-gray-900',
      preview: 'border-red-200 bg-red-100 text-gray-900',
      selected: 'border-red-600 bg-red-100 text-red-700 ring-1 ring-red-600 ring-inset',
    },
    dot: {
      idle: 'border-[1.5px] border-gray-400',
      preview: 'border-[1.5px] border-red-400',
      selected: 'border-[5px] border-red-600',
    },
    pill: 'bg-red-50 text-red-700',
    text: 'text-red-700',
  },
  neutral: {
    fill: 'bg-gray-500',
    fillPreview: 'bg-gray-300',
    thumb: 'border-gray-500',
    thumbHalo: 'ring-gray-200',
    tile: {
      idle: 'border-gray-200 bg-gray-50 text-gray-900',
      preview: 'border-gray-300 bg-gray-100 text-gray-900',
      selected: 'border-gray-600 bg-gray-100 text-gray-900 ring-1 ring-gray-600 ring-inset',
    },
    dot: {
      idle: 'border-[1.5px] border-gray-400',
      preview: 'border-[1.5px] border-gray-500',
      selected: 'border-[5px] border-gray-600',
    },
    pill: 'bg-gray-100 text-gray-800',
    text: 'text-gray-900',
  },
  positive: {
    fill: 'bg-blue-600',
    fillPreview: 'bg-blue-300',
    thumb: 'border-blue-600',
    thumbHalo: 'ring-blue-200',
    tile: {
      idle: 'border-blue-100 bg-blue-50 text-gray-900',
      preview: 'border-blue-200 bg-blue-100 text-gray-900',
      selected: 'border-blue-600 bg-blue-100 text-blue-700 ring-1 ring-blue-600 ring-inset',
    },
    dot: {
      idle: 'border-[1.5px] border-gray-400',
      preview: 'border-[1.5px] border-blue-400',
      selected: 'border-[5px] border-blue-600',
    },
    pill: 'bg-blue-50 text-blue-700',
    text: 'text-blue-700',
  },
};

const BAND_TEXT_ALIGN_CLASS = {
  start: 'text-left',
  center: 'text-center',
  end: 'text-right',
} as const;

/** 눈금 n(0부터)의 가로 자리 — 같은 폭 칸의 한가운데 */
function tickCenter(index: number, count: number): string {
  return `${((index + 0.5) / count) * 100}%`;
}

/** 진행 중인 손짓 — 화면에 그리는 값이 아니라 손을 뗄 때의 판정 재료라 ref 에 둔다 */
interface SliderGesture {
  pointerId: number;
  startX: number;
  /** 누르기면 누른 눈금, 끌기가 되면 손잡이가 선 눈금 */
  index: number;
  /** 한 번 끌기가 되면 끝까지 끌기다 — 누른 자리로 되돌아와 놓아도 누르기가 아니다 */
  dragging: boolean;
}

export const ScaleSlider = React.memo(function ScaleSlider({
  questionId,
  sliderId,
  model,
  label,
  ariaLabel,
  selectedChoiceId,
  onToggleChoice,
  inputIdScope,
}: ScaleSliderProps) {
  const attrs = useContactAttrs();
  const quotes = useAnswerQuotes();
  const text = (raw: string) => substituteTokens(raw, attrs, quotes);

  const { ticks, bands, offScale } = model;
  const count = ticks.length;
  const gestureRef = useRef<SliderGesture | null>(null);
  // 누르는·끄는 동안 손잡이가 선 눈금 — 손을 떼거나 취소되면 버린다. 답은 호스트의 것 하나뿐이다
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);

  const selectedIndex = ticks.findIndex((tick) => tick.choiceId === selectedChoiceId);
  const previewing = previewIndex !== null;
  const shownIndex = previewIndex ?? (selectedIndex >= 0 ? selectedIndex : null);
  const shownTick = shownIndex === null ? undefined : ticks[shownIndex];
  const shownState: ShownState = previewing ? 'preview' : 'selected';
  const stateOf = (active: boolean): ShownState => (active ? shownState : 'idle');

  const idPrefix = inputIdScope ? `${inputIdScope}-` : '';
  const inputName = `${idPrefix}${questionId}-${sliderId}-slider`;
  const inputIdOf = (choiceId: string) => `${idPrefix}${questionId}-${choiceId}-slider`;

  const bandLabelOf = (tick: ScaleSliderTick) =>
    tick.bandIndex === null ? '' : text(bands[tick.bandIndex]!.label);
  // 같은 글자가 칸 글자·타일 이름·구간 이름에서 겹쳐 오면 한 번만 읽는다
  const tickNameOf = (tick: ScaleSliderTick) =>
    [...new Set([text(tick.text), tick.name ? text(tick.name) : '', bandLabelOf(tick)])]
      .filter(Boolean)
      .join(' ');

  const columnsStyle = { gridTemplateColumns: `repeat(${count}, minmax(0, 1fr))` };
  const hasMarks = ticks.some((tick) => tick.mark !== undefined);
  const hasBandTiles = model.tileKind === 'band' && model.bandsCoverAllTicks;
  const hasBandNames = model.tileKind === 'band' && !model.bandsCoverAllTicks;
  const hasHeader = label !== '' || model.showsSelectionLabel;

  const tickAt = (track: HTMLElement, clientX: number) => {
    const rect = track.getBoundingClientRect();
    return resolveNearestScaleSliderTick({
      x: clientX,
      trackLeft: rect.left,
      trackWidth: rect.width,
      tickCount: count,
    });
  };

  const endGesture = (track: HTMLElement, pointerId: number) => {
    gestureRef.current = null;
    setPreviewIndex(null);
    releasePointer(track, pointerId);
  };

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (gestureRef.current !== null || event.button !== 0) return;
    const index = tickAt(event.currentTarget, event.clientX);
    // 트랙 폭을 알 수 없으면 눈금을 고르지 않는다 — 첫 눈금으로 떨어뜨리면 누르지 않은 답이 찍힌다
    if (index === null) return;
    gestureRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      index,
      dragging: false,
    };
    capturePointer(event.currentTarget, event.pointerId);
    setPreviewIndex(index);
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const gesture = gestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    if (!gesture.dragging) {
      const kind = classifyScaleSliderGesture({ startX: gesture.startX, currentX: event.clientX });
      if (kind === 'press') return;
      gesture.dragging = true;
    }
    const index = tickAt(event.currentTarget, event.clientX);
    if (index === null) return;
    gesture.index = index;
    setPreviewIndex(index);
  };

  const handlePointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    const gesture = gestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    const index = gesture.dragging
      ? (tickAt(event.currentTarget, event.clientX) ?? gesture.index)
      : gesture.index;
    endGesture(event.currentTarget, event.pointerId);
    const choiceId = ticks[index]?.choiceId;
    if (choiceId === undefined) return;
    // 끌다가 고른 눈금에 다시 놓은 것은 「그대로」다 — 토글을 부르면 답이 풀린다
    if (gesture.dragging && choiceId === selectedChoiceId) return;
    onToggleChoice(choiceId);
  };

  const handlePointerAbort = (event: React.PointerEvent<HTMLDivElement>) => {
    const gesture = gestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    endGesture(event.currentTarget, event.pointerId);
  };

  const selectionLabel =
    model.showsSelectionLabel && shownTick
      ? [text(shownTick.text), bandLabelOf(shownTick)].filter(Boolean).join(' · ')
      : '';

  return (
    <div data-testid={`scale-slider-${sliderId}`}>
      <div
        role="radiogroup"
        aria-label={label || text(ariaLabel ?? '')}
        // 척도 밖 체크는 트랙과 같은 줄의 오른쪽에 선다 — 타일 줄과 트랙은 첫 열의 폭을 함께 쓴다
        className="grid items-center gap-x-5 gap-y-1.5"
        style={{
          gridTemplateColumns:
            offScale.length > 0 ? 'minmax(0, 860px) auto' : 'minmax(0, 860px)',
        }}
      >
        {hasHeader && (
          <div
            className={cn(
              'col-start-1 flex items-start justify-between gap-2',
              // 고른 값 표시가 나타나고 사라져도 아래 줄이 밀리지 않게 자리를 잡아 둔다
              model.showsSelectionLabel && 'min-h-6',
            )}
          >
            {label && <p className="min-w-0 text-[13px] font-semibold text-gray-600">{label}</p>}
            {selectionLabel && shownTick && (
              <span
                data-testid="scale-slider-selection"
                data-side={shownTick.side}
                className={cn(
                  'ml-auto shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold',
                  SIDE_STYLE[shownTick.side].pill,
                )}
              >
                {selectionLabel}
              </span>
            )}
          </div>
        )}

        {model.tileKind === 'point' && (
          <div data-testid="scale-slider-tiles" className="col-start-1 grid" style={columnsStyle}>
            {ticks.map((tick, index) => {
              const state = stateOf(index === shownIndex);
              const style = SIDE_STYLE[tick.side];
              return (
                <label
                  key={tick.choiceId}
                  htmlFor={inputIdOf(tick.choiceId)}
                  data-tile="point"
                  data-side={tick.side}
                  data-state={state}
                  className={cn(
                    // 격자 칸은 한 줄에서 가장 높은 타일에 맞춰 늘어나므로 이름이 두 줄로 접혀도 높이가 같다
                    'mx-[3px] flex min-h-16 min-w-0 cursor-pointer flex-col items-center justify-center gap-1.5 rounded-lg border px-1 py-2.5 text-center text-sm leading-snug transition-colors select-none motion-reduce:transition-none',
                    style.tile[state],
                    state === 'selected' && 'font-semibold',
                  )}
                >
                  <span
                    aria-hidden
                    className={cn(
                      'size-4 shrink-0 rounded-full bg-white transition-[border-color,border-width] motion-reduce:transition-none',
                      style.dot[state],
                    )}
                  />
                  <span aria-hidden className="max-w-full">
                    {text(tick.name ?? tick.text)}
                  </span>
                </label>
              );
            })}
          </div>
        )}

        {hasBandTiles && (
          <div
            aria-hidden
            data-testid="scale-slider-tiles"
            className="col-start-1 grid"
            style={columnsStyle}
          >
            {bands.map((band, bandIndex) => (
              <BandTile
                key={`${band.start}-${band.label}`}
                band={band}
                label={text(band.label)}
                state={stateOf(shownTick?.bandIndex === bandIndex)}
              />
            ))}
          </div>
        )}

        {hasBandNames && (
          <div
            aria-hidden
            data-testid="scale-slider-band-names"
            className="col-start-1 grid items-end"
            style={columnsStyle}
          >
            {resolveScaleSliderBandTextLayout(bands, count).map((place, bandIndex) => {
              const band = bands[bandIndex]!;
              const active = shownTick?.bandIndex === bandIndex;
              return (
                <span
                  key={`${band.start}-${band.label}`}
                  data-align={place.align}
                  className={cn(
                    'row-start-1 min-w-0 px-[3px] text-[13px] leading-snug',
                    BAND_TEXT_ALIGN_CLASS[place.align],
                    active ? cn('font-semibold', SIDE_STYLE[band.side].text) : 'text-gray-700',
                  )}
                  style={{ gridColumn: `${place.start + 1} / span ${place.span}` }}
                >
                  {text(band.label)}
                </span>
              );
            })}
          </div>
        )}

        <div
          data-testid="scale-slider-track"
          className="col-start-1 cursor-pointer touch-pan-y select-none"
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerAbort}
          onLostPointerCapture={handlePointerAbort}
        >
          <div className="relative h-8 rounded-full has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-blue-500 has-[:focus-visible]:ring-offset-2">
            <div
              aria-hidden
              className="absolute inset-x-[3px] top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-gray-200"
            />
            {shownTick && shownIndex !== null && (
              <div
                aria-hidden
                data-testid="scale-slider-fill"
                data-side={shownTick.side}
                className={cn(
                  'absolute right-[3px] top-1/2 h-1.5 -translate-y-1/2 rounded-r-full transition-[left,background-color] duration-150 ease-out motion-reduce:transition-none',
                  previewing
                    ? SIDE_STYLE[shownTick.side].fillPreview
                    : SIDE_STYLE[shownTick.side].fill,
                )}
                style={{ left: tickCenter(shownIndex, count) }}
              />
            )}
            {ticks.map((tick, index) => (
              <span
                key={tick.choiceId}
                aria-hidden
                className={cn(
                  'absolute top-1/2 size-1 -translate-x-1/2 -translate-y-1/2 rounded-full',
                  // 채움 위의 눈금 점은 흰색이라야 보인다
                  shownIndex !== null && index > shownIndex ? 'bg-white' : 'bg-gray-400',
                )}
                style={{ left: tickCenter(index, count) }}
              />
            ))}
            {shownTick && shownIndex !== null && (
              <div
                aria-hidden
                data-testid="scale-slider-thumb"
                data-side={shownTick.side}
                data-state={shownState}
                className={cn(
                  'absolute top-1/2 size-5 -translate-x-1/2 -translate-y-1/2 rounded-full border-[5px] bg-white transition-[left,border-color,box-shadow] duration-150 ease-out motion-reduce:transition-none',
                  SIDE_STYLE[shownTick.side].thumb,
                  previewing && cn('ring-4', SIDE_STYLE[shownTick.side].thumbHalo),
                )}
                style={{ left: tickCenter(shownIndex, count) }}
              />
            )}
            {ticks.map((tick, index) => (
              <input
                key={tick.choiceId}
                type="radio"
                id={inputIdOf(tick.choiceId)}
                name={inputName}
                aria-label={tickNameOf(tick)}
                checked={tick.choiceId === selectedChoiceId}
                onChange={() => {}}
                onClick={() => onToggleChoice(tick.choiceId)}
                // 제 눈금 칸에 겹쳐 두되 포인터는 받지 않는다 — 누르기와 끌기는 트랙이 받아 한 번만 판정한다
                className="pointer-events-none absolute inset-y-0 m-0 opacity-0"
                style={{ left: `${(index / count) * 100}%`, width: `${100 / count}%` }}
              />
            ))}
          </div>
          {hasMarks && (
            <div
              aria-hidden
              data-testid="scale-slider-marks"
              className="grid pt-0.5"
              style={columnsStyle}
            >
              {ticks.map((tick, index) => (
                <span
                  key={tick.choiceId}
                  className={cn(
                    'min-w-0 text-center text-xs leading-5 tabular-nums',
                    index === shownIndex
                      ? cn('font-semibold', SIDE_STYLE[tick.side].text)
                      : 'text-gray-500',
                  )}
                >
                  {tick.mark !== undefined ? text(tick.mark) : null}
                </span>
              ))}
            </div>
          )}
        </div>

        {offScale.length > 0 && (
          <div
            data-testid="scale-slider-off-scale"
            // 트랙의 눈금 줄(h-8)과 가운데를 맞춘다 — 눈금 글자 줄이 아래에 붙어도 체크는 트랙 옆에 선다
            className="col-start-2 flex min-h-8 items-center gap-x-4 self-start"
          >
            {offScale.map((choice) => {
              const checked = choice.choiceId === selectedChoiceId;
              return (
                <label
                  key={choice.choiceId}
                  htmlFor={inputIdOf(choice.choiceId)}
                  className={cn(
                    // relative — 숨긴 라디오가 이 라벨 안에 머물러, 포커스가 갈 때 화면이 엉뚱한 곳으로 튀지 않는다
                    'relative flex cursor-pointer items-center gap-2 rounded text-sm select-none has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-blue-500 has-[:focus-visible]:ring-offset-2',
                    checked ? 'text-gray-900' : 'text-gray-700',
                  )}
                >
                  <input
                    type="radio"
                    id={inputIdOf(choice.choiceId)}
                    name={inputName}
                    checked={checked}
                    onChange={() => {}}
                    onClick={() => onToggleChoice(choice.choiceId)}
                    className="sr-only"
                  />
                  <span
                    aria-hidden
                    className={cn(
                      'flex size-[18px] shrink-0 items-center justify-center rounded-[5px] border transition-colors motion-reduce:transition-none',
                      checked
                        ? 'border-gray-900 bg-gray-900 text-white'
                        : 'border-gray-400 bg-white',
                    )}
                  >
                    {checked && <Check className="size-3.5" strokeWidth={3} />}
                  </span>
                  <span>{text(choice.label)}</span>
                </label>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
});

interface BandTileProps {
  band: ScaleSliderBand;
  label: string;
  state: ShownState;
}

/** 구간 타일 한 장 — 덮는 눈금 수만큼 자리를 쓴다. 누를 수 없어 동그라미가 없고 라벨도 버튼도 아니다 */
function BandTile({ band, label, state }: BandTileProps) {
  return (
    <div
      data-tile="band"
      data-side={band.side}
      data-state={state}
      className={cn(
        'mx-[3px] flex min-h-10 min-w-0 items-center justify-center rounded-lg border px-1 py-2 text-center text-sm leading-snug transition-colors motion-reduce:transition-none',
        SIDE_STYLE[band.side].tile[state],
        state === 'selected' && 'font-semibold',
      )}
      style={{ gridColumn: `${band.start + 1} / span ${band.span}` }}
    >
      {label}
    </div>
  );
}

/** 포인터를 트랙에 붙잡는다 — 트랙 밖으로 나가 놓아도 놓기가 트랙에 온다. 이미 사라진 포인터면 무시한다 */
function capturePointer(element: HTMLElement, pointerId: number) {
  try {
    element.setPointerCapture(pointerId);
  } catch {
    // 붙잡지 못해도 트랙 안에서의 누르기·끌기는 그대로 동작한다
  }
}

function releasePointer(element: HTMLElement, pointerId: number) {
  try {
    if (element.hasPointerCapture(pointerId)) element.releasePointerCapture(pointerId);
  } catch {
    // 이미 풀린 포인터
  }
}
