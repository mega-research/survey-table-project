import { buildJandiMessage } from './jandi';
import { extractSentryAlertSummary } from './sentry';
import { verifySentryWebhookSignature } from './signature';

export interface WorkerEnv {
  JANDI_WEBHOOK_URL: string;
  SENTRY_CLIENT_SECRET: string;
}

export type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

const sentryJandiWorker = {
  fetch(request: Request, env: WorkerEnv): Promise<Response> {
    return handleRequest(request, env);
  },
};

export default sentryJandiWorker;

export async function handleRequest(
  request: Request,
  env: WorkerEnv,
  fetcher: Fetcher = fetch,
): Promise<Response> {
  const url = new URL(request.url);

  if (url.pathname === '/healthz') {
    return json({ ok: true }, 200);
  }

  if (url.pathname !== '/sentry') {
    return json({ ok: false, error: 'not_found' }, 404);
  }

  if (request.method !== 'POST') {
    return json({ ok: false, error: 'method_not_allowed' }, 405);
  }

  const rawBody = await request.text();
  const isVerified = await verifySentryWebhookSignature(
    rawBody,
    request.headers.get('Sentry-Hook-Signature'),
    env.SENTRY_CLIENT_SECRET,
  );

  if (!isVerified) {
    return json({ ok: false, error: 'unauthorized' }, 401);
  }

  const payload = readJson(rawBody);
  if (!payload.ok) {
    return json({ ok: false, error: 'invalid_json' }, 400);
  }

  const summary = extractSentryAlertSummary(payload.value);
  const message = buildJandiMessage(summary);
  const jandiResponse = await fetcher(env.JANDI_WEBHOOK_URL, {
    method: 'POST',
    headers: {
      Accept: 'application/vnd.tosslab.jandi-v2+json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(message),
  });

  if (!jandiResponse.ok) {
    return json({ ok: false, error: 'jandi_request_failed' }, 502);
  }

  return json({ ok: true }, 202);
}

function readJson(rawBody: string): { ok: true; value: unknown } | { ok: false } {
  try {
    return { ok: true, value: JSON.parse(rawBody) };
  } catch {
    return { ok: false };
  }
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
