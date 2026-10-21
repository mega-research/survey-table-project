/**
 * 「이미지 크게 보기」(CONTEXT.md) 판정 — 원본 전체가 화면에 다 보이지 않는(줄었거나 잘린) 이미지에만
 * 크게 보기를 붙인다. 원래 크기로 다 보이는 이미지는 같은 그림을 검은 배경 위에 다시 띄울 뿐이라
 * 반응하지 않는다.
 *
 * 같은 이미지라도 데스크톱에서는 원래 크기, 모바일에서는 줄어 있을 수 있어 그려진 크기는 화면마다
 * 다시 잰다. 이 함수는 잰 값만 받는다.
 */

export interface ImageSize {
  width: number;
  height: number;
}

/** 이미지를 상자에 맞추는 방식 — 줄여 넣기(전체 보임) / 잘라 채우기(넘치는 쪽이 잘림) */
export type ImageFit = 'contain' | 'cover';

/** 크게 보기를 여는 버튼의 이름 — 버튼 이름이 대체 텍스트를 덮으므로 원래 설명을 앞에 남긴다 */
export function enlargeTriggerLabel(alt: string): string {
  return `${alt.trim() || '이미지'} 크게 보기`;
}

/** 반 픽셀 미만의 차이는 반올림 오차로 본다 — 1px 줄어든 이미지는 잡고 소수점 측정값은 흘린다 */
const PIXEL_TOLERANCE = 0.5;

export function canEnlargeImage(input: {
  /** 원본 크기(로드 뒤 naturalWidth·naturalHeight) */
  natural: ImageSize;
  /** 그려진 상자 크기 */
  rendered: ImageSize;
  fit: ImageFit;
}): boolean {
  const { natural, rendered, fit } = input;
  if (natural.width <= 0 || natural.height <= 0) return false;
  if (rendered.width <= 0 || rendered.height <= 0) return false;

  const scaleX = rendered.width / natural.width;
  const scaleY = rendered.height / natural.height;
  const scale = fit === 'contain' ? Math.min(scaleX, scaleY) : Math.max(scaleX, scaleY);

  const shrunk = Math.max(natural.width, natural.height) * (1 - scale) >= PIXEL_TOLERANCE;
  const cropped =
    natural.width * scale - rendered.width >= PIXEL_TOLERANCE ||
    natural.height * scale - rendered.height >= PIXEL_TOLERANCE;
  return shrunk || cropped;
}
