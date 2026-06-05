# oRPC PR1 인프라 골격 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** oRPC 서버/클라이언트 코어, RPC·OpenAPI 핸들러, RSC 직접호출, ESLint feature 격리, vitest 확장, 로컬 test DB 스크립트, CI를 깔아 이후 feature 마이그레이션의 기반을 만든다.

**Architecture:** `src/server/`에 oRPC 코어(context/orpc/router/handler/client)를 신설하고, `src/app/api/rpc`·`api/v1` 라우트 핸들러를 연결한다. 기존 `@/db`·`@/lib`·`@/components/ui`는 제자리 유지(점진 이동). `health.check` procedure 하나로 end-to-end를 검증한다.

**Tech Stack:** Next.js 16.2.4 (App Router), oRPC(@orpc/server·client·tanstack-query·openapi), zod 4.4.3, TanStack Query 5.90, Supabase SSR 0.8, Sentry, Vitest 4.1, Playwright.

---

## File Structure

**신규:**
- `src/server/context.ts` — `createContext()`: db + supabase + user. RSC·procedure 공용
- `src/server/orpc.ts` — `base`/`pub`/`authed` 베이스 + auth 미들웨어
- `src/server/procedures/health.ts` — `health.check` (인프라 검증용)
- `src/server/router.ts` — feature router 합성 (PR1: health만)
- `src/server/handler.ts` — `rpcHandler`(RPCHandler) + Sentry onError interceptor
- `src/server/openapi.ts` — `openapiHandler`(OpenAPIHandler)
- `src/server/client.ts` — server-side `$client` (createRouterClient, RSC 직접호출)
- `src/shared/lib/rpc.ts` — browser client(RPCLink fallback) + `orpc`(tanstack query utils)
- `src/app/api/rpc/[[...rest]]/route.ts` — RPC fetch 핸들러
- `src/app/api/v1/[[...rest]]/route.ts` — OpenAPI fetch 핸들러 (env gate)
- `src/server/procedures/health.test.ts` — health unit (createRouterClient mock)
- `playwright.config.ts` — Playwright 설정
- `tests/e2e/app-boot.spec.ts` — 앱 부팅 smoke 1개
- `scripts/setup-test-db.sh` — 검증된 로컬 test DB 셋업
- `.github/workflows/ci.yml` — lint + typecheck + vitest + e2e

**수정:**
- `eslint.config.mjs` — feature 격리 no-restricted-imports
- `vitest.config.ts` — include에 `src/**/*.test.{ts,tsx}` 추가
- `package.json` — scripts (`test:e2e`, `db:setup-test`)
- `supabase/config.toml` — `[db.migrations] enabled = false` 커밋 (이미 로컬 변경됨)

> **범위 밖(별도 plan):** 기능 smoke E2E 6개(로그인~메일), shared/로 db·ui·lib 물리 이동, library feature(PR2).

---

## Task 1: oRPC·Playwright 패키지 설치

**Files:**
- Modify: `package.json` (dependencies)

- [ ] **Step 1: 패키지 설치**

Run:
```bash
pnpm add @orpc/server @orpc/client @orpc/tanstack-query @orpc/openapi
pnpm add -D @playwright/test
```

- [ ] **Step 2: 설치 검증**

Run: `grep -E '"@orpc/|"@playwright' package.json`
Expected: `@orpc/server`, `@orpc/client`, `@orpc/tanstack-query`, `@orpc/openapi`, `@playwright/test` 5줄 출력

- [ ] **Step 3: Playwright 브라우저 설치**

Run: `pnpm exec playwright install chromium`
Expected: chromium 다운로드 완료

- [ ] **Step 4: 커밋**

```bash
git add package.json pnpm-lock.yaml
git commit -m "chore: oRPC 및 Playwright 의존성 추가"
```

---

## Task 2: createContext — db·supabase·user 컨텍스트

**Files:**
- Create: `src/server/context.ts`

- [ ] **Step 1: context.ts 작성**

```ts
// src/server/context.ts
import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

import { db } from '@/db';
import { createClient } from '@/lib/supabase/server';

export interface AuthUser {
  id: string;
  email: string | null;
}

export interface ORPCContext {
  db: typeof db;
  supabase: SupabaseClient;
  user: AuthUser | null;
}

/**
 * RSC와 procedure 양쪽이 재사용하는 요청 컨텍스트.
 * supabase 세션을 한 번 읽어 user를 채운다(없으면 null).
 */
export async function createContext(): Promise<ORPCContext> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return {
    db,
    supabase,
    user: user ? { id: user.id, email: user.email ?? null } : null,
  };
}
```

- [ ] **Step 2: 타입체크**

Run: `pnpm exec tsc --noEmit`
Expected: 에러 없음 (또는 본 파일 관련 에러 없음)

- [ ] **Step 3: 커밋**

```bash
git add src/server/context.ts
git commit -m "feat: oRPC createContext 추가"
```

---

## Task 3: orpc.ts — base·pub·authed 베이스

**Files:**
- Create: `src/server/orpc.ts`

- [ ] **Step 1: orpc.ts 작성**

```ts
// src/server/orpc.ts
import { ORPCError, os } from '@orpc/server';

import type { AuthUser, ORPCContext } from './context';

/** 모든 procedure의 뿌리. 컨텍스트 타입만 박는다. */
export const base = os.$context<ORPCContext>();

/** 응답자(공개) 베이스 — 인증 불필요. */
export const pub = base;

/**
 * 관리자 베이스 — supabase 세션 필수.
 * 통과하면 context.user가 non-null로 좁혀진다.
 */
export const authed = base.use(({ context, next }) => {
  if (!context.user) {
    throw new ORPCError('UNAUTHORIZED', { message: '인증이 필요합니다.' });
  }
  return next({ context: { user: context.user satisfies AuthUser } });
});
```

- [ ] **Step 2: 타입체크**

Run: `pnpm exec tsc --noEmit`
Expected: 에러 없음

- [ ] **Step 3: 커밋**

```bash
git add src/server/orpc.ts
git commit -m "feat: oRPC base/pub/authed 베이스 및 인증 미들웨어 추가"
```

---

## Task 4: health procedure + router

**Files:**
- Create: `src/server/procedures/health.ts`
- Create: `src/server/router.ts`
- Test: `src/server/procedures/health.test.ts`

> **선행 의존:** colocated 테스트(`src/**`) 수집을 위해 **Task 10(vitest include 확장)을 먼저 수행**하라. 현재 `vitest.config.ts`의 include는 `tests/**`만이라, 먼저 확장하지 않으면 아래 Step 2/5에서 "No test files found"가 난다.

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
// src/server/procedures/health.test.ts
import { createRouterClient } from '@orpc/server';
import { describe, expect, it } from 'vitest';

import type { ORPCContext } from '../context';
import { router } from '../router';

function mockContext(): ORPCContext {
  return { db: {} as never, supabase: {} as never, user: null };
}

describe('health.check', () => {
  it('ok:true 와 ISO now 를 반환한다', async () => {
    const client = createRouterClient(router, { context: mockContext() });
    const res = await client.health.check();
    expect(res.ok).toBe(true);
    expect(() => new Date(res.now).toISOString()).not.toThrow();
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `pnpm exec vitest run src/server/procedures/health.test.ts`
Expected: FAIL — `Cannot find module '../router'` (아직 미작성)

- [ ] **Step 3: health.ts 작성**

```ts
// src/server/procedures/health.ts
import * as z from 'zod';

import { pub } from '../orpc';

export const health = {
  check: pub
    .output(z.object({ ok: z.literal(true), now: z.string() }))
    .handler(() => ({ ok: true as const, now: new Date().toISOString() })),
};
```

- [ ] **Step 4: router.ts 작성**

```ts
// src/server/router.ts
import { health } from './procedures/health';

export const router = {
  health,
};

export type AppRouter = typeof router;
```

- [ ] **Step 5: 테스트 통과 확인**

Run: `pnpm exec vitest run src/server/procedures/health.test.ts`
Expected: PASS (1 test) — 단, vitest include가 `src/**`를 아직 포함 안 하면 "No test files found". 그 경우 Task 10을 먼저 수행 후 재실행.

- [ ] **Step 6: 커밋**

```bash
git add src/server/procedures/health.ts src/server/router.ts src/server/procedures/health.test.ts
git commit -m "feat: health.check procedure 및 router 골격 추가"
```

---

## Task 5: RPC 핸들러 + /api/rpc 라우트

**Files:**
- Create: `src/server/handler.ts`
- Create: `src/app/api/rpc/[[...rest]]/route.ts`

- [ ] **Step 1: handler.ts 작성**

```ts
// src/server/handler.ts
import { onError } from '@orpc/server';
import { RPCHandler } from '@orpc/server/fetch';
import * as Sentry from '@sentry/nextjs';

import { router } from './router';

/**
 * RPC 핸들러. typed/expected 에러가 아닌 예기치 못한 에러만 Sentry로 캡처한다.
 * (typed domain error는 isDefinedError 경로로 클라이언트가 처리)
 */
export const rpcHandler = new RPCHandler(router, {
  interceptors: [
    onError((error) => {
      Sentry.captureException(error);
    }),
  ],
});
```

- [ ] **Step 2: route.ts 작성**

```ts
// src/app/api/rpc/[[...rest]]/route.ts
import { createContext } from '@/server/context';
import { rpcHandler } from '@/server/handler';

async function handle(request: Request) {
  const { response } = await rpcHandler.handle(request, {
    prefix: '/api/rpc',
    context: await createContext(),
  });
  return response ?? new Response('Not found', { status: 404 });
}

export const GET = handle;
export const POST = handle;
```

- [ ] **Step 3: 빌드 검증**

Run: `pnpm exec tsc --noEmit`
Expected: 에러 없음

- [ ] **Step 4: 런타임 검증 (dev 서버)**

Run (별도 터미널): `pnpm dev`
Run: `curl -s -X POST http://localhost:3000/api/rpc/health/check -H 'content-type: application/json' -d '{"json":null}' | head -c 200`
Expected: `{"json":{"ok":true,"now":"...ISO..."}}` 형태 응답 (RPC 직렬화 형식). 응답에 `ok:true` 포함되면 성공.

- [ ] **Step 5: 커밋**

```bash
git add src/server/handler.ts src/app/api/rpc
git commit -m "feat: RPC fetch 핸들러 및 api/rpc 라우트 연결"
```

---

## Task 6: OpenAPI 핸들러 + /api/v1 라우트 (env gate)

**Files:**
- Create: `src/server/openapi.ts`
- Create: `src/app/api/v1/[[...rest]]/route.ts`

- [ ] **Step 1: openapi.ts 작성**

```ts
// src/server/openapi.ts
import { OpenAPIHandler } from '@orpc/openapi/fetch';

import { router } from './router';

export const openapiHandler = new OpenAPIHandler(router);

/** /api/v1 외부 노출 여부. 기본 비활성(env로만 켬). */
export function isPublicApiEnabled(): boolean {
  return process.env['ENABLE_PUBLIC_API'] === 'true';
}
```

- [ ] **Step 2: route.ts 작성**

```ts
// src/app/api/v1/[[...rest]]/route.ts
import { createContext } from '@/server/context';
import { isPublicApiEnabled, openapiHandler } from '@/server/openapi';

async function handle(request: Request) {
  if (!isPublicApiEnabled()) {
    return new Response('Not found', { status: 404 });
  }
  const { response } = await openapiHandler.handle(request, {
    prefix: '/api/v1',
    context: await createContext(),
  });
  return response ?? new Response('Not found', { status: 404 });
}

export const GET = handle;
export const POST = handle;
```

- [ ] **Step 3: 타입체크 + 게이트 검증**

Run: `pnpm exec tsc --noEmit`
Expected: 에러 없음

Run (dev 서버 띄운 상태, ENABLE_PUBLIC_API 미설정): `curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/api/v1/health/check`
Expected: `404` (게이트 차단)

- [ ] **Step 4: 커밋**

```bash
git add src/server/openapi.ts src/app/api/v1
git commit -m "feat: OpenAPI 핸들러 및 env 게이트된 api/v1 라우트 추가"
```

---

## Task 7: server-side $client — RSC 직접호출

**Files:**
- Create: `src/server/client.ts`

- [ ] **Step 1: client.ts 작성**

```ts
// src/server/client.ts
import 'server-only';

import type { RouterClient } from '@orpc/server';
import { createRouterClient } from '@orpc/server';

import { createContext } from './context';
import { router } from './router';

/**
 * RSC에서 procedure를 HTTP 없이 메모리 직접 호출하기 위한 server-side 클라이언트.
 * globalThis에 심어, shared/lib/rpc.ts의 isomorphic client가 서버에서 이걸 집어쓴다.
 * 매 요청 createContext()로 per-request 컨텍스트를 만든다.
 */
declare global {
  // eslint-disable-next-line no-var
  var $client: RouterClient<typeof router> | undefined;
}

globalThis.$client = createRouterClient(router, {
  context: () => createContext(),
});
```

- [ ] **Step 2: 타입체크**

Run: `pnpm exec tsc --noEmit`
Expected: 에러 없음

- [ ] **Step 3: 커밋**

```bash
git add src/server/client.ts
git commit -m "feat: RSC 직접호출용 server-side oRPC 클라이언트 추가"
```

---

## Task 8: shared/lib/rpc.ts — browser client + tanstack utils

**Files:**
- Create: `src/shared/lib/rpc.ts`

- [ ] **Step 1: rpc.ts 작성**

```ts
// src/shared/lib/rpc.ts
import type { RouterClient } from '@orpc/server';
import { createORPCClient } from '@orpc/client';
import { RPCLink } from '@orpc/client/fetch';
import { createTanstackQueryUtils } from '@orpc/tanstack-query';

import type { router } from '@/server/router';

const link = new RPCLink({
  url: () => {
    if (typeof window === 'undefined') {
      throw new Error('RPCLink는 클라이언트 전용입니다. RSC는 server/client.ts의 $client를 씁니다.');
    }
    return `${window.location.origin}/api/rpc`;
  },
});

/**
 * isomorphic 클라이언트.
 * - 서버(RSC): globalThis.$client(createRouterClient) 사용 → HTTP 없음
 * - 브라우저: RPCLink로 /api/rpc 호출
 */
export const client: RouterClient<typeof router> =
  globalThis.$client ?? createORPCClient(link);

/** TanStack Query 통합: orpc.health.check.queryOptions() 등 */
export const orpc = createTanstackQueryUtils(client);
```

- [ ] **Step 2: 타입체크**

Run: `pnpm exec tsc --noEmit`
Expected: 에러 없음

- [ ] **Step 3: 커밋**

```bash
git add src/shared/lib/rpc.ts
git commit -m "feat: isomorphic oRPC 클라이언트 및 TanStack Query 유틸 추가"
```

---

## Task 9: ESLint feature 격리 룰

**Files:**
- Modify: `eslint.config.mjs`

- [ ] **Step 1: 룰 블록 추가**

`eslint.config.mjs`의 `eslintConfigPrettier,` 바로 앞(배열 마지막 객체 뒤)에 아래 객체를 추가:

```js
  {
    files: ['src/features/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@/features/*/**'],
              message:
                'feature 간 직접 import 금지. 공용은 @/shared로 승격하거나 RPC(@/shared/lib/rpc)를 경유하세요. (자기 feature 내부는 상대경로 사용)',
            },
          ],
        },
      ],
    },
  },
```

> 자기 feature 내부 import는 상대경로(`./`, `../`)로 하므로 `@/features/*` 패턴에 걸리지 않는다. 다른 feature를 `@/features/<x>`로 가져오는 것만 차단된다.

- [ ] **Step 2: lint 검증**

Run: `pnpm lint`
Expected: 에러 없음 (features/ 디렉토리가 아직 없으므로 룰은 무영향, config 파싱만 검증)

- [ ] **Step 3: 커밋**

```bash
git add eslint.config.mjs
git commit -m "feat: feature 간 직접 import 금지 ESLint 룰 추가"
```

---

## Task 10: vitest include 확장 (colocated 테스트)

**Files:**
- Modify: `vitest.config.ts`

- [ ] **Step 1: include 확장**

`vitest.config.ts`의 `include` 라인을 교체:

```ts
    include: ['tests/**/*.test.{ts,tsx}', 'src/**/*.test.{ts,tsx}'],
```

- [ ] **Step 2: colocated 테스트 수집 확인**

Run: `pnpm exec vitest run src/server/procedures/health.test.ts`
Expected: PASS (1 test) — Task 4의 colocated 테스트가 이제 수집됨

- [ ] **Step 3: 전체 스위트 회귀 확인**

Run: `pnpm test`
Expected: 기존 tests/ 전부 통과 + health.test.ts 통과. 신규 실패 0
> 참고: profiles-row-actions 전체 스위트는 간헐 flaky(격리 실행은 통과). 회귀로 오해 말 것.

- [ ] **Step 4: 커밋**

```bash
git add vitest.config.ts
git commit -m "test: vitest include에 src colocated 테스트 추가"
```

---

## Task 11: 로컬 test DB 셋업 스크립트

**Files:**
- Create: `scripts/setup-test-db.sh`
- Modify: `package.json` (scripts)
- Modify: `supabase/config.toml` (이미 로컬 변경됨 — 커밋만)

- [ ] **Step 1: setup-test-db.sh 작성**

```bash
#!/usr/bin/env bash
# 로컬 supabase test DB 셋업 (검증 절차 2026-06-05)
# supabase CLI 마이그레이션은 config.toml에서 비활성(prefix 중복 PK 충돌 회피).
# drizzle journal이 sql 파일과 미동기화라 db:migrate 대신 drizzle-kit push로 schema SoT를 직접 반영.
set -euo pipefail

LOCAL_DB_URL="postgresql://postgres:postgres@127.0.0.1:54322/postgres"

echo "[1/4] supabase 로컬 스택 기동"
supabase start

echo "[2/4] 빈 public 스키마로 reset"
supabase db reset

echo "[3/4] drizzle-kit push로 schema SoT 반영 (strict 일시 우회)"
# drizzle.config.ts의 strict:true는 TTY confirm을 요구하므로, 임시 config로 비대화 push
TMP_CFG="$(mktemp -t drizzle-push-XXXX.config.ts)"
sed 's/strict: true/strict: false/' drizzle.config.ts > "$TMP_CFG"
DATABASE_URL="$LOCAL_DB_URL" pnpm exec drizzle-kit push --config "$TMP_CFG"
rm -f "$TMP_CFG"

echo "[4/4] 검증: public 테이블 개수"
CONTAINER="$(docker ps --filter name=supabase_db --format '{{.Names}}' | head -1)"
COUNT="$(docker exec "$CONTAINER" psql -U postgres -d postgres -tAc \
  "select count(*) from information_schema.tables where table_schema='public';")"
echo "public 테이블: $COUNT"
if [ "$COUNT" -lt 19 ]; then
  echo "ERROR: 테이블이 19개 미만. 셋업 실패." >&2
  exit 1
fi
echo "test DB 셋업 완료."
```

> drizzle.config가 상대경로(`./src/db/schema`)를 쓰고 drizzle-kit는 cwd 기준으로 해석하므로, /tmp의 임시 config로도 schema 경로는 프로젝트 루트 기준으로 동작한다. cwd가 프로젝트 루트인 상태에서 실행할 것.

- [ ] **Step 2: 실행 권한 + package.json scripts 추가**

Run: `chmod +x scripts/setup-test-db.sh`

`package.json`의 `scripts`에 추가:
```json
    "db:setup-test": "bash scripts/setup-test-db.sh",
```

- [ ] **Step 3: 스크립트 실행 검증**

Run: `pnpm db:setup-test`
Expected: 마지막에 `public 테이블: 19` 이상 + `test DB 셋업 완료.` 출력

> 임시 config 방식이 cwd 문제로 실패하면, 대안으로 스크립트에서 `cp drizzle.config.ts /tmp/bak && sed -i '' 's/strict: true/strict: false/' drizzle.config.ts && DATABASE_URL=... pnpm db:push; cp /tmp/bak drizzle.config.ts` 패턴(원본 토글 후 복원)으로 교체한다.

- [ ] **Step 4: supabase/config.toml 변경 확인**

Run: `grep -A1 '\[db.migrations\]' supabase/config.toml | grep enabled`
Expected: `enabled = false`

- [ ] **Step 5: 커밋**

```bash
git add -f scripts/setup-test-db.sh package.json supabase/config.toml supabase/.gitignore
git commit -m "chore: 로컬 test DB 셋업 스크립트 및 supabase 마이그레이션 비활성화"
```

> `supabase/`가 부분 gitignore일 수 있어 `-f`로 강제 추가. `git status`로 config.toml이 staged 됐는지 확인.

---

## Task 12: Playwright config + 앱 부팅 smoke

**Files:**
- Create: `playwright.config.ts`
- Create: `tests/e2e/app-boot.spec.ts`
- Modify: `package.json` (scripts)

- [ ] **Step 1: playwright.config.ts 작성**

```ts
// playwright.config.ts
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env['CI'],
  retries: process.env['CI'] ? 1 : 0,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'pnpm dev',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env['CI'],
    timeout: 120_000,
  },
});
```

- [ ] **Step 2: app-boot smoke 작성**

```ts
// tests/e2e/app-boot.spec.ts
import { expect, test } from '@playwright/test';

test('admin 로그인 페이지가 렌더된다', async ({ page }) => {
  const res = await page.goto('/admin/login');
  expect(res?.ok()).toBeTruthy();
  // 로그인 폼의 핵심 요소가 보이는지 (이메일/비밀번호 입력)
  await expect(page.locator('input[type="email"], input[name="email"]')).toBeVisible();
});

test('health RPC가 ok를 반환한다', async ({ request }) => {
  const res = await request.post('/api/rpc/health/check', {
    headers: { 'content-type': 'application/json' },
    data: { json: null },
  });
  expect(res.ok()).toBeTruthy();
  const body = await res.json();
  // RPC 직렬화: { json: { ok: true, now } }
  expect(body?.json?.ok ?? body?.ok).toBe(true);
});
```

> 로그인 페이지 셀렉터는 실행 중 `npx playwright codegen localhost:3000/admin/login` 또는 첫 실패 시 실제 DOM을 확인해 `input[type="email"]` 등으로 보정한다. health RPC 응답 형식은 Task 5 Step 4에서 확인한 실제 형식에 맞춘다.

- [ ] **Step 3: package.json scripts 추가**

`package.json`의 `scripts`에 추가:
```json
    "test:e2e": "playwright test",
```

- [ ] **Step 4: 로컬 e2e 실행**

Run (test DB 떠 있는 상태): `pnpm test:e2e`
Expected: 2 passed (app-boot 2개). 로그인 셀렉터 불일치 시 DOM 확인 후 보정.

- [ ] **Step 5: 커밋**

```bash
git add playwright.config.ts tests/e2e/app-boot.spec.ts package.json
git commit -m "test: Playwright 설정 및 앱 부팅 smoke 추가"
```

---

## Task 13: CI workflow

**Files:**
- Create: `.github/workflows/ci.yml`

- [ ] **Step 1: ci.yml 작성**

```yaml
# .github/workflows/ci.yml
name: CI
on:
  push:
    branches: [main]
  pull_request:

jobs:
  verify:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm lint
      - run: pnpm exec tsc --noEmit
      - run: pnpm test

  e2e:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - uses: supabase/setup-cli@v1
        with:
          version: latest
      - run: pnpm db:setup-test
      - run: pnpm exec playwright install --with-deps chromium
      - name: Run e2e
        env:
          DATABASE_URL: postgresql://postgres:postgres@127.0.0.1:54322/postgres
          NEXT_PUBLIC_SUPABASE_URL: http://127.0.0.1:54321
        run: pnpm test:e2e
```

> e2e job의 env(NEXT_PUBLIC_SUPABASE_ANON_KEY 등)는 `supabase status`가 출력하는 로컬 키로 보강 필요. 실제 secret이 아닌 로컬 기본값이므로 CI에서 `supabase status -o env`로 추출해 주입하는 step을 첫 e2e 안정화 시 추가한다.

- [ ] **Step 2: YAML 문법 검증**

Run: `pnpm exec --silent node -e "require('fs').readFileSync('.github/workflows/ci.yml','utf8')" && echo OK`
Expected: `OK` (파일 읽힘 — 문법은 push 후 GitHub Actions에서 최종 검증)

- [ ] **Step 3: 커밋**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: lint/typecheck/test/e2e 워크플로우 추가"
```

---

## Task 14: 최종 검증 + PR

- [ ] **Step 1: 전체 게이트 통과 확인**

Run:
```bash
pnpm lint && pnpm exec tsc --noEmit && pnpm test
```
Expected: 모두 통과, 신규 실패 0

- [ ] **Step 2: health end-to-end 최종 확인**

Run (dev 서버 + test DB): `pnpm test:e2e`
Expected: app-boot 2 passed

- [ ] **Step 3: PR 생성**

```bash
git push -u origin refactor/orpc-feature-migration
gh pr create --title "refactor: oRPC 인프라 골격 PR1" --body "spec: docs/superpowers/specs/2026-06-05-orpc-feature-migration-design.md

oRPC 코어(context/orpc/router/handler/client) + RPC·OpenAPI 라우트 + RSC 직접호출 + ESLint feature 격리 + vitest 확장 + 로컬 test DB 스크립트 + CI. health.check로 end-to-end 검증."
```

---

## Self-Review 체크리스트 (실행자가 PR 전 확인)

- [ ] oRPC procedure가 `.input()`/`.output()` 규율을 지키는가 (health는 output만, input 없음 — 정상)
- [ ] RSC는 `$client`(createRouterClient), 브라우저는 RPCLink — 자기 RPC HTTP 왕복 없는가
- [ ] `DATABASE_URL`을 로컬로 명시하지 않은 drizzle 명령이 없는가 (prod 보호)
- [ ] feature 격리 ESLint 룰이 자기 feature 상대경로는 막지 않는가
- [ ] 신규 vitest 실패 0, 기존 스위트 회귀 0
