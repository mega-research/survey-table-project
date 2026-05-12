import { createHmac, createSecretKey, type KeyObject } from 'node:crypto';
import { normalizePii, type PiiFieldType } from './pii-fields';

function getKey(): KeyObject {
  const raw = process.env.CONTACT_PII_HMAC_KEY;
  if (!raw) {
    throw new Error('CONTACT_PII_HMAC_KEY env required (base64 32 bytes)');
  }
  const key = Buffer.from(raw, 'base64');
  if (key.length !== 32) {
    throw new Error(`CONTACT_PII_HMAC_KEY must decode to 32 bytes (got ${key.length})`);
  }
  return createSecretKey(new Uint8Array(key));
}

export function blindIndex(fieldType: PiiFieldType, value: string): string {
  const normalized = normalizePii(fieldType, value);
  if (!normalized) return '';
  const hmac = createHmac('sha256', getKey());
  hmac.update(`${fieldType}:${normalized}`);
  return hmac.digest('hex');
}
