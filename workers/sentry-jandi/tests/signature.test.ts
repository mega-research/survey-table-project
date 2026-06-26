import { describe, expect, test } from 'vitest';

import { signSentryWebhookBody, verifySentryWebhookSignature } from '../src/signature';

describe('Sentry webhook signatures', () => {
  test('signs the raw request body with HMAC-SHA256 hex', async () => {
    const signature = await signSentryWebhookBody('{"action":"created"}', 'client-secret');

    expect(signature).toBe('1c20166a5a6576f55b72d626aefc22c6e73a252e1f4cc8e87dc0ede1cdf4b5bc');
  });

  test('accepts a matching Sentry-Hook-Signature value', async () => {
    const rawBody = '{"data":{"level":"error"}}';
    const signature = await signSentryWebhookBody(rawBody, 'client-secret');

    await expect(verifySentryWebhookSignature(rawBody, signature, 'client-secret')).resolves.toBe(
      true,
    );
  });

  test('rejects missing or mismatched signatures', async () => {
    const rawBody = '{"data":{"level":"error"}}';

    await expect(verifySentryWebhookSignature(rawBody, null, 'client-secret')).resolves.toBe(false);
    await expect(
      verifySentryWebhookSignature(rawBody, 'not-the-real-signature', 'client-secret'),
    ).resolves.toBe(false);
  });

  test('rejects configured empty client secrets', async () => {
    const rawBody = '{"data":{"level":"error"}}';
    const signature = await signSentryWebhookBody(rawBody, 'client-secret');

    await expect(verifySentryWebhookSignature(rawBody, signature, '')).resolves.toBe(false);
  });
});
