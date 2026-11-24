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
 *   사라지면 손짓도 함께 끝난다. 놓아서 답이 된 눈금으로 포커스를 옮긴다(이어 누르는 화살표가 거기서 시작한다).
 * - 트랙은 세로 이동을 브라우저에 맡긴다(`touch-action: pan-y`) — 화면을 넘기다 스친 손짓은 취소로 온다.
 * - **키보드**(묶음): 눈금과 척도 밖 체크를 화면 순서대로 한 줄로 보고 화살표로 하나씩 옮긴다. 옮길 때마다
 *   토글을 부른다(끌기처럼 미루지 않는다 — 기존 라디오와 같다). **양끝에서 멈춘다** — 브라우저의 라디오 묶음
 *   기본 이동은 반대편으로 돌아 「매우 만족」 다음이 「매우 불만족」이 된다. 끝 눈금 다음은 척도 밖 체크다(같은
 *   라디오 묶음이라 탭이 하나에만 서므로 키보드로 체크에 닿는 길이 화살표뿐이다). Home·End 는 척도의 양끝
 *   눈금이다. Delete·Backspace 는 고른 것으로 토글을 불러 푼다. 스페이스는 브라우저가 라디오를 누르는 그대로다.
 * - **비활성**은 안쪽 native radio 의 상태가 정본이다.
 *   - `disabledChoiceIds` 의 것은 그 라디오가 `disabled` 다. 누르기는 받지 않고(옆 눈금으로 떨어뜨리지 않는다),
 *     끄는 손잡이와 화살표는 건너뛴다.
 *   - **묶음 전체**(이월 잠금 — 문항을 감싼 `fieldset disabled`)는 prop 으로 오지 않는다. 회색과 포인터 차단은
 *     CSS 가 「누를 수 있는 라디오가 하나도 없음」(`:not(:has(input:enabled))`)에서 읽는다 — 호스트가 fieldset
 *     만 바꿔도 다시 그리지 않고 따라가고, 첫 화면에 색이 깜빡이지 않는다. 트랙은 폼 컨트롤이 아니라 fieldset
 *     이 막아 주지 않으므로 누르기·끌기·키보드는 그때마다 같은 사실(`:disabled`)을 DOM 에서 다시 읽어 막는다
 *     (`:has()` 가 없는 브라우저에서도 잠긴 답은 바뀌지 않고, 회색만 빠진다).
 * - **포커스 테**는 손잡이에 선다(포커스 선 라디오가 고른 눈금일 때). 답하기 전이나 답을 푼 뒤에는 트랙
 *   전체에 선다. box-shadow 가 아니라 outline 으로 그린다 — 강제 색 모드에서 box-shadow 는 사라진다.
 * - **필수 강조**(`invalid`): 묶음이 오류 상태(`aria-invalid`)가 되고 트랙에 테두리, 머리 글자가 붉어진다.
 *   문구는 문항 단위 안내가 낸다. 답하면 호스트가 prop 을 내린다.
 * - **자리**: 트랙은 눈금 수만큼 같은 폭의 칸으로 나뉘고 눈금은 칸마다 한가운데에 선다(끌기 계산의 전제).
 *   타일 줄 · 구간 이름 · 눈금 글자가 같은 열 틀을 쓰고 열 사이 틈을 두지 않아(틈은 타일의 바깥 여백이다)
 *   눈금이 타일 가운데 바로 아래에 온다.
 * - **좁은 화면**(`narrow` — 호스트의 기존 모바일 판정):
 *   - 점 타일이 6장 이상이고 눈금마다 눈금 글자가 있으면 타일에는 눈금 글자만 두고 이름은 트랙 아래 목록
 *     (「눈금 글자 + 이름」)으로 적는다. 목록의 줄도 그 눈금 라디오의 라벨이라 누르면 골라진다. 눈금 글자가
 *     없는 척도(라디오 문항 등)는 타일을 그대로 두고 이름이 접힌다.
 *   - 척도 밖 체크는 트랙 옆이 아니라 아래 줄에 선다(트랙이 짧아지지 않는다). 고른 값 표시는 한 단계 크다.
 * - **글자 접힘**: 타일·목록·체크의 글자는 낱말 단위로 접고(`keep-all`) 한 낱말이 칸보다 길면 글자에서 끊는다
 *   (`overflow-wrap`). 물려받지 않고 여기서 직접 정한다 — 조상의 줄바꿈 설정에 기대면 미리보기 카드처럼 다른
 *   자리에서 넘친다. 중국어판(`lang=zh`)에서는 globals.css 가 `break-keep` 을 풀어 글자 단위로 접힌다. 타일은
 *   격자 칸에 맞춰 늘어나므로 이름이 여러 줄로 접혀도 한 줄의 타일 높이가 같다.
 * - **색**: 채움 · 손잡이 · 고른 값 표시 · 고른 점 타일은 고른(또는 미리보기) 눈금의 쪽을 따른다. 구간 타일은
 *   언제나 제 구간의 쪽 색이고 손잡이가 들어오면 짙어진다 — 짝수 눈금 척도의 가운데 구간은 중립색 타일이고
 *   그 안의 눈금은 붉은색·푸른색이다. 색 계열은 척도 막대와 같다(붉은색 · 회색 · 푸른색). 채움은 방향과
 *   무관하게 손잡이에서 오른쪽 끝까지다.
 * - **타일**: 점 타일은 그 눈금 라디오의 라벨이라 누르면 토글이 불린다. 구간 타일은 버튼이 아니다(동그라미가
 *   없다). 구간이 눈금을 다 덮지 못하면 타일 상자 없이 이름을 글자로만 둔다.
 * - **누르는 자리의 크기**: 손가락으로 누르는 기기(`pointer: coarse`)에서는 트랙 · 번호 타일 · 목록 줄 · 척도
 *   밖 체크가 44px 까지 넓어진다. 13눈금의 가로 간격(390px 화면에서 26px 남짓)은 넓힐 수 없다.
 * - 고정 문구가 없다. 모든 글자는 모델(보기 칸 글자·헤더·보기 라벨)에서 오고 명단 토큰·인용만 여기서 푼다.
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
   * 눈금·점 타일·척도 밖 체크를 눌렀을 때(끌기는 손을 뗄 때 한 번, 화살표는 옮길 때마다). 고르기와 다시
   * 누르면 풀기는 호출부 문항의 선택 쓰기 규칙이다.
   */
  onToggleChoice: (choiceId: string) => void;
  /** 미충족 필수 — 트랙과 머리 줄을 강조하고 묶음을 오류 상태로 */
  invalid?: boolean | undefined;
  /**
   * 누를 수 없는 것의 id — 누르기·끌기 착지·화살표에서 건너뛴다. 묶음 전체의 잠금(이월 잠금)은 여기로 넘기지
   * 않는다 — 문항을 감싼 `fieldset disabled` 를 안쪽 라디오에서 읽는다.
   */
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
  /** 고른 값 표시 · 이름 목록의 고른 줄 */
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
      idle: 'border-[1.5px] border-gray-500',
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
      idle: 'border-[1.5px] border-gray-500',
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
      idle: 'border-[1.5px] border-gray-500',
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

/**
 * 글자 접힘 — 낱말 단위로 접고(한국어 어절 보존), 한 낱말이 칸보다 길면 글자에서 끊는다. 조상의 설정을 물려받지
 * 않게 줄바꿈 허용까지 직접 적는다. 중국어판에서는 globals.css 가 `break-keep` 을 풀어 글자 단위가 된다.
 * 영어·베트남어의 긴 낱말은 `lang` 이 달린 자리에서 붙임표로 끊긴다.
 *
 * `overflow-wrap` 은 `wrap-break-word` 로 적는다 — 같은 뜻의 `break-words` 는 클래스 병합(tailwind-merge)이
 * `break-keep` 과 같은 묶음으로 보고 한쪽을 지운다(어절 보존이 조용히 빠진다).
 */
const WRAP_CLASS = 'whitespace-normal break-keep wrap-break-word hyphens-auto';

/**
 * 고른 것의 강제 색 모드 표시 — 바탕색과 box-shadow 가 사라지는 모드에서 고른 타일·줄이 굵은 글자만으로
 * 남지 않게 테두리를 그린다.
 */
const FORCED_COLORS_SELECTED_CLASS =
  'forced-colors:outline-2 forced-colors:-outline-offset-2 forced-colors:outline-[Highlight]';

/** 키보드 이동 — 라디오 묶음의 관례대로 오른쪽·아래가 다음, 왼쪽·위가 이전이다 */
const SCALE_SLIDER_KEY_MOVES: Readonly<Record<string, 1 | -1 | 'first' | 'last'>> = {
  ArrowRight: 1,
  ArrowDown: 1,
  ArrowLeft: -1,
  ArrowUp: -1,
  Home: 'first',
  End: 'last',
};

/** 이름을 아래 목록으로 내리는 점 타일 수 — 좁은 화면에서 이만큼부터 타일에 이름이 들어가지 않는다 */
const NAME_LIST_MIN_TILES = 6;

/** 눈금 n(0부터)의 가로 자리 — 같은 폭 칸의 한가운데 */
function tickCenter(index: number, count: number): string {
  return `${((index + 0.5) / count) * 100}%`;
}

/** 진행 중인 손짓 — 화면에 그리는 값이 아니라 손을 뗄 때의 판정 재료라 ref 에 둔다 */
interface SliderGesture {
  pointerId: number;
  startX: number;
  /** 누르기면 누른 눈금, 끌기가 되면 손잡이가 선 눈금. 비활성 눈금을 눌렀으면 아직 없다 */
  index: number | null;
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
  invalid,
  disabledChoiceIds,
  narrow,
  inputIdScope,
}: ScaleSliderProps) {
  const attrs = useContactAttrs();
  const quotes = useAnswerQuotes();
  const text = (raw: string) => substituteTokens(raw, attrs, quotes);

  const { ticks, bands, offScale } = model;
  const count = ticks.length;
  const groupRef = useRef<HTMLDivElement>(null);
  const gestureRef = useRef<SliderGesture | null>(null);
  // 누르는·끄는 동안 손잡이가 선 눈금 — 손을 떼거나 취소되면 버린다. 답은 호스트의 것 하나뿐이다
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);
  // 손짓이 끌기가 됐는가 — 커서(쥐는 손)만 정한다. 판정은 gestureRef 가 한다
  const [dragging, setDragging] = useState(false);

  const isEnabled = (choiceId: string) => !disabledChoiceIds?.has(choiceId);
  const isTickEnabled = (index: number) => isEnabled(ticks[index]!.choiceId);
  // 하나씩 흐리게 두는 것은 일부만 비활성일 때다. 전부 비활성이면(보통 라디오 문항의 프리필 잠금이 이 길로
  // 온다) 묶음의 회색 하나로 말한다 — 흐림이 겹치면 고른 답까지 반쯤 지워져 보이고, fieldset 잠금과 모양이 갈린다
  const dimsDisabled =
    ticks.some((tick) => isEnabled(tick.choiceId)) ||
    offScale.some((choice) => isEnabled(choice.choiceId));
  const dimClass = (enabled: boolean) => (!enabled && dimsDisabled ? 'opacity-50' : '');
  /** 누르는 라벨(점 타일 · 이름 목록 줄 · 척도 밖 체크)의 커서와 흐림 */
  const pressableClass = (choiceId: string) =>
    cn(isEnabled(choiceId) ? 'cursor-pointer' : 'cursor-default', dimClass(isEnabled(choiceId)));
  // 라디오를 직접 누른 것(낭독기 · 라벨 · 스페이스) — 비활성 라디오는 브라우저가 누르기를 보내지 않지만, 와도
  // 받지 않는다(fieldset 잠금은 prop 으로 오지 않아 React 가 걸러 주지 않는다)
  const toggleFromRadio = (event: React.MouseEvent<HTMLInputElement>, choiceId: string) => {
    if (event.currentTarget.matches(':disabled')) return;
    onToggleChoice(choiceId);
  };

  const selectedIndex = ticks.findIndex((tick) => tick.choiceId === selectedChoiceId);
  const previewing = previewIndex !== null;
  const shownIndex = previewIndex ?? (selectedIndex >= 0 ? selectedIndex : null);
  const shownTick = shownIndex === null ? undefined : ticks[shownIndex];
  const shownState: ShownState = previewing ? 'preview' : 'selected';
  const stateOf = (active: boolean): ShownState => (active ? shownState : 'idle');

  const idPrefix = inputIdScope ? `${inputIdScope}-` : '';
  const inputName = `${idPrefix}${questionId}-${sliderId}-slider`;
  const inputIdOf = (choiceId: string) => `${idPrefix}${questionId}-${choiceId}-slider`;
  // 묶음 안 라디오의 순서 — 눈금 다음에 척도 밖 체크(화면 순서이자 DOM 순서다)
  const choiceOrder = [
    ...ticks.map((tick) => tick.choiceId),
    ...offScale.map((choice) => choice.choiceId),
  ];
  const radioOf = (choiceId: string) => {
    const id = inputIdOf(choiceId);
    const radios = groupRef.current?.querySelectorAll<HTMLInputElement>('input[type="radio"]');
    return [...(radios ?? [])].find((input) => input.id === id);
  };

  const bandLabelOf = (tick: ScaleSliderTick) =>
    tick.bandIndex === null ? '' : text(bands[tick.bandIndex]!.label);
  // 같은 글자가 칸 글자·타일 이름·구간 이름에서 겹쳐 오면 한 번만 읽는다
  const tickNameOf = (tick: ScaleSliderTick) =>
    [...new Set([text(tick.text), tick.name ? text(tick.name) : '', bandLabelOf(tick)])]
      .filter(Boolean)
      .join(' ');

  const columnsStyle = { gridTemplateColumns: `repeat(${count}, minmax(0, 1fr))` };
  const hasBandTiles = model.tileKind === 'band' && model.bandsCoverAllTicks;
  const hasBandNames = model.tileKind === 'band' && !model.bandsCoverAllTicks;
  const hasHeader = label !== '' || model.showsSelectionLabel;
  // 좁은 화면의 번호 타일 + 이름 목록 — 타일에 이름이 들어가지 않는 만큼 많고, 타일에 대신 둘 눈금 글자가
  // 눈금마다 있을 때만이다. 눈금 글자가 없으면 타일이 비므로 이름을 그대로 둔다
  const hasNameList =
    narrow === true &&
    model.tileKind === 'point' &&
    count >= NAME_LIST_MIN_TILES &&
    ticks.every((tick) => tick.mark !== undefined);
  // 눈금 글자는 한 번만 보인다 — 번호 타일이 이미 실었으면 트랙 아래에 다시 적지 않는다
  const hasMarks = !hasNameList && ticks.some((tick) => tick.mark !== undefined);
  // 척도 밖 체크는 넓은 화면에서 트랙과 같은 줄의 오른쪽, 좁은 화면에서 아래 줄이다
  const checksBeside = offScale.length > 0 && narrow !== true;

  /** 포인터 자리의 눈금 — `skipDisabled` 면 비활성 눈금을 건너뛴 가장 가까운 눈금(끄는 손잡이가 서는 자리) */
  const tickAt = (track: HTMLElement, clientX: number, skipDisabled: boolean) => {
    const rect = track.getBoundingClientRect();
    return resolveNearestScaleSliderTick({
      x: clientX,
      trackLeft: rect.left,
      trackWidth: rect.width,
      tickCount: count,
      isTickEnabled: skipDisabled ? isTickEnabled : undefined,
    });
  };

  const endGesture = (track: HTMLElement, pointerId: number) => {
    gestureRef.current = null;
    setPreviewIndex(null);
    setDragging(false);
    releasePointer(track, pointerId);
  };

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (gestureRef.current !== null || event.button !== 0) return;
    // 잠긴 묶음은 손짓을 받지 않는다 — 트랙은 폼 컨트롤이 아니라 fieldset 이 막아 주지 않는다
    if (isRadioGroupDisabled(groupRef.current)) return;
    const under = tickAt(event.currentTarget, event.clientX, false);
    // 트랙 폭을 알 수 없으면 눈금을 고르지 않는다 — 첫 눈금으로 떨어뜨리면 누르지 않은 답이 찍힌다
    if (under === null) return;
    // 비활성 눈금을 누른 것은 아무것도 고르지 않는다(옆 눈금으로 떨어뜨리면 누르지 않은 답이 찍힌다).
    // 손짓은 받아 둔다 — 거기서 끌기 시작하면 누를 수 있는 눈금에 붙는다
    const index = isTickEnabled(under) ? under : null;
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
      setDragging(true);
    }
    const index = tickAt(event.currentTarget, event.clientX, true);
    if (index === null) return;
    gesture.index = index;
    setPreviewIndex(index);
  };

  const handlePointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    const gesture = gestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    const index = gesture.dragging
      ? (tickAt(event.currentTarget, event.clientX, true) ?? gesture.index)
      : gesture.index;
    endGesture(event.currentTarget, event.pointerId);
    // 끄는 사이에 잠겼으면 놓아도 답이 되지 않는다
    if (index === null || isRadioGroupDisabled(groupRef.current)) return;
    const choiceId = ticks[index]?.choiceId;
    if (choiceId === undefined) return;
    // 누른 눈금으로 포커스를 옮긴다 — 라벨을 누른 라디오와 같이, 이어서 누르는 화살표가 그 눈금에서 시작한다
    radioOf(choiceId)?.focus({ preventScroll: true });
    // 끌다가 고른 눈금에 다시 놓은 것은 「그대로」다 — 토글을 부르면 답이 풀린다
    if (gesture.dragging && choiceId === selectedChoiceId) return;
    onToggleChoice(choiceId);
  };

  const handlePointerAbort = (event: React.PointerEvent<HTMLDivElement>) => {
    const gesture = gestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    endGesture(event.currentTarget, event.pointerId);
  };

  // 키보드 — 눈금과 척도 밖 체크를 화면 순서대로 한 줄로 본다. 브라우저의 라디오 묶음 기본 이동은 양끝에서
  // 반대편으로 돌고 Home·End 가 없어 직접 맡는다. 순서는 DOM 이 아니라 모델에서 읽는다.
  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.altKey || event.metaKey || event.ctrlKey) return;
    const target = event.target;
    if (!(target instanceof HTMLInputElement)) return;
    const from = choiceOrder.findIndex((choiceId) => inputIdOf(choiceId) === target.id);
    // 잠긴 라디오는 포커스를 받지 못해 키가 오지 않지만, 와도 받지 않는다
    if (from < 0 || target.matches(':disabled')) return;

    if (event.key === 'Delete' || event.key === 'Backspace') {
      // 고른 것으로 토글을 불러 푼다 — 고른 것이 없으면(이 척도의 것이 아니어도) 아무 일도 없다
      if (selectedChoiceId === undefined || !choiceOrder.includes(selectedChoiceId)) return;
      if (!isEnabled(selectedChoiceId)) return;
      event.preventDefault();
      onToggleChoice(selectedChoiceId);
      return;
    }

    const move = SCALE_SLIDER_KEY_MOVES[event.key];
    if (move === undefined) return;
    // 옮길 곳이 없어도 기본 동작은 막는다 — 두면 브라우저가 반대편 끝으로 돌려 답을 바꾼다
    event.preventDefault();
    // Home·End 는 척도의 양끝 눈금이다(척도 밖 체크가 아니다). 화살표는 양끝에서 멈춘다.
    // 비활성인 것은 가던 쪽으로 건너뛴다 — 누를 수 없는 눈금에 화살표로 답이 써지면 안 된다
    const step = move === 'first' ? 1 : move === 'last' ? -1 : move;
    const end = typeof move === 'string' ? count : choiceOrder.length;
    let to = move === 'first' ? 0 : move === 'last' ? count - 1 : from + move;
    while (to >= 0 && to < end && !isEnabled(choiceOrder[to]!)) to += step;
    if (to < 0 || to >= end || to === from) return;
    const next = choiceOrder[to]!;
    radioOf(next)?.focus();
    if (next !== selectedChoiceId) onToggleChoice(next);
  };

  const selectionLabel =
    model.showsSelectionLabel && shownTick
      ? [text(shownTick.text), bandLabelOf(shownTick)].filter(Boolean).join(' · ')
      : '';

  return (
    <div
      data-testid={`scale-slider-${sliderId}`}
      // 잠긴 묶음 — 누를 수 있는 라디오가 하나도 없으면 회색으로 그리고 포인터를 받지 않는다. 조건을 CSS 가
      // 안쪽 라디오에서 읽으므로 문항을 감싼 fieldset 이 잠기면 prop 없이, 다시 그리지 않고 따라간다
      className="[&:not(:has(input:enabled))]:pointer-events-none [&:not(:has(input:enabled))]:grayscale"
    >
      <div
        ref={groupRef}
        role="radiogroup"
        aria-label={label || text(ariaLabel ?? '')}
        // 「다음」 뒤 미충족 필수 — 문구는 문항 단위 안내가 낸다
        aria-invalid={invalid || undefined}
        onKeyDown={handleKeyDown}
        // 타일 줄과 트랙은 첫 열의 폭을 함께 쓴다. 넓은 화면의 척도 밖 체크는 그 오른쪽 열이다
        className="grid items-center gap-x-5 gap-y-1.5"
        style={{
          gridTemplateColumns: checksBeside ? 'minmax(0, 860px) auto' : 'minmax(0, 860px)',
        }}
      >
        {hasHeader && (
          <div
            className={cn(
              'col-start-1 flex items-start justify-between gap-2',
              // 고른 값 표시가 나타나고 사라져도 아래 줄이 밀리지 않게 자리를 잡아 둔다
              model.showsSelectionLabel && (narrow ? 'min-h-7' : 'min-h-6'),
            )}
          >
            {label && (
              <p
                data-invalid={invalid || undefined}
                className={cn(
                  'min-w-0 text-[0.8125rem] font-semibold',
                  WRAP_CLASS,
                  invalid ? 'text-red-600' : 'text-gray-600',
                )}
              >
                {label}
              </p>
            )}
            {selectionLabel && shownTick && (
              <span
                data-testid="scale-slider-selection"
                data-side={shownTick.side}
                className={cn(
                  'ml-auto shrink-0 rounded-full font-semibold',
                  // 좁은 화면의 촘촘한 눈금에서는 이 글자가 잘못 선 눈금을 알아채는 길이라 한 단계 크다
                  narrow ? 'px-3 py-1 text-sm' : 'px-2.5 py-0.5 text-xs',
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
                    'flex min-w-0 items-center justify-center border text-center transition-colors select-none',
                    hasNameList
                      ? // 번호 타일 — 이름은 아래 목록에 있다
                        'mx-0.5 min-h-9 rounded-md text-[0.8125rem] leading-none tabular-nums pointer-coarse:min-h-11'
                      : // 격자 칸은 한 줄에서 가장 높은 타일에 맞춰 늘어나므로 이름이 여러 줄로 접혀도 높이가 같다
                        'mx-[3px] min-h-16 flex-col gap-1.5 rounded-lg px-1 py-2.5 text-sm leading-snug',
                    // 좁은 화면 — 타일 사이 틈과 안쪽 여백을 줄여 글자 자리를 번다. 타일이 많으면 글자도 한 단계 작다
                    !hasNameList && narrow && 'mx-0.5 px-0.5',
                    !hasNameList &&
                      narrow &&
                      (count >= NAME_LIST_MIN_TILES
                        ? 'text-xs leading-snug'
                        : 'text-[0.8125rem] leading-snug'),
                    style.tile[state],
                    state === 'selected' && cn('font-semibold', FORCED_COLORS_SELECTED_CLASS),
                    pressableClass(tick.choiceId),
                  )}
                >
                  {hasNameList ? (
                    <span aria-hidden>{tick.mark !== undefined ? text(tick.mark) : null}</span>
                  ) : (
                    <>
                      <span
                        aria-hidden
                        className={cn(
                          'size-4 shrink-0 rounded-full bg-white transition-[border-color,border-width] motion-reduce:transition-none',
                          style.dot[state],
                        )}
                      />
                      <span aria-hidden className={cn('max-w-full text-balance', WRAP_CLASS)}>
                        {text(tick.name ?? tick.text)}
                      </span>
                    </>
                  )}
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
                narrow={narrow === true}
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
                    'row-start-1 min-w-0 px-[3px] text-[0.8125rem] leading-snug',
                    WRAP_CLASS,
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
          data-invalid={invalid || undefined}
          data-dragging={dragging || undefined}
          className={cn(
            'col-start-1 touch-pan-y select-none',
            dragging ? 'cursor-grabbing' : 'cursor-pointer',
          )}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerAbort}
          onLostPointerCapture={handlePointerAbort}
        >
          {/* 포커스 테 — 포커스 선 라디오가 고른 눈금이면 손잡이에(아래), 아니면(답하기 전·푼 뒤) 트랙 전체에 선다 */}
          <div className="group/track relative h-8 rounded-full outline-offset-2 outline-blue-500 has-[input:focus-visible:not(:checked)]:outline-2 pointer-coarse:h-11">
            <div
              aria-hidden
              className={cn(
                'absolute inset-x-[3px] top-1/2 h-1.5 -translate-y-1/2 rounded-full forced-colors:bg-[GrayText]',
                invalid ? 'bg-red-50 outline-2 outline-red-500' : 'bg-gray-200',
              )}
            />
            {shownTick && shownIndex !== null && (
              <div
                aria-hidden
                data-testid="scale-slider-fill"
                data-side={shownTick.side}
                className={cn(
                  'absolute right-[3px] top-1/2 h-1.5 -translate-y-1/2 rounded-r-full transition-[left,background-color] duration-150 ease-out motion-reduce:transition-none forced-colors:bg-[Highlight]',
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
                  // 채움 위의 눈금 점은 흰색이라야 보인다. 누를 수 없는 눈금의 점은 흐리다
                  shownIndex !== null && index > shownIndex
                    ? 'bg-white forced-colors:bg-[HighlightText]'
                    : isTickEnabled(index)
                      ? 'bg-gray-500 forced-colors:bg-[CanvasText]'
                      : 'bg-gray-300 forced-colors:bg-[GrayText]',
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
                  'absolute top-1/2 size-5 -translate-x-1/2 -translate-y-1/2 rounded-full border-[5px] bg-white outline-offset-2 outline-blue-500 transition-[left,border-color,box-shadow] duration-150 ease-out group-has-[input:checked:focus-visible]/track:outline-2 motion-reduce:transition-none',
                  dragging ? 'cursor-grabbing' : 'cursor-grab',
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
                disabled={!isEnabled(tick.choiceId)}
                onChange={() => {}}
                onClick={(event) => toggleFromRadio(event, tick.choiceId)}
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
                    dimClass(isTickEnabled(index)),
                  )}
                >
                  {tick.mark !== undefined ? text(tick.mark) : null}
                </span>
              ))}
            </div>
          )}
        </div>

        {hasNameList && (
          // 타일에 들어가지 않는 이름 — 「눈금 글자 + 이름」을 눈금 순서대로 적는다. 줄은 그 눈금 라디오의 라벨이라
          // 눌러도 골라진다. 읽기는 라디오가 이미 하므로 목록은 낭독에서 뺀다(같은 이름을 두 번 읽지 않는다)
          <ul aria-hidden data-testid="scale-slider-names" className="col-start-1">
            {ticks.map((tick, index) => {
              const state = stateOf(index === shownIndex);
              return (
                <li key={tick.choiceId}>
                  <label
                    htmlFor={inputIdOf(tick.choiceId)}
                    data-side={tick.side}
                    data-state={state}
                    className={cn(
                      // 여러 줄로 접히는 이름에서 눈금 글자는 첫 줄에 선다
                      'flex items-start gap-2 rounded-md px-2.5 py-2 text-sm leading-snug transition-colors select-none pointer-coarse:py-3',
                      state === 'idle' ? 'text-gray-700' : SIDE_STYLE[tick.side].pill,
                      state === 'selected' && cn('font-semibold', FORCED_COLORS_SELECTED_CLASS),
                      pressableClass(tick.choiceId),
                    )}
                  >
                    <span className="shrink-0 tabular-nums">
                      {tick.mark !== undefined ? text(tick.mark) : null}
                    </span>
                    <span className={cn('min-w-0', WRAP_CLASS)}>{text(tick.name ?? tick.text)}</span>
                  </label>
                </li>
              );
            })}
          </ul>
        )}

        {offScale.length > 0 && (
          <div
            data-testid="scale-slider-off-scale"
            data-placement={checksBeside ? 'beside' : 'below'}
            className={cn(
              'flex gap-x-5',
              checksBeside
                ? // 트랙의 눈금 줄과 가운데를 맞춘다 — 눈금 글자 줄이 아래에 붙어도 체크는 트랙 옆에 선다
                  'col-start-2 min-h-8 items-center self-start pointer-coarse:min-h-11'
                : // 트랙과 같은 열의 아래 줄 — 둘 이상이면 나란히, 자리가 모자라면 다음 줄로 넘어간다
                  'col-start-1 flex-wrap gap-y-1',
            )}
          >
            {offScale.map((choice) => {
              const checked = choice.choiceId === selectedChoiceId;
              return (
                <label
                  key={choice.choiceId}
                  htmlFor={inputIdOf(choice.choiceId)}
                  className={cn(
                    // relative — 숨긴 라디오가 이 라벨 안에 머물러, 포커스가 갈 때 화면이 엉뚱한 곳으로 튀지 않는다.
                    // 여러 줄로 접히는 글자에서 체크는 첫 줄에 선다. 위아래 여백이 누르는 자리의 높이다(24px · 손가락 44px)
                    'relative flex items-start gap-2 rounded py-0.5 text-sm leading-5 outline-offset-2 outline-blue-500 select-none has-[:focus-visible]:outline-2 pointer-coarse:py-3',
                    checked ? 'text-gray-900' : 'text-gray-700',
                    pressableClass(choice.choiceId),
                  )}
                >
                  <input
                    type="radio"
                    id={inputIdOf(choice.choiceId)}
                    name={inputName}
                    checked={checked}
                    disabled={!isEnabled(choice.choiceId)}
                    onChange={() => {}}
                    onClick={(event) => toggleFromRadio(event, choice.choiceId)}
                    className="sr-only"
                  />
                  <span
                    aria-hidden
                    className={cn(
                      'mt-px flex size-[18px] shrink-0 items-center justify-center rounded-[5px] border transition-colors',
                      checked
                        ? 'border-gray-900 bg-gray-900 text-white forced-colors:bg-[Highlight] forced-colors:text-[HighlightText]'
                        : 'border-gray-500 bg-white',
                    )}
                  >
                    {checked && <Check className="size-3.5" strokeWidth={3} />}
                  </span>
                  <span className={cn('min-w-0', WRAP_CLASS)}>{text(choice.label)}</span>
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
  narrow: boolean;
}

/** 구간 타일 한 장 — 덮는 눈금 수만큼 자리를 쓴다. 누를 수 없어 동그라미가 없고 라벨도 버튼도 아니다 */
function BandTile({ band, label, state, narrow }: BandTileProps) {
  return (
    <div
      data-tile="band"
      data-side={band.side}
      data-state={state}
      className={cn(
        'flex min-h-10 min-w-0 items-center justify-center rounded-lg border px-1 py-2 text-center text-sm leading-snug transition-colors',
        narrow ? 'mx-0.5' : 'mx-[3px]',
        WRAP_CLASS,
        SIDE_STYLE[band.side].tile[state],
        state === 'selected' && cn('font-semibold', FORCED_COLORS_SELECTED_CLASS),
      )}
      style={{ gridColumn: `${band.start + 1} / span ${band.span}` }}
    >
      {label}
    </div>
  );
}

/**
 * 묶음 전체가 잠겼는가 — 안쪽 native radio 가 전부 비활성인가. `:disabled` 는 제 `disabled` 속성과 조상
 * `fieldset disabled` 를 함께 본다(이월 잠금은 문항을 감싼 fieldset 이라 prop 으로 오지 않는다). 회색을 그리는
 * CSS 조건(`:not(:has(input:enabled))`)과 같은 사실이다.
 */
function isRadioGroupDisabled(group: HTMLElement | null): boolean {
  if (!group) return false;
  const radios = group.querySelectorAll('input[type="radio"]');
  return radios.length > 0 && [...radios].every((radio) => radio.matches(':disabled'));
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
