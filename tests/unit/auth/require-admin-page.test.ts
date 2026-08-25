import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * requireAdminPage 는 admin 전용 RSC 페이지가 authed procedure 와 같은 판정을 받게 하는 가드다.
 * proxy 는 세션 쿠키만, 레이아웃은 세션·계정 상태까지만 보므로, 복호화 응답을 렌더하는
 * analytics 페이지가 게스트에게 GET 만으로 열리는 것을 여기서 막는다.
 */

const notFound = vi.fn(() => {
  throw new Error('NEXT_NOT_FOUND');
});
const requireAuth = vi.fn();

vi.mock('next/navigation', () => ({ notFound }));
vi.mock('@/lib/auth', () => ({ requireAuth }));

async function loadGuard() {
  const mod = await import('@/lib/auth/require-admin-page');
  return mod.requireAdminPage;
}

describe('requireAdminPage', () => {
  beforeEach(() => {
    vi.resetModules();
    notFound.mockClear();
    requireAuth.mockReset();
  });

  afterEach(() => vi.unstubAllEnvs());

  it('게스트가 아닌 active 계정은 통과한다', async () => {
    requireAuth.mockResolvedValue({ id: 'admin-2' });

    const requireAdminPage = await loadGuard();
    await expect(requireAdminPage()).resolves.toEqual({ id: 'admin-2' });
    expect(notFound).not.toHaveBeenCalled();
  });

  it('게스트 grant 보유 세션은 notFound 로 막는다', async () => {
    vi.stubEnv('GUEST_SURVEY_GRANTS', 'guest-1:survey-a');
    requireAuth.mockResolvedValue({ id: 'guest-1' });

    const requireAdminPage = await loadGuard();
    await expect(requireAdminPage()).rejects.toThrow('NEXT_NOT_FOUND');
    expect(notFound).toHaveBeenCalledOnce();
  });

  it('미인증·비활성 계정은 requireAuth 가 먼저 막는다', async () => {
    requireAuth.mockRejectedValue(new Error('인증이 필요합니다.'));

    const requireAdminPage = await loadGuard();
    await expect(requireAdminPage()).rejects.toThrow('인증이 필요합니다.');
    expect(notFound).not.toHaveBeenCalled();
  });
});
