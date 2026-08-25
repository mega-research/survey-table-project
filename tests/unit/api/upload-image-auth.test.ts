import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

const { authState } = vi.hoisted(() => ({
  authState: { user: null as null | { id: string } },
}));

vi.mock('@/lib/auth', () => ({
  requireAuth: vi.fn(async () => {
    if (!authState.user) throw new Error('인증이 필요합니다.');
    return {
      id: authState.user.id,
      email: 'a@b.com',
      name: '테스트',
      status: 'active',
      isSuperadmin: false,
    };
  }),
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

describe('POST /api/upload/image requires auth', () => {
  beforeEach(() => {
    authState.user = null;
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('returns 401 without auth', async () => {
    const response = await POST(buildRequest() as never);
    expect(response.status).toBe(401);
  });

  it('게스트도 본문 이미지 업로드는 통과한다 - 401/403 이 아니다', async () => {
    authState.user = { id: 'guest-1' };
    vi.stubEnv('GUEST_SURVEY_GRANTS', 'guest-1:survey-a');

    const response = await POST(buildRequest() as never);
    expect([401, 403]).not.toContain(response.status);
  });

  it('access 로그에 행위자(userId·role)가 바인딩된다', async () => {
    authState.user = { id: 'guest-1' };
    vi.stubEnv('GUEST_SURVEY_GRANTS', 'guest-1:survey-a');
    captured.contexts.length = 0;

    await POST(buildRequest() as never);

    // 래퍼의 access 로그 시점(ctx.log 접근)에 병합된 컨텍스트가 캡처된다
    const last = captured.contexts[captured.contexts.length - 1];
    expect(last).toBeDefined();
    expect(last?.['userId']).toBe('guest-1');
    expect(last?.['role']).toBe('guest');
  });
});
