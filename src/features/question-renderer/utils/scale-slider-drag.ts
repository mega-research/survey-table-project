/**
 * 척도 슬라이더의 **끌기 계산** — 포인터 자리에서 눈금을, 움직인 거리에서 누르기/끌기를 정한다
 * (CONTEXT.md 「척도 슬라이더」). 컴포넌트는 이 함수들을 부르기만 한다.
 *
 * ── 배선과 규칙 ──
 * - **순수 함수다.** DOM 을 읽지 않는다 — 트랙의 왼쪽 자리와 폭은 부르는 쪽이 재서 넘긴다
 *   (`getBoundingClientRect`). jsdom 은 배치를 계산하지 않으므로 컴포넌트 테스트는 그 값을 직접 준다.
 * - **트랙은 눈금 수만큼 같은 폭의 칸으로 나뉘고 눈금은 칸마다 한가운데에 선다.** 타일 줄이 같은 열 틀을
 *   써서 눈금이 타일 한 장의 가운데 아래에 온다. 그래서 「가장 가까운 눈금」은 포인터가 든 칸의 눈금이다.
 * - 두 눈금 사이 정확히 한가운데(칸 경계)는 **오른쪽 눈금**이다. 트랙 밖은 양끝 눈금으로 붙는다.
 * - 눈금 사이 값은 없다 — 결과는 언제나 눈금 자리(0부터)다.
 * - **누를 수 없는 눈금은 건너뛴다**(`isTickEnabled`). 포인터가 든 칸의 눈금을 누를 수 없으면 양쪽의 누를 수
 *   있는 눈금 가운데 포인터에서 가까운 쪽이고, 똑같이 멀면 오른쪽이다. 끄는 손잡이가 서는 자리와 놓는 자리에
 *   쓴다 — 누르기(끌지 않은 손짓)는 누른 칸의 눈금만 보므로 컴포넌트가 이 인자 없이 부른다.
 * - 누르기/끌기는 **가로로 움직인 거리**만 본다. 세로 이동은 브라우저가 넘기기로 가져가고
 *   (`touch-action: pan-y`) 그때는 `pointercancel` 이 온다.
 * - **한 번 끌기가 되면 그 손짓은 끝까지 끌기다.** 이 함수는 두 자리만 보므로 누른 자리로 되돌아오면
 *   다시 누르기라고 답한다 — 끌기가 된 사실은 컴포넌트가 붙잡아 둔다(되돌아와 놓았을 때 답이 풀리지 않게).
 */

/** 이만큼(px) 움직이면 끌기다 — 그 미만은 누르기 */
export const SCALE_SLIDER_DRAG_THRESHOLD_PX = 4;

export interface ResolveNearestScaleSliderTickInput {
  /** 포인터의 가로 자리(`clientX`) */
  x: number;
  /** 트랙의 왼쪽 끝 자리 — x 와 같은 좌표계 */
  trackLeft: number;
  /** 트랙 폭(px) */
  trackWidth: number;
  /** 눈금 수 */
  tickCount: number;
  /**
   * 누를 수 있는 눈금인가 — 주면 누를 수 없는 눈금을 건너뛰고 포인터에서 가장 가까운 누를 수 있는 눈금을
   * 돌려준다(끄는 손잡이가 비활성 눈금에 서지 않게). 안 주면 모든 눈금이 누를 수 있는 것이다.
   */
  isTickEnabled?: ((index: number) => boolean) | undefined;
}

/**
 * 포인터 자리에서 가장 가까운 눈금의 자리(0부터). 트랙 폭이나 눈금 수를 알 수 없으면(배치 전·폭 0)
 * null — 그 포인터는 눈금을 고르지 않는다(첫 눈금으로 떨어뜨리면 누르지 않은 답이 찍힌다).
 * `isTickEnabled` 를 줬는데 누를 수 있는 눈금이 하나도 없을 때도 null 이다.
 */
export function resolveNearestScaleSliderTick(
  input: ResolveNearestScaleSliderTickInput,
): number | null {
  const { x, trackLeft, trackWidth, tickCount, isTickEnabled } = input;
  if (!Number.isFinite(trackWidth) || trackWidth <= 0) return null;
  if (!Number.isInteger(tickCount) || tickCount < 1) return null;
  if (!Number.isFinite(x) || !Number.isFinite(trackLeft)) return null;
  const under = Math.min(
    Math.max(Math.floor(((x - trackLeft) * tickCount) / trackWidth), 0),
    tickCount - 1,
  );
  if (!isTickEnabled || isTickEnabled(under)) return under;

  // 포인터가 든 칸의 눈금을 누를 수 없다 — 양쪽으로 가장 가까운 누를 수 있는 눈금을 찾아 포인터에서 가까운
  // 쪽을 고른다. 똑같이 멀면 칸 경계와 같이 오른쪽이다.
  let left = under - 1;
  while (left >= 0 && !isTickEnabled(left)) left -= 1;
  let right = under + 1;
  while (right < tickCount && !isTickEnabled(right)) right += 1;
  if (left < 0) return right < tickCount ? right : null;
  if (right >= tickCount) return left;
  const centerOf = (index: number) => trackLeft + ((index + 0.5) * trackWidth) / tickCount;
  return x - centerOf(left) < centerOf(right) - x ? left : right;
}

export type ScaleSliderGesture = 'press' | 'drag';

export interface ClassifyScaleSliderGestureInput {
  /** 누른 자리 */
  startX: number;
  /** 지금 자리 */
  currentX: number;
  /** 끌기 문턱(px) — 기본 `SCALE_SLIDER_DRAG_THRESHOLD_PX` */
  thresholdPx?: number;
}

/** 누른 자리에서 가로로 문턱 이상 움직였으면 끌기, 아니면 누르기 */
export function classifyScaleSliderGesture(
  input: ClassifyScaleSliderGestureInput,
): ScaleSliderGesture {
  const threshold = input.thresholdPx ?? SCALE_SLIDER_DRAG_THRESHOLD_PX;
  return Math.abs(input.currentX - input.startX) >= threshold ? 'drag' : 'press';
}
