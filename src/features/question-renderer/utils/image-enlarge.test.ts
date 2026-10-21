import { describe, expect, it } from 'vitest';

import { canEnlargeImage } from './image-enlarge';

describe('canEnlargeImage — 원본 전체가 화면에 다 보이지 않는(줄었거나 잘린) 이미지인가', () => {
  it('원본과 같은 크기로 그려지면 크게 보기가 붙지 않는다', () => {
    expect(
      canEnlargeImage({
        natural: { width: 400, height: 300 },
        rendered: { width: 400, height: 300 },
        fit: 'contain',
      }),
    ).toBe(false);
  });

  it('원본보다 1px 작게 줄어 그려지면 붙는다', () => {
    expect(
      canEnlargeImage({
        natural: { width: 401, height: 300 },
        rendered: { width: 400, height: 299.25 },
        fit: 'contain',
      }),
    ).toBe(true);
  });

  it('칸에 맞춰 크게 줄어든 시안 이미지에 붙는다', () => {
    expect(
      canEnlargeImage({
        natural: { width: 1920, height: 1400 },
        rendered: { width: 132, height: 96 },
        fit: 'contain',
      }),
    ).toBe(true);
  });

  it('contain — 너비는 들어맞아도 세로가 상자보다 크면 줄어 그려지므로 붙는다', () => {
    expect(
      canEnlargeImage({
        natural: { width: 200, height: 600 },
        rendered: { width: 200, height: 300 },
        fit: 'contain',
      }),
    ).toBe(true);
  });

  it('contain — 원본보다 크게 늘어나 그려진 작은 이미지는 다 보이므로 붙지 않는다', () => {
    expect(
      canEnlargeImage({
        natural: { width: 100, height: 80 },
        rendered: { width: 300, height: 240 },
        fit: 'contain',
      }),
    ).toBe(false);
  });

  it('cover — 너비는 같아도 위아래가 잘리면 붙는다', () => {
    expect(
      canEnlargeImage({
        natural: { width: 160, height: 400 },
        rendered: { width: 160, height: 80 },
        fit: 'cover',
      }),
    ).toBe(true);
  });

  it('cover — 상자와 비율·크기가 같으면 잘리지 않으므로 붙지 않는다', () => {
    expect(
      canEnlargeImage({
        natural: { width: 160, height: 80 },
        rendered: { width: 160, height: 80 },
        fit: 'cover',
      }),
    ).toBe(false);
  });

  it('크기를 아직 모르면(로드 전·로드 실패) 붙지 않는다', () => {
    expect(
      canEnlargeImage({
        natural: { width: 0, height: 0 },
        rendered: { width: 132, height: 96 },
        fit: 'contain',
      }),
    ).toBe(false);
    expect(
      canEnlargeImage({
        natural: { width: 1920, height: 1400 },
        rendered: { width: 0, height: 0 },
        fit: 'contain',
      }),
    ).toBe(false);
  });
});
