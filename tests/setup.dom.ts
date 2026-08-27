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

// Radix Select·Dropdown 은 Pointer Events API 를 쓰는데 jsdom 이 그 일부를 구현하지 않는다.
// 없으면 트리거 클릭이 "hasPointerCapture is not a function" 으로 죽어 목록이 열리지 않는다.
// 프로덕션 코드가 아니라 jsdom 의 빈틈을 메우는 것이라 setup 이 자리다.
if (typeof Element !== 'undefined') {
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.setPointerCapture ??= () => {};
  Element.prototype.releasePointerCapture ??= () => {};
  Element.prototype.scrollIntoView ??= () => {};
}
