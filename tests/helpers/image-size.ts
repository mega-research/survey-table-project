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
 * 크게 보기를 연 채 끝난 테스트는 정리 뒤 한 박자 늦게 방문 기록 칸이 걷힌다 — 다음 테스트로 새지 않게
 * afterEach 에서 기다린다. 시간을 정해 기다리지 않고 표식 칸이 실제로 걷힐 때까지 본다: 전체 스위트처럼
 * 부하가 걸리면 걷기(창 정리의 setTimeout → jsdom 의 history.back 처리)가 정한 시간을 넘겨, 다음
 * 테스트가 표식 칸 위에서 창을 연 뒤 늦게 온 popstate 에 그 창이 닫혔다.
 */
export async function settleImageEnlargeHistory(): Promise<void> {
  const tick = () => new Promise((resolve) => setTimeout(resolve, 5));
  const hasEnlargeEntry = () => {
    const state: unknown = window.history.state;
    return typeof state === 'object' && state !== null && 'imageEnlarge' in state;
  };
  await tick();
  for (let waited = 0; hasEnlargeEntry() && waited < 2000; waited += 5) await tick();
  // 칸이 걷힌 뒤 popstate 가 전달될 한 박자
  await tick();
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
