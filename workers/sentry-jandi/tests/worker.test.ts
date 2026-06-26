import { describe, expect, test, vi } from 'vitest';

import { handleRequest, type Fetcher, type WorkerEnv } from '../src';
import { signSentryWebhookBody } from '../src/signature';

const env: WorkerEnv = {
  JANDI_WEBHOOK_URL: 'https://wh.jandi.com/connect-api/webhook/example',
  SENTRY_CLIENT_SECRET: 'client-secret',
};

describe('handleRequest', () => {
  test('returns health status', async () => {
    const response = await handleRequest(new Request('https://worker.example/healthz'), env);

    await expect(response.json()).resolves.toEqual({ ok: true });
    expect(response.status).toBe(200);
  });

  test('rejects requests without Sentry signature before forwarding to JANDI', async () => {
    const fetcher = vi.fn<Fetcher>();

    const response = await handleRequest(
      new Request('https://worker.example/sentry', {
        method: 'POST',
        body: JSON.stringify({ action: 'created' }),
      }),
      env,
      fetcher,
    );

    expect(response.status).toBe(401);
    expect(fetcher).not.toHaveBeenCalled();
  });

  test('rejects mismatched Sentry signatures before forwarding to JANDI', async () => {
    const fetcher = vi.fn<Fetcher>();

    const response = await handleRequest(
      new Request('https://worker.example/sentry', {
        method: 'POST',
        headers: { 'Sentry-Hook-Signature': 'bad-signature' },
        body: JSON.stringify({ action: 'created' }),
      }),
      env,
      fetcher,
    );

    expect(response.status).toBe(401);
    expect(fetcher).not.toHaveBeenCalled();
  });

  test('does not accept the previous query token authentication path', async () => {
    const fetcher = vi.fn<Fetcher>();

    const response = await handleRequest(
      new Request('https://worker.example/sentry?token=client-secret', {
        method: 'POST',
        body: JSON.stringify({ action: 'created' }),
      }),
      env,
      fetcher,
    );

    expect(response.status).toBe(401);
    expect(fetcher).not.toHaveBeenCalled();
  });

  test('rejects invalid JSON', async () => {
    const fetcher = vi.fn<Fetcher>();
    const rawBody = '{';
    const signature = await signSentryWebhookBody(rawBody, env.SENTRY_CLIENT_SECRET);

    const response = await handleRequest(
      new Request('https://worker.example/sentry', {
        method: 'POST',
        headers: { 'Sentry-Hook-Signature': signature },
        body: rawBody,
      }),
      env,
      fetcher,
    );

    expect(response.status).toBe(400);
    expect(fetcher).not.toHaveBeenCalled();
  });

  test('forwards valid Sentry payloads to JANDI', async () => {
    const fetcher = vi.fn<Fetcher>().mockResolvedValue(new Response('', { status: 200 }));
    const rawBody = JSON.stringify({
      data: {
        level: 'error',
        metadata: { type: 'ReferenceError', value: 'heck is not defined' },
        project: 'survey-table-project',
      },
    });
    const signature = await signSentryWebhookBody(rawBody, env.SENTRY_CLIENT_SECRET);

    const response = await handleRequest(
      new Request('https://worker.example/sentry', {
        method: 'POST',
        headers: { 'Sentry-Hook-Signature': signature },
        body: rawBody,
      }),
      env,
      fetcher,
    );

    expect(response.status).toBe(202);
    expect(fetcher).toHaveBeenCalledWith(env.JANDI_WEBHOOK_URL, {
      method: 'POST',
      headers: {
        Accept: 'application/vnd.tosslab.jandi-v2+json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        body: '[Sentry] ReferenceError: heck is not defined',
        connectColor: '#E5484D',
        connectInfo: [
          { title: 'Project', description: 'survey-table-project' },
          { title: 'Level', description: 'error' },
        ],
      }),
    });
  });

  test('returns 502 when JANDI rejects the message', async () => {
    const fetcher = vi.fn<Fetcher>().mockResolvedValue(new Response('bad gateway', { status: 502 }));
    const rawBody = JSON.stringify({ action: 'created' });
    const signature = await signSentryWebhookBody(rawBody, env.SENTRY_CLIENT_SECRET);

    const response = await handleRequest(
      new Request('https://worker.example/sentry', {
        method: 'POST',
        headers: { 'Sentry-Hook-Signature': signature },
        body: rawBody,
      }),
      env,
      fetcher,
    );

    expect(response.status).toBe(502);
  });
});
