import { beforeEach, describe, expect, it, vi } from 'vitest';

import { GET } from '@/app/admin/logout/route';

const { getSession, signOut } = vi.hoisted(() => ({
  getSession: vi.fn(),
  signOut: vi.fn(
    async () =>
      new Response(null, {
        headers: { 'set-cookie': 'better-auth.session_token=; Max-Age=0; Path=/' },
      }),
  ),
}));

vi.mock('@/lib/auth/server', () => ({ auth: { api: { getSession, signOut } } }));

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});

describe('GET /admin/logout (게스트 강제 로그아웃)', () => {
  const req = (search = '') => new Request(`https://example.com/admin/logout${search}`);

  it('게스트는 세션을 끝내고 만료 쿠키와 함께 로그인으로 보낸다', async () => {
    vi.stubEnv('GUEST_SURVEY_GRANTS', 'guest-1:survey-a');
    getSession.mockResolvedValue({ user: { id: 'guest-1' } });

    const res = await GET(req());

    expect(signOut).toHaveBeenCalledOnce();
    expect(res.headers.get('location')).toBe('https://example.com/admin/login');
    expect(res.headers.getSetCookie().join(';')).toContain('Max-Age=0');
  });

  it('redirect·reason 파라미터를 로그인창까지 전달한다 - 재로그인 안내 근거', async () => {
    vi.stubEnv('GUEST_SURVEY_GRANTS', 'guest-1:survey-a');
    getSession.mockResolvedValue({ user: { id: 'guest-1' } });

    const res = await GET(
      req('?redirect=%2Fadmin%2Fsurveys%2Fother%2Foperations%2Foverview&reason=foreign-survey'),
    );

    expect(res.headers.get('location')).toBe(
      'https://example.com/admin/login?redirect=%2Fadmin%2Fsurveys%2Fother%2Foperations%2Foverview&reason=foreign-survey',
    );
  });

  it('내비게이션이 아닌 요청(prefetch 등)은 signOut 없이 로그인으로만 보낸다', async () => {
    vi.stubEnv('GUEST_SURVEY_GRANTS', 'guest-1:survey-a');
    getSession.mockResolvedValue({ user: { id: 'guest-1' } });

    const res = await GET(
      new Request('https://example.com/admin/logout?redirect=%2Fadmin%2Fsurveys', {
        headers: { 'sec-fetch-mode': 'cors' },
      }),
    );

    expect(signOut).not.toHaveBeenCalled();
    expect(res.headers.get('location')).toBe(
      'https://example.com/admin/login?redirect=%2Fadmin%2Fsurveys',
    );
  });

  it('sec-fetch-mode: navigate 는 정상 로그아웃한다', async () => {
    vi.stubEnv('GUEST_SURVEY_GRANTS', 'guest-1:survey-a');
    getSession.mockResolvedValue({ user: { id: 'guest-1' } });

    const res = await GET(
      new Request('https://example.com/admin/logout', {
        headers: { 'sec-fetch-mode': 'navigate' },
      }),
    );

    expect(signOut).toHaveBeenCalledOnce();
    expect(res.headers.get('location')).toBe('https://example.com/admin/login');
  });

  it('내부 절대경로가 아닌 redirect 는 버린다 - open redirect 차단', async () => {
    vi.stubEnv('GUEST_SURVEY_GRANTS', 'guest-1:survey-a');
    getSession.mockResolvedValue({ user: { id: 'guest-1' } });

    for (const bad of ['https://evil.example', '//evil.example', '/\\evil.example']) {
      const res = await GET(req(`?redirect=${encodeURIComponent(bad)}`));
      expect(res.headers.get('location')).toBe('https://example.com/admin/login');
    }
  });

  it('게스트가 아닌 인증 사용자는 로그아웃 없이 콘솔로 돌려보낸다 - 로그아웃 CSRF 차단', async () => {
    getSession.mockResolvedValue({ user: { id: 'admin-1' } });

    const res = await GET(req());

    expect(signOut).not.toHaveBeenCalled();
    expect(res.headers.get('location')).toBe('https://example.com/admin/surveys');
  });

  it('미인증 요청은 로그아웃 없이 로그인으로 보낸다', async () => {
    getSession.mockResolvedValue(null);

    const res = await GET(req());

    expect(signOut).not.toHaveBeenCalled();
    expect(res.headers.get('location')).toBe('https://example.com/admin/login');
  });
});
