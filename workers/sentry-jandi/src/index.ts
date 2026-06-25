import { buildJandiMessage } from './jandi';
import { extractSentryAlertSummary } from './sentry';

export interface WorkerEnv {
  JANDI_WEBHOOK_URL: string;
  SENTRY_WEBHOOK_TOKEN: string;
}

export type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export default {
  fetch(request: Request, env: WorkerEnv): Promise<Response> {
    return handleRequest(request, env);
  },
};

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

  if (!isAuthorized(request, url, env.SENTRY_WEBHOOK_TOKEN)) {
    return json({ ok: false, error: 'unauthorized' }, 401);
  }

  const payload = await readJson(request);
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

function isAuthorized(request: Request, url: URL, expectedToken: string): boolean {
  const bearer = request.headers.get('authorization')?.match(/^Bearer\s+(.+)$/i)?.[1];
  return bearer === expectedToken || url.searchParams.get('token') === expectedToken;
}

async function readJson(request: Request): Promise<{ ok: true; value: unknown } | { ok: false }> {
  try {
    return { ok: true, value: await request.json() };
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
