import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * requireAdminPage 는 admin 전용 RSC 페이지가 authed procedure 와 같은 판정을 받게 하는 가드다.
 * 미들웨어가 세션만 보고 allowlist 를 검사하지 않아, 복호화 응답을 렌더하는 analytics 페이지가
 * allowlist 밖 세션에 GET 만으로 열려 있던 것을 막는다.
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
    delete process.env['ADMIN_USER_IDS'];
  });

  it('allowlist 에 있는 사용자는 통과한다', async () => {
    process.env['ADMIN_USER_IDS'] = 'admin-1,admin-2';
    requireAuth.mockResolvedValue({ id: 'admin-2' });

    const requireAdminPage = await loadGuard();
    await expect(requireAdminPage()).resolves.toEqual({ id: 'admin-2' });
    expect(notFound).not.toHaveBeenCalled();
  });

  it('allowlist 밖 세션은 notFound 로 막는다', async () => {
    process.env['ADMIN_USER_IDS'] = 'admin-1';
    requireAuth.mockResolvedValue({ id: 'someone-else' });

    const requireAdminPage = await loadGuard();
    await expect(requireAdminPage()).rejects.toThrow('NEXT_NOT_FOUND');
    expect(notFound).toHaveBeenCalledOnce();
  });

  it('ADMIN_USER_IDS 미설정이면 fail-open — 기존 배포 동작을 바꾸지 않는다', async () => {
    requireAuth.mockResolvedValue({ id: 'anyone' });

    const requireAdminPage = await loadGuard();
    await expect(requireAdminPage()).resolves.toEqual({ id: 'anyone' });
    expect(notFound).not.toHaveBeenCalled();
  });

  it('미인증이면 requireAuth 가 먼저 막는다', async () => {
    requireAuth.mockRejectedValue(new Error('인증이 필요합니다.'));

    const requireAdminPage = await loadGuard();
    await expect(requireAdminPage()).rejects.toThrow('인증이 필요합니다.');
    expect(notFound).not.toHaveBeenCalled();
  });
});
