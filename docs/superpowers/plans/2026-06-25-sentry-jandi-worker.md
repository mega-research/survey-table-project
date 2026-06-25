# Sentry JANDI Worker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Cloudflare Worker that receives Sentry Issue Alert webhooks and forwards concise runtime-error notifications to JANDI.

**Architecture:** The Worker lives under `workers/sentry-jandi/` as an independent deployable module inside this repo. Sentry payload normalization, JANDI formatting, and HTTP handling are separate modules so the behavior is testable through small interfaces without sending real JANDI messages.

**Tech Stack:** TypeScript, Cloudflare Workers, Vitest, Wrangler configuration, JANDI Incoming Webhook JSON format.

---

## Follow-up Auth Change

2026-06-25 follow-up: the implementation was changed from `SENTRY_WEBHOOK_TOKEN` / bearer-or-query-token auth to Sentry Internal Integration signature verification. Current code and runbook use `SENTRY_CLIENT_SECRET` and verify the `Sentry-Hook-Signature` HMAC-SHA256 header against the raw request body before JSON parsing.

## File Structure

- Create `workers/sentry-jandi/src/sentry.ts`: normalize unknown Sentry webhook payloads into a small `SentryAlertSummary`.
- Create `workers/sentry-jandi/src/jandi.ts`: convert `SentryAlertSummary` into JANDI `{ body, connectColor, connectInfo }`.
- Create `workers/sentry-jandi/src/index.ts`: Cloudflare Worker entrypoint and testable `handleRequest`.
- Create `workers/sentry-jandi/tests/sentry.test.ts`: normalization tests.
- Create `workers/sentry-jandi/tests/jandi.test.ts`: JANDI formatting tests.
- Create `workers/sentry-jandi/tests/worker.test.ts`: auth, JSON parsing, JANDI forwarding, and response-code tests.
- Create `workers/sentry-jandi/wrangler.jsonc`: Worker deployment config with required secret names.
- Create `workers/sentry-jandi/README.md`: setup, secret, local dev, deploy, and Sentry Alert Rule instructions.
- Modify `vitest.config.ts`: include `workers/**/*.test.{ts,tsx}` in the normal test suite.
- Modify `.gitignore`: ignore Worker `.dev.vars*` files.
- Modify `package.json`: add Worker helper scripts using `pnpm dlx wrangler@4`.

## Task 1: Sentry Payload Normalization

**Files:**
- Modify: `vitest.config.ts`
- Create: `workers/sentry-jandi/tests/sentry.test.ts`
- Create: `workers/sentry-jandi/src/sentry.ts`

- [ ] **Step 1: Add Worker tests to Vitest include**

Change `vitest.config.ts` normal include from:

```ts
['tests/**/*.test.{ts,tsx}', 'src/**/*.test.{ts,tsx}']
```

to:

```ts
['tests/**/*.test.{ts,tsx}', 'src/**/*.test.{ts,tsx}', 'workers/**/*.test.{ts,tsx}']
```

- [ ] **Step 2: Write the failing normalization tests**

Create `workers/sentry-jandi/tests/sentry.test.ts`:

```ts
import { describe, expect, test } from 'vitest';

import { extractSentryAlertSummary } from '../src/sentry';

describe('extractSentryAlertSummary', () => {
  test('uses metadata type and value as the alert title', () => {
    const summary = extractSentryAlertSummary({
      action: 'triggered',
      data: {
        issue_id: '1117540176',
        issue_url: 'https://sentry.io/api/0/issues/1117540176/',
        level: 'error',
        metadata: {
          type: 'ReferenceError',
          value: 'heck is not defined',
        },
        project: 'survey-table-project',
        release: '2026-06-25',
      },
    });

    expect(summary).toEqual({
      title: 'ReferenceError: heck is not defined',
      errorType: 'ReferenceError',
      level: 'error',
      project: 'survey-table-project',
      release: '2026-06-25',
      issueId: '1117540176',
      issueUrl: 'https://sentry.io/api/0/issues/1117540176/',
    });
  });

  test('falls back to action when detailed Sentry fields are missing', () => {
    const summary = extractSentryAlertSummary({ action: 'created' });

    expect(summary).toEqual({
      title: 'created',
    });
  });

  test('uses a stable fallback title for malformed payloads', () => {
    const summary = extractSentryAlertSummary(null);

    expect(summary).toEqual({
      title: 'Sentry issue alert',
    });
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run:

```bash
pnpm exec vitest run workers/sentry-jandi/tests/sentry.test.ts
```

Expected: FAIL because `../src/sentry` does not exist.

- [ ] **Step 4: Implement the normalizer**

Create `workers/sentry-jandi/src/sentry.ts`:

```ts
export interface SentryAlertSummary {
  title: string;
  errorType?: string;
  level?: string;
  project?: string;
  environment?: string;
  release?: string;
  issueUrl?: string;
  issueId?: string;
}

type UnknownRecord = Record<string, unknown>;

export function extractSentryAlertSummary(payload: unknown): SentryAlertSummary {
  const root = asRecord(payload);
  const data = asRecord(root['data']);
  const metadata = asRecord(data['metadata']);

  const errorType = pickString(metadata['type']);
  const errorValue = pickString(metadata['value']);
  const title =
    pickString(data['title']) ??
    combineErrorTitle(errorType, errorValue) ??
    pickString(data['message']) ??
    pickString(root['action']) ??
    'Sentry issue alert';

  return omitUndefined({
    title,
    errorType,
    level: pickString(data['level']) ?? pickString(root['level']),
    project:
      pickString(data['project']) ?? pickString(root['project']) ?? pickString(root['project_name']),
    environment: pickString(data['environment']) ?? pickString(root['environment']),
    release: pickString(data['release']) ?? pickString(root['release']),
    issueUrl:
      pickString(data['web_url']) ??
      pickString(data['permalink']) ??
      pickString(data['issue_url']) ??
      pickString(root['url']),
    issueId: pickString(data['issue_id']) ?? pickString(root['issue_id']),
  });
}

function asRecord(value: unknown): UnknownRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as UnknownRecord)
    : {};
}

function pickString(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function combineErrorTitle(type: string | undefined, value: string | undefined): string | undefined {
  if (type && value) {
    return `${type}: ${value}`;
  }

  return value ?? type;
}

function omitUndefined(summary: SentryAlertSummary): SentryAlertSummary {
  const entries = Object.entries(summary).filter(([, value]) => value !== undefined);
  return Object.fromEntries(entries) as SentryAlertSummary;
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run:

```bash
pnpm exec vitest run workers/sentry-jandi/tests/sentry.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add vitest.config.ts workers/sentry-jandi/tests/sentry.test.ts workers/sentry-jandi/src/sentry.ts
git commit -m "feat: Sentry 알림 payload 정규화 추가"
```

## Task 2: JANDI Message Formatting

**Files:**
- Create: `workers/sentry-jandi/tests/jandi.test.ts`
- Create: `workers/sentry-jandi/src/jandi.ts`

- [ ] **Step 1: Write the failing JANDI formatter tests**

Create `workers/sentry-jandi/tests/jandi.test.ts`:

```ts
import { describe, expect, test } from 'vitest';

import { buildJandiMessage } from '../src/jandi';

describe('buildJandiMessage', () => {
  test('formats a Sentry summary as a JANDI message', () => {
    const message = buildJandiMessage({
      title: 'ReferenceError: heck is not defined',
      errorType: 'ReferenceError',
      level: 'error',
      project: 'survey-table-project',
      environment: 'production',
      release: '2026-06-25',
      issueId: '1117540176',
      issueUrl: 'https://sentry.io/issues/1117540176/',
    });

    expect(message).toEqual({
      body: '[Sentry] ReferenceError: heck is not defined',
      connectColor: '#E5484D',
      connectInfo: [
        { title: 'Project', description: 'survey-table-project' },
        { title: 'Level', description: 'error' },
        { title: 'Environment', description: 'production' },
        { title: 'Release', description: '2026-06-25' },
        { title: 'Issue ID', description: '1117540176' },
        { title: 'Issue', description: '[Open in Sentry](https://sentry.io/issues/1117540176/)' },
      ],
    });
  });

  test('omits empty optional details', () => {
    const message = buildJandiMessage({
      title: 'Sentry issue alert',
    });

    expect(message).toEqual({
      body: '[Sentry] Sentry issue alert',
      connectColor: '#6B7280',
      connectInfo: [],
    });
  });

  test('uses severity colors', () => {
    expect(buildJandiMessage({ title: 'fatal', level: 'fatal' }).connectColor).toBe('#D92D20');
    expect(buildJandiMessage({ title: 'warning', level: 'warning' }).connectColor).toBe('#F59E0B');
    expect(buildJandiMessage({ title: 'info', level: 'info' }).connectColor).toBe('#3B82F6');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
pnpm exec vitest run workers/sentry-jandi/tests/jandi.test.ts
```

Expected: FAIL because `../src/jandi` does not exist.

- [ ] **Step 3: Implement the formatter**

Create `workers/sentry-jandi/src/jandi.ts`:

```ts
import type { SentryAlertSummary } from './sentry';

interface JandiConnectInfo {
  title: string;
  description: string;
}

export interface JandiMessage {
  body: string;
  connectColor: string;
  connectInfo: JandiConnectInfo[];
}

export function buildJandiMessage(summary: SentryAlertSummary): JandiMessage {
  const connectInfo: JandiConnectInfo[] = [];

  addInfo(connectInfo, 'Project', summary.project);
  addInfo(connectInfo, 'Level', summary.level);
  addInfo(connectInfo, 'Environment', summary.environment);
  addInfo(connectInfo, 'Release', summary.release);
  addInfo(connectInfo, 'Issue ID', summary.issueId);

  if (summary.issueUrl) {
    addInfo(connectInfo, 'Issue', `[Open in Sentry](${summary.issueUrl})`);
  }

  return {
    body: `[Sentry] ${summary.title}`,
    connectColor: colorForLevel(summary.level),
    connectInfo,
  };
}

function addInfo(items: JandiConnectInfo[], title: string, description: string | undefined): void {
  if (description) {
    items.push({ title, description });
  }
}

function colorForLevel(level: string | undefined): string {
  switch (level?.toLowerCase()) {
    case 'fatal':
      return '#D92D20';
    case 'error':
      return '#E5484D';
    case 'warning':
      return '#F59E0B';
    case 'info':
    case 'debug':
      return '#3B82F6';
    default:
      return '#6B7280';
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run:

```bash
pnpm exec vitest run workers/sentry-jandi/tests/jandi.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add workers/sentry-jandi/tests/jandi.test.ts workers/sentry-jandi/src/jandi.ts
git commit -m "feat: JANDI 알림 메시지 포맷 추가"
```

## Task 3: Worker HTTP Handler

**Files:**
- Create: `workers/sentry-jandi/tests/worker.test.ts`
- Create: `workers/sentry-jandi/src/index.ts`

- [ ] **Step 1: Write the failing Worker handler tests**

Create `workers/sentry-jandi/tests/worker.test.ts`:

```ts
import { describe, expect, test, vi } from 'vitest';

import { handleRequest, type Fetcher, type WorkerEnv } from '../src';

const env: WorkerEnv = {
  JANDI_WEBHOOK_URL: 'https://wh.jandi.com/connect-api/webhook/example',
  SENTRY_WEBHOOK_TOKEN: 'secret-token',
};

describe('handleRequest', () => {
  test('returns health status', async () => {
    const response = await handleRequest(new Request('https://worker.example/healthz'), env);

    await expect(response.json()).resolves.toEqual({ ok: true });
    expect(response.status).toBe(200);
  });

  test('rejects requests without token before forwarding to JANDI', async () => {
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

  test('rejects invalid JSON', async () => {
    const fetcher = vi.fn<Fetcher>();

    const response = await handleRequest(
      new Request('https://worker.example/sentry', {
        method: 'POST',
        headers: { authorization: 'Bearer secret-token' },
        body: '{',
      }),
      env,
      fetcher,
    );

    expect(response.status).toBe(400);
    expect(fetcher).not.toHaveBeenCalled();
  });

  test('forwards valid Sentry payloads to JANDI', async () => {
    const fetcher = vi.fn<Fetcher>().mockResolvedValue(new Response('', { status: 200 }));

    const response = await handleRequest(
      new Request('https://worker.example/sentry', {
        method: 'POST',
        headers: { authorization: 'Bearer secret-token' },
        body: JSON.stringify({
          data: {
            level: 'error',
            metadata: { type: 'ReferenceError', value: 'heck is not defined' },
            project: 'survey-table-project',
          },
        }),
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

    const response = await handleRequest(
      new Request('https://worker.example/sentry?token=secret-token', {
        method: 'POST',
        body: JSON.stringify({ action: 'created' }),
      }),
      env,
      fetcher,
    );

    expect(response.status).toBe(502);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
pnpm exec vitest run workers/sentry-jandi/tests/worker.test.ts
```

Expected: FAIL because `../src` does not exist.

- [ ] **Step 3: Implement the Worker handler**

Create `workers/sentry-jandi/src/index.ts`:

```ts
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
```

- [ ] **Step 4: Run the test to verify it passes**

Run:

```bash
pnpm exec vitest run workers/sentry-jandi/tests/worker.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add workers/sentry-jandi/tests/worker.test.ts workers/sentry-jandi/src/index.ts
git commit -m "feat: Sentry JANDI Worker 핸들러 추가"
```

## Task 4: Worker Operations Files

**Files:**
- Create: `workers/sentry-jandi/wrangler.jsonc`
- Create: `workers/sentry-jandi/README.md`
- Modify: `.gitignore`
- Modify: `package.json`

- [ ] **Step 1: Create Wrangler config**

Create `workers/sentry-jandi/wrangler.jsonc`:

```jsonc
{
  "$schema": "node_modules/wrangler/config-schema.json",
  "name": "survey-table-sentry-jandi",
  "main": "src/index.ts",
  "compatibility_date": "2026-06-25",
  "workers_dev": true,
  "observability": {
    "enabled": true
  },
  "secrets": {
    "required": ["JANDI_WEBHOOK_URL", "SENTRY_WEBHOOK_TOKEN"]
  }
}
```

- [ ] **Step 2: Ignore local Worker secrets**

Add to `.gitignore`:

```gitignore
# cloudflare workers local secrets
.dev.vars*
```

- [ ] **Step 3: Add package scripts**

Add to `package.json` scripts:

```json
"worker:sentry-jandi:dev": "pnpm dlx wrangler@4 dev --config workers/sentry-jandi/wrangler.jsonc",
"worker:sentry-jandi:deploy": "pnpm dlx wrangler@4 deploy --config workers/sentry-jandi/wrangler.jsonc"
```

- [ ] **Step 4: Write Worker README**

Create `workers/sentry-jandi/README.md`:

```md
# Sentry to JANDI Worker

Cloudflare Worker that receives Sentry Issue Alert webhooks and forwards concise runtime-error notifications to a JANDI Incoming Webhook.

## Required Secrets

- `JANDI_WEBHOOK_URL`: JANDI Incoming Webhook URL.
- `SENTRY_WEBHOOK_TOKEN`: Shared secret checked by this Worker before forwarding alerts.

Set production secrets:

```bash
pnpm dlx wrangler@4 secret put JANDI_WEBHOOK_URL --config workers/sentry-jandi/wrangler.jsonc
pnpm dlx wrangler@4 secret put SENTRY_WEBHOOK_TOKEN --config workers/sentry-jandi/wrangler.jsonc
```

For local development, create `workers/sentry-jandi/.dev.vars`:

```env
JANDI_WEBHOOK_URL="https://wh.jandi.com/connect-api/webhook/..."
SENTRY_WEBHOOK_TOKEN="replace-with-random-token"
```

`workers/sentry-jandi/.dev.vars` is ignored by git.

## Local Dev

```bash
pnpm worker:sentry-jandi:dev
```

Test a local request:

```bash
curl -X POST "http://localhost:8787/sentry" \
  -H "Authorization: Bearer replace-with-random-token" \
  -H "Content-Type: application/json" \
  --data '{"data":{"level":"error","metadata":{"type":"ReferenceError","value":"heck is not defined"},"project":"survey-table-project"}}'
```

## Deploy

```bash
pnpm worker:sentry-jandi:deploy
```

## Sentry Alert Rule

In Sentry, create an Issue Alert Rule and add a webhook action pointing to:

```text
https://<worker-subdomain>.workers.dev/sentry
```

Prefer sending `Authorization: Bearer <SENTRY_WEBHOOK_TOKEN>` if the Sentry webhook action supports custom headers. If headers are not available, use:

```text
https://<worker-subdomain>.workers.dev/sentry?token=<SENTRY_WEBHOOK_TOKEN>
```
```

- [ ] **Step 5: Run focused tests**

Run:

```bash
pnpm exec vitest run workers/sentry-jandi/tests
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add .gitignore package.json workers/sentry-jandi/wrangler.jsonc workers/sentry-jandi/README.md
git commit -m "docs: Sentry JANDI Worker 운영 문서 추가"
```

## Task 5: Final Verification

**Files:**
- Verify: all files changed by Tasks 1-4

- [ ] **Step 1: Run Worker tests**

Run:

```bash
pnpm exec vitest run workers/sentry-jandi/tests
```

Expected: PASS.

- [ ] **Step 2: Run lint**

Run:

```bash
pnpm lint
```

Expected: exit code 0. Existing React Compiler warnings are acceptable only if the command exits 0.

- [ ] **Step 3: Run TypeScript build check through Next build**

Run:

```bash
pnpm build
```

Expected: exit code 0.

- [ ] **Step 4: Inspect final diff**

Run:

```bash
git status --short
git diff --stat main...HEAD
```

Expected: only Sentry JANDI Worker files, `vitest.config.ts`, `.gitignore`, and `package.json` changed after the design commit baseline.

- [ ] **Step 5: Final commit if verification edits were needed**

If verification required fixes, commit them:

```bash
git add <fixed-files>
git commit -m "fix: Sentry JANDI Worker 검증 오류 수정"
```
