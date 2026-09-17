// DOM 환경 전용 setup. jest-dom matcher 는 jsdom 에서만 의미가 있어 공용 setup.ts 에서 분리했다.
// 공용 setup.ts 는 DATABASE_URL·PII 키 등 node 테스트에도 필요한 환경변수를 세팅하므로 양쪽이 함께 로드한다.
//
// 2026-08-20: '@testing-library/jest-dom/vitest' 는 자기 모듈 안에서 import 한 expect 로
// extend 하는데, vitest 4.1.10 에서는 그 expect 가 테스트가 쓰는 인스턴스와 달라 matcher 가
// 등록되지 않는다(전 DOM 테스트가 "Invalid Chai property: toBeInTheDocument" 로 실패).
// 그래서 등록은 이 파일의 expect 로 직접 한다. 위 import 는 Assertion 타입 보강 때문에 유지한다.
import * as matchers from '@testing-library/jest-dom/matchers';
import '@testing-library/jest-dom/vitest';
import { expect } from 'vitest';

expect.extend(matchers);

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
