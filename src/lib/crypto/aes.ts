import {
  createCipheriv,
  createDecipheriv,
  createSecretKey,
  randomBytes,
  type KeyObject,
} from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const TAG_LENGTH = 16;

/**
 * 키 버전 dispatch — token prefix 로 버전 식별 후 적절한 env 키 사용.
 *
 * 새 키 도입 절차:
 *  1. CONTACT_PII_AES_KEY_V2 env 추가 (운영 secrets)
 *  2. 아래 KEY_ENV_MAP 에 'v2' 등록
 *  3. ACTIVE_VERSION 을 'v2' 로 변경 → 신규 암호화는 v2
 *  4. 백그라운드 잡으로 기존 v1 cipher 복호화 후 v2 로 재암호화
 *  5. 모든 데이터 마이그레이션 완료 후 'v1' 항목 제거 + env 정리
 *
 * 복호화는 token 의 prefix 를 보고 자동으로 해당 버전 키 사용 — dual-decrypt.
 */
const KEY_ENV_MAP: Record<string, string> = {
  v1: 'CONTACT_PII_AES_KEY',
  // v2: 'CONTACT_PII_AES_KEY_V2',  // 키 로테이션 시 활성화
};

/** 신규 암호화에 사용할 버전. */
const ACTIVE_VERSION = 'v1';

// Node 22 의 @types/node 가 Buffer<ArrayBufferLike> vs Uint8Array<ArrayBuffer> 를 구분해
// createCipheriv 에 Buffer 직접 전달 시 타입 에러가 발생. KeyObject 로 한 번 감싸 우회.
function getKeyForVersion(version: string): KeyObject {
  const envName = KEY_ENV_MAP[version];
  if (!envName) {
    throw new Error(`decryptPii: unsupported key version "${version}"`);
  }
  const raw = process.env[envName];
  if (!raw) {
    throw new Error(`${envName} env required (base64 32 bytes)`);
  }
  const key = Buffer.from(raw, 'base64');
  if (key.length !== 32) {
    throw new Error(`${envName} must decode to 32 bytes (got ${key.length})`);
  }
  return createSecretKey(new Uint8Array(key));
}

function toU8(b: Buffer | Uint8Array): Uint8Array {
  return b instanceof Uint8Array && !(b instanceof Buffer) ? b : new Uint8Array(b);
}

export function encryptPii(plain: string): string {
  const iv = new Uint8Array(randomBytes(IV_LENGTH));
  const cipher = createCipheriv(ALGORITHM, getKeyForVersion(ACTIVE_VERSION), iv);
  const enc = Buffer.concat([toU8(cipher.update(plain, 'utf8')), toU8(cipher.final())]);
  const tag = cipher.getAuthTag();
  const payload = Buffer.concat([iv, toU8(tag), toU8(enc)]).toString('base64');
  return `${ACTIVE_VERSION}:${payload}`;
}

export function decryptPii(token: string): string {
  const sep = token.indexOf(':');
  if (sep < 0) {
    throw new Error('decryptPii: missing key version prefix');
  }
  const version = token.slice(0, sep);
  const payload = token.slice(sep + 1);
  if (!payload) {
    throw new Error('decryptPii: empty payload');
  }
  const buf = Buffer.from(payload, 'base64');
  if (buf.length < IV_LENGTH + TAG_LENGTH) {
    throw new Error('decryptPii: payload too short');
  }
  const iv = new Uint8Array(buf.subarray(0, IV_LENGTH));
  const tag = new Uint8Array(buf.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH));
  const enc = new Uint8Array(buf.subarray(IV_LENGTH + TAG_LENGTH));
  // version 에 따라 자동으로 해당 키 사용 → 키 로테이션 기간에도 옛 cipher 복호화 가능
  const decipher = createDecipheriv(ALGORITHM, getKeyForVersion(version), iv);
  decipher.setAuthTag(tag);
  const dec = Buffer.concat([toU8(decipher.update(enc)), toU8(decipher.final())]);
  return dec.toString('utf8');
}
