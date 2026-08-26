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

async function loadSuperadminGuard() {
  const mod = await import('@/lib/auth/require-admin-page');
  return mod.requireSuperadminPage;
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

/**
 * requireSuperadminPage 는 전역 관리 화면(사용자 관리 등)에 oRPC superadmin 베이스와
 * 같은 판정을 적용한다 — 페이지만 열리고 데이터는 못 받는 어긋남을 막는다.
 */
describe('requireSuperadminPage', () => {
  beforeEach(() => {
    vi.resetModules();
    notFound.mockClear();
    requireAuth.mockReset();
  });

  it('active 슈퍼어드민은 통과한다', async () => {
    requireAuth.mockResolvedValue({ id: 'su-1', isSuperadmin: true });

    const requireSuperadminPage = await loadSuperadminGuard();
    await expect(requireSuperadminPage()).resolves.toEqual({ id: 'su-1', isSuperadmin: true });
    expect(notFound).not.toHaveBeenCalled();
  });

  it('슈퍼어드민이 아닌 내부 계정은 notFound 로 막는다', async () => {
    requireAuth.mockResolvedValue({ id: 'user-1', isSuperadmin: false });

    const requireSuperadminPage = await loadSuperadminGuard();
    await expect(requireSuperadminPage()).rejects.toThrow('NEXT_NOT_FOUND');
    expect(notFound).toHaveBeenCalledOnce();
  });

  it('게스트는 슈퍼어드민 플래그가 있어도 막는다', async () => {
    vi.stubEnv('GUEST_SURVEY_GRANTS', 'guest-1:survey-a');
    requireAuth.mockResolvedValue({ id: 'guest-1', isSuperadmin: true });

    const requireSuperadminPage = await loadSuperadminGuard();
    await expect(requireSuperadminPage()).rejects.toThrow('NEXT_NOT_FOUND');
    expect(notFound).toHaveBeenCalledOnce();
  });
});
