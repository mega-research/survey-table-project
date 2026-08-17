import { beforeEach, describe, expect, it, vi } from 'vitest';

import { logout } from '@/actions/auth-actions';
import { GET } from '@/app/admin/logout/route';

const { getUser, signOut } = vi.hoisted(() => ({
  getUser: vi.fn(),
  signOut: vi.fn(async () => ({ error: null })),
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ auth: { getUser, signOut } }),
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/navigation', () => ({ redirect: vi.fn() }));

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});

describe('GET /admin/logout (게스트 강제 로그아웃)', () => {
  const req = () => new Request('https://example.com/admin/logout');

  it('게스트는 현재 브라우저만 로그아웃(local scope)하고 로그인으로 보낸다', async () => {
    vi.stubEnv('GUEST_SURVEY_GRANTS', 'guest-1:survey-a');
    getUser.mockResolvedValue({ data: { user: { id: 'guest-1' } } });

    const res = await GET(req());

    expect(signOut).toHaveBeenCalledWith({ scope: 'local' });
    expect(res.headers.get('location')).toBe('https://example.com/admin/login');
  });

  it('게스트가 아닌 인증 사용자는 로그아웃 없이 콘솔로 돌려보낸다 - 로그아웃 CSRF 차단', async () => {
    getUser.mockResolvedValue({ data: { user: { id: 'admin-1' } } });

    const res = await GET(req());

    expect(signOut).not.toHaveBeenCalled();
    expect(res.headers.get('location')).toBe('https://example.com/admin/surveys');
  });

  it('미인증 요청은 로그아웃 없이 로그인으로 보낸다', async () => {
    getUser.mockResolvedValue({ data: { user: null } });

    const res = await GET(req());

    expect(signOut).not.toHaveBeenCalled();
    expect(res.headers.get('location')).toBe('https://example.com/admin/login');
  });
});

describe('logout 서버 액션', () => {
  it('local scope 로 로그아웃한다 - 공유 게스트 계정의 타 기기 세션 보존', async () => {
    await logout();
    expect(signOut).toHaveBeenCalledWith({ scope: 'local' });
  });
});
