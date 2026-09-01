// DOM 환경 전용 setup. jest-dom matcher 는 jsdom 에서만 의미가 있어 공용 setup.ts 에서 분리했다.
// 공용 setup.ts 는 DATABASE_URL·PII 키 등 node 테스트에도 필요한 환경변수를 세팅하므로 양쪽이 함께 로드한다.
import '@testing-library/jest-dom/vitest';

// jsdom 에는 ResizeObserver 가 없다. 반응형 측정 훅(useElementWidth 등)을 쓰는
// 컴포넌트는 마운트만으로 ReferenceError 로 죽으므로 관찰하지 않는 껍데기를 둔다 —
// 크기 변화는 jsdom 에서 어차피 일어나지 않아, 관찰해도 발화할 것이 없다.
if (!('ResizeObserver' in globalThis)) {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}
