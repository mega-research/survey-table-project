import '@testing-library/jest-dom/vitest';

process.env['CONTACT_PII_AES_KEY'] ??= Buffer.alloc(32, 0xab).toString('base64');
process.env['CONTACT_PII_HMAC_KEY'] ??= Buffer.alloc(32, 0xcd).toString('base64');

// @/db 가 import 시 DATABASE_URL 부재 시 throw 하므로 dummy 부여.
// postgres-js 의 postgres() 는 lazy — 실제 query 가 실행되지 않는 한 connection 미생성.
process.env['DATABASE_URL'] ??= 'postgres://test:test@localhost:5432/test';

// signals.ts 가 module-level 에서 salt 부재 시 throw 하므로 dummy 부여.
process.env['DUPLICATE_DETECTION_SALT'] ??= 'test-salt-do-not-use-in-prod';
