import '@testing-library/jest-dom/vitest';

process.env.CONTACT_PII_AES_KEY ??= Buffer.alloc(32, 0xab).toString('base64');
process.env.CONTACT_PII_HMAC_KEY ??= Buffer.alloc(32, 0xcd).toString('base64');
