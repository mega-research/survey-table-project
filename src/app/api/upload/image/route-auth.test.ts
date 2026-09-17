import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

const { authState } = vi.hoisted(() => ({
  authState: { user: null as null | { id: string } },
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({
    auth: {
      getUser: vi.fn(async () => ({ data: { user: authState.user }, error: null })),
    },
  })),
}));

// withRouteLogging 의 로그 컨텍스트 캡처 — 403 거부 로그에 행위자가 남는지 검증용.
// 통 mock 은 import 체인 확장에 깨지므로 importOriginal spread 관례를 따른다.
const captured = vi.hoisted(() => ({ contexts: [] as Record<string, unknown>[] }));
vi.mock('@/lib/logger/with-context', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/logger/with-context')>();
  return {
    ...actual,
    withContext: (ctx: Record<string, unknown>) => {
      captured.contexts.push(ctx);
      return actual.withContext(ctx);
    },
  };
});

import { POST } from '@/app/api/upload/image/route';

function buildRequest() {
  const formData = new FormData();
  formData.set('file', new File(['dummy'], 'a.png', { type: 'image/png' }));
  formData.set('kind', 'survey');
  return new Request('http://localhost/api/upload/image', {
    method: 'POST',
    body: formData,
  });
}

describe('POST /api/upload/image requires admin', () => {
  beforeEach(() => {
    authState.user = null;
  });

  afterEach(() => {
    delete process.env['ADMIN_USER_IDS'];
  });

  it('returns 401 without auth', async () => {
    const response = await POST(buildRequest() as never);
    expect(response.status).toBe(401);
  });

  it('returns 403 for authenticated user not in ADMIN_USER_IDS allowlist', async () => {
    authState.user = { id: 'intruder-id' };
    process.env['ADMIN_USER_IDS'] = 'real-admin-id';

    const response = await POST(buildRequest() as never);
    expect(response.status).toBe(403);
  });

  it('403 거부 access 로그에도 행위자(userId·role)가 바인딩된다', async () => {
    authState.user = { id: 'intruder-id' };
    process.env['ADMIN_USER_IDS'] = 'real-admin-id';
    captured.contexts.length = 0;

    const response = await POST(buildRequest() as never);
    expect(response.status).toBe(403);

    // 래퍼의 access 로그 시점(ctx.log 접근)에 병합된 컨텍스트가 캡처된다
    const last = captured.contexts[captured.contexts.length - 1];
    expect(last).toBeDefined();
    expect(last?.['userId']).toBe('intruder-id');
    expect(last?.['role']).toBe('user');
  });
});
