import '@testing-library/jest-dom/vitest';

// Node 26은 --localstorage-file 없이 experimental localStorage getter를 읽기만 해도 경고하고
// undefined를 반환한다. jsdom 테스트에는 공용 메모리 Storage를 직접 설치한다.
const localStorageValues = new Map<string, string>();
const testLocalStorage: Storage = {
  get length() {
    return localStorageValues.size;
  },
  clear() {
    localStorageValues.clear();
  },
  getItem(key) {
    return localStorageValues.get(String(key)) ?? null;
  },
  key(index) {
    return [...localStorageValues.keys()][index] ?? null;
  },
  removeItem(key) {
    localStorageValues.delete(String(key));
  },
  setItem(key, value) {
    localStorageValues.set(String(key), String(value));
  },
};

if (typeof window !== 'undefined') {
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    value: testLocalStorage,
  });
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: testLocalStorage,
  });
}

process.env['CONTACT_PII_AES_KEY'] ??= Buffer.alloc(32, 0xab).toString('base64');
process.env['CONTACT_PII_HMAC_KEY'] ??= Buffer.alloc(32, 0xcd).toString('base64');

// @/db 가 import 시 DATABASE_URL 부재 시 throw 하므로 dummy 부여.
// postgres-js 의 postgres() 는 lazy — 실제 query 가 실행되지 않는 한 connection 미생성.
process.env['DATABASE_URL'] ??= 'postgres://test:test@localhost:5432/test';

// signals.ts 가 module-level 에서 salt 부재 시 throw 하므로 dummy 부여.
process.env['DUPLICATE_DETECTION_SALT'] ??= 'test-salt-do-not-use-in-prod';
