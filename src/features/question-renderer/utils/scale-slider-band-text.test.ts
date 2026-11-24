import { describe, expect, it } from 'vitest';

import { type ScaleSliderBand, resolveScaleSliderBandTextLayout } from './scale-slider';

/**
 * 구간이 눈금 전부를 덮지 않는 척도(양끝에만 이름이 있는 11점 등)의 **구간 이름 자리** — 타일 상자 없이
 * 글자로만 둘 때 이름마다 어느 열에 어느 쪽으로 붙는가. 투영 자체는 옆 파일(scale-slider.test.ts)이 지킨다.
 */

const band = (label: string, start: number, span: number): ScaleSliderBand => ({
  label,
  start,
  span,
  side: 'neutral',
});

describe('resolveScaleSliderBandTextLayout — 타일 없이 글자로만 두는 구간 이름의 자리', () => {
  it('첫 눈금에서 시작하는 구간은 왼쪽, 끝 눈금에서 끝나는 구간은 오른쪽에 붙는다', () => {
    const layout = resolveScaleSliderBandTextLayout(
      [band('전혀 그렇지 않다', 0, 1), band('매우 그렇다', 4, 1)],
      5,
    );
    expect(layout.map((place) => place.align)).toEqual(['start', 'end']);
  });

  it('이름은 제 구간 밖 빈 눈금까지 자리를 쓴다 — 이웃 구간과 빈 자리를 반씩 나눈다', () => {
    // 5점의 양끝 — 사이 세 눈금 중 한 칸씩 가져가고 한가운데는 비운다
    expect(
      resolveScaleSliderBandTextLayout(
        [band('전혀 그렇지 않다', 0, 1), band('매우 그렇다', 4, 1)],
        5,
      ),
    ).toEqual([
      { start: 0, span: 2, align: 'start' },
      { start: 3, span: 2, align: 'end' },
    ]);
  });

  it('양끝이 아닌 구간은 구간 가운데에 두고, 양옆으로 같은 만큼만 넓힌다', () => {
    expect(
      resolveScaleSliderBandTextLayout(
        [band('전혀 없다', 0, 1), band('보통', 5, 1), band('매우 많다', 10, 1)],
        11,
      ),
    ).toEqual([
      { start: 0, span: 3, align: 'start' },
      { start: 3, span: 5, align: 'center' },
      { start: 8, span: 3, align: 'end' },
    ]);
    // 한쪽 이웃이 바짝 붙어 있으면 넓히지 않는다 — 넓히면 가운데가 구간에서 벗어난다
    expect(
      resolveScaleSliderBandTextLayout([band('낮음', 0, 2), band('중간', 2, 2)], 7)[1],
    ).toEqual({ start: 2, span: 2, align: 'center' });
  });

  it('구간이 하나뿐이면 남은 눈금을 다 쓴다', () => {
    expect(resolveScaleSliderBandTextLayout([band('낮음', 0, 2)], 6)).toEqual([
      { start: 0, span: 6, align: 'start' },
    ]);
    expect(resolveScaleSliderBandTextLayout([band('높음', 4, 2)], 6)).toEqual([
      { start: 0, span: 6, align: 'end' },
    ]);
  });

  it('이웃한 이름의 자리는 겹치지 않는다', () => {
    const layout = resolveScaleSliderBandTextLayout(
      [band('가', 0, 1), band('나', 3, 2), band('다', 6, 1), band('라', 12, 1)],
      13,
    );
    for (let i = 1; i < layout.length; i += 1) {
      const prev = layout[i - 1]!;
      expect(layout[i]!.start).toBeGreaterThanOrEqual(prev.start + prev.span);
    }
    expect(layout.at(-1)).toMatchObject({ align: 'end' });
    expect(layout.at(-1)!.start + layout.at(-1)!.span).toBe(13);
  });
});
