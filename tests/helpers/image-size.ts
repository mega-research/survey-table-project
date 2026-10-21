import { fireEvent } from '@testing-library/react';

/**
 * jsdom 은 배치를 계산하지 않아 이미지의 원본 크기(naturalWidth·naturalHeight)와 그려진 크기
 * (clientWidth·clientHeight)가 늘 0 이다. 「이미지 크게 보기」 판정은 두 크기를 비교하므로 테스트에서
 * 정해 준 뒤 load 이벤트를 쏜다.
 */
export function loadImageWithSize(
  img: HTMLImageElement,
  size: {
    natural: { width: number; height: number };
    rendered: { width: number; height: number };
  },
): void {
  const define = (key: string, value: number) =>
    Object.defineProperty(img, key, { configurable: true, get: () => value });
  define('naturalWidth', size.natural.width);
  define('naturalHeight', size.natural.height);
  define('clientWidth', size.rendered.width);
  define('clientHeight', size.rendered.height);
  fireEvent.load(img);
}

/**
 * jsdom 에는 matchMedia 가 없다. 화면 폭(모바일 뷰)과 마우스 유무(hover)를 따로 정한다.
 * 반환값으로 원래 상태를 되돌린다.
 */
export function stubMatchMedia(device: { mobile: boolean; hover: boolean }): () => void {
  const original = window.matchMedia;
  window.matchMedia = ((query: string) => ({
    matches: query.includes('max-width')
      ? device.mobile
      : query.includes('hover')
        ? device.hover
        : false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
  return () => {
    window.matchMedia = original;
  };
}
