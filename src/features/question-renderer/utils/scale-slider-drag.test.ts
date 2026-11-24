import { describe, expect, it } from 'vitest';

import {
  SCALE_SLIDER_DRAG_THRESHOLD_PX,
  classifyScaleSliderGesture,
  resolveNearestScaleSliderTick,
} from './scale-slider-drag';

/**
 * 척도 슬라이더의 끌기 계산 — 포인터 자리에서 눈금을, 움직인 거리에서 누르기/끌기를 정한다.
 * 트랙은 눈금 수만큼 같은 폭으로 나뉘고 눈금은 칸마다 한가운데에 선다(타일 한 장의 가운데 아래).
 */

// 왼쪽 100px 에서 시작하는 500px 트랙에 눈금 5개 — 칸 폭 100px, 눈금은 150 · 250 · 350 · 450 · 550
const track = (x: number, tickCount = 5) =>
  resolveNearestScaleSliderTick({ x, trackLeft: 100, trackWidth: 500, tickCount });

describe('resolveNearestScaleSliderTick — 포인터 자리에서 가장 가까운 눈금', () => {
  it('눈금 바로 위는 그 눈금이다', () => {
    expect([150, 250, 350, 450, 550].map((x) => track(x))).toEqual([0, 1, 2, 3, 4]);
  });

  it('눈금에서 조금 벗어난 자리는 가까운 쪽 눈금이다', () => {
    expect(track(199)).toBe(0);
    expect(track(201)).toBe(1);
    expect(track(430)).toBe(3);
  });

  it('트랙 왼쪽 밖은 첫 눈금, 오른쪽 밖은 끝 눈금이다', () => {
    expect(track(-40)).toBe(0);
    expect(track(99)).toBe(0);
    expect(track(601)).toBe(4);
    expect(track(5000)).toBe(4);
  });

  it('트랙의 양끝 자리도 양끝 눈금이다', () => {
    expect(track(100)).toBe(0);
    expect(track(600)).toBe(4);
  });

  it('두 눈금 사이 정확히 한가운데는 오른쪽 눈금이다', () => {
    expect(track(200)).toBe(1);
    expect(track(300)).toBe(2);
    expect(track(500)).toBe(4);
  });

  it('눈금 13개 — 좁은 화면의 칸 폭 26px 에서도 칸마다 제 눈금이다', () => {
    const at = (x: number) =>
      resolveNearestScaleSliderTick({ x, trackLeft: 0, trackWidth: 338, tickCount: 13 });
    expect(at(13)).toBe(0);
    expect(at(25)).toBe(0);
    expect(at(27)).toBe(1);
    expect(at(325)).toBe(12);
  });

  it('트랙 폭을 알 수 없으면 눈금을 정하지 않는다', () => {
    expect(
      resolveNearestScaleSliderTick({ x: 10, trackLeft: 0, trackWidth: 0, tickCount: 5 }),
    ).toBeNull();
    expect(
      resolveNearestScaleSliderTick({ x: 10, trackLeft: 0, trackWidth: Number.NaN, tickCount: 5 }),
    ).toBeNull();
    expect(
      resolveNearestScaleSliderTick({ x: 10, trackLeft: 0, trackWidth: 300, tickCount: 0 }),
    ).toBeNull();
  });
});

describe('resolveNearestScaleSliderTick — 누를 수 없는 눈금 건너뛰기', () => {
  const among = (x: number, disabled: number[]) =>
    resolveNearestScaleSliderTick({
      x,
      trackLeft: 100,
      trackWidth: 500,
      tickCount: 5,
      isTickEnabled: (index) => !disabled.includes(index),
    });

  it('누를 수 있는 눈금 위에서는 판정이 그대로다', () => {
    expect([150, 250, 350, 450, 550].map((x) => among(x, []))).toEqual([0, 1, 2, 3, 4]);
    expect(among(150, [2])).toBe(0);
    expect(among(450, [2])).toBe(3);
  });

  it('누를 수 없는 눈금 위에서는 포인터에서 가까운 쪽의 누를 수 있는 눈금이다', () => {
    // 셋째 눈금(350)이 비활성 — 그 칸의 왼쪽 절반은 둘째, 오른쪽 절반은 넷째 눈금이 가깝다
    expect(among(320, [2])).toBe(1);
    expect(among(380, [2])).toBe(3);
    // 둘째·셋째가 비활성 — 첫째(150)와 넷째(450)의 한가운데는 300
    expect(among(240, [1, 2])).toBe(0);
    expect(among(360, [1, 2])).toBe(3);
  });

  it('양쪽이 똑같이 멀면 오른쪽 눈금이다', () => {
    expect(among(350, [2])).toBe(3);
    expect(among(300, [1, 2])).toBe(3);
  });

  it('한쪽에만 누를 수 있는 눈금이 있으면 그쪽이다', () => {
    expect(among(150, [0, 1])).toBe(2);
    expect(among(-40, [0, 1])).toBe(2);
    expect(among(550, [3, 4])).toBe(2);
    expect(among(5000, [3, 4])).toBe(2);
  });

  it('누를 수 있는 눈금이 없으면 눈금을 정하지 않는다', () => {
    expect(among(350, [0, 1, 2, 3, 4])).toBeNull();
  });
});

describe('classifyScaleSliderGesture — 누르기인가 끌기인가', () => {
  it('문턱은 4px 이다', () => {
    expect(SCALE_SLIDER_DRAG_THRESHOLD_PX).toBe(4);
  });

  it('움직이지 않았거나 문턱 미만으로 움직였으면 누르기다', () => {
    expect(classifyScaleSliderGesture({ startX: 200, currentX: 200 })).toBe('press');
    expect(classifyScaleSliderGesture({ startX: 200, currentX: 203.9 })).toBe('press');
    expect(classifyScaleSliderGesture({ startX: 200, currentX: 196.1 })).toBe('press');
  });

  it('문턱만큼 움직이면 끌기다 — 왼쪽으로도 같다', () => {
    expect(classifyScaleSliderGesture({ startX: 200, currentX: 204 })).toBe('drag');
    expect(classifyScaleSliderGesture({ startX: 200, currentX: 196 })).toBe('drag');
    expect(classifyScaleSliderGesture({ startX: 200, currentX: 380 })).toBe('drag');
  });

  it('문턱을 따로 주면 그 값으로 가른다', () => {
    expect(classifyScaleSliderGesture({ startX: 0, currentX: 6, thresholdPx: 10 })).toBe('press');
    expect(classifyScaleSliderGesture({ startX: 0, currentX: 10, thresholdPx: 10 })).toBe('drag');
  });
});
