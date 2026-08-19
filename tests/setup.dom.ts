// DOM 환경 전용 setup. jest-dom matcher 는 jsdom 에서만 의미가 있어 공용 setup.ts 에서 분리했다.
// 공용 setup.ts 는 DATABASE_URL·PII 키 등 node 테스트에도 필요한 환경변수를 세팅하므로 양쪽이 함께 로드한다.
import '@testing-library/jest-dom/vitest';
