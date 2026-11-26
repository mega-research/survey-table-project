import { describe, expect, it } from 'vitest';

import {
  DEFAULT_SCALE_SLIDER_DIRECTION,
  SCALE_SLIDER_DIRECTIONS,
  isScaleSliderDirection,
} from './scale-slider';

describe('슬라이더 방향 어휘', () => {
  it('값은 둘이고 기본은 오른쪽이 긍정이다', () => {
    expect([...SCALE_SLIDER_DIRECTIONS]).toEqual(['positive-right', 'positive-left']);
    expect(DEFAULT_SCALE_SLIDER_DIRECTION).toBe('positive-right');
  });

  it('목록의 값만 방향으로 읽는다', () => {
    for (const direction of SCALE_SLIDER_DIRECTIONS) {
      expect(isScaleSliderDirection(direction)).toBe(true);
    }
    for (const value of [undefined, null, '', true, 1, 'right', 'positive', 'POSITIVE-RIGHT']) {
      expect(isScaleSliderDirection(value)).toBe(false);
    }
  });
});
