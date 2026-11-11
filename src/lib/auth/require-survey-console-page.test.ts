import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * requireSurveyConsolePage 는 개인정보 평문을 직접 렌더하는 운영 콘솔 RSC 페이지가
 * scoped procedure 와 같은 판정(canAccessSurvey)을 받게 하는 가드다.
 * 미들웨어는 grant 보유자의 경로만 제한하고, grant 도 없고 ADMIN_USER_IDS 에도 없는 세션은
 * 그대로 통과시킨다 — 그 세션이 주소를 직접 쳐 조사 대상 목록의 평문을 받는 것을 막는다.
 */

const notFound = vi.fn(() => {
  throw new Error('NEXT_NOT_FOUND');
});
const redirect = vi.fn((to: string) => {
  throw new Error(`NEXT_REDIRECT ${to}`);
});
const requireAuth = vi.fn();

vi.mock('next/navigation', () => ({ notFound, redirect }));
vi.mock('next/headers', () => ({
  headers: async () =>
    new Headers({ 'x-request-path': '/admin/surveys/s1/operations/contacts' }),
}));
vi.mock('@/lib/auth', () => ({ requireAuth }));

async function loadGuard() {
  const mod = await import('@/lib/auth/require-survey-console-page');
  return mod.requireSurveyConsolePage;
}

describe('requireSurveyConsolePage', () => {
  beforeEach(() => {
    vi.resetModules();
    notFound.mockClear();
    requireAuth.mockReset();
    delete process.env['ADMIN_USER_IDS'];
    delete process.env['GUEST_SURVEY_GRANTS'];
  });

  it('allowlist 에 있는 관리자는 통과한다', async () => {
    process.env['ADMIN_USER_IDS'] = 'admin-1';
    requireAuth.mockResolvedValue({ id: 'admin-1' });

    const guard = await loadGuard();
    await expect(guard('s1')).resolves.toEqual({ id: 'admin-1' });
    expect(notFound).not.toHaveBeenCalled();
  });

  it('이 설문의 grant 를 가진 게스트는 통과한다', async () => {
    process.env['ADMIN_USER_IDS'] = 'admin-1';
    process.env['GUEST_SURVEY_GRANTS'] = 'guest-1:s1';
    requireAuth.mockResolvedValue({ id: 'guest-1' });

    const guard = await loadGuard();
    await expect(guard('s1')).resolves.toEqual({ id: 'guest-1' });
    expect(notFound).not.toHaveBeenCalled();
  });

  it('grant 도 없고 allowlist 에도 없는 세션은 notFound 로 막는다', async () => {
    process.env['ADMIN_USER_IDS'] = 'admin-1';
    process.env['GUEST_SURVEY_GRANTS'] = 'guest-1:s1';
    requireAuth.mockResolvedValue({ id: 'someone-else' });

    const guard = await loadGuard();
    await expect(guard('s1')).rejects.toThrow('NEXT_NOT_FOUND');
    expect(notFound).toHaveBeenCalledOnce();
  });

  it('다른 설문에만 grant 가 있는 게스트는 막는다', async () => {
    process.env['ADMIN_USER_IDS'] = 'admin-1';
    process.env['GUEST_SURVEY_GRANTS'] = 'guest-1:s2';
    requireAuth.mockResolvedValue({ id: 'guest-1' });

    const guard = await loadGuard();
    await expect(guard('s1')).rejects.toThrow('NEXT_NOT_FOUND');
  });

  it('보기만 하는 게스트는 이 설문의 grant 가 있어도 막는다', async () => {
    // guest9 — guest-grants.ts 의 VIEW_ONLY_GUEST_GRANTS 에 박힌 실제 쌍.
    const GUEST9 = 'c79af8a1-186a-4157-be4c-2bebfbde4a8d';
    const AI_2026_PUBLIC = '253534a5-913a-4891-a019-f9643ccea0a7';
    process.env['ADMIN_USER_IDS'] = 'admin-1';
    process.env['GUEST_SURVEY_GRANTS'] = `${GUEST9}:${AI_2026_PUBLIC}`;
    requireAuth.mockResolvedValue({ id: GUEST9 });

    const guard = await loadGuard();
    await expect(guard(AI_2026_PUBLIC)).rejects.toThrow('NEXT_NOT_FOUND');
  });

  it('ADMIN_USER_IDS 미설정이면 grant 없는 세션은 fail-open — 기존 배포 동작을 바꾸지 않는다', async () => {
    requireAuth.mockResolvedValue({ id: 'anyone' });

    const guard = await loadGuard();
    await expect(guard('s1')).resolves.toEqual({ id: 'anyone' });
    expect(notFound).not.toHaveBeenCalled();
  });

  it('미인증이면 오류 대신 원래 경로를 실어 로그인으로 보낸다', async () => {
    requireAuth.mockRejectedValue(new Error('인증이 필요합니다.'));

    const guard = await loadGuard();
    await expect(guard('s1')).rejects.toThrow(
      `NEXT_REDIRECT /admin/login?redirect=${encodeURIComponent('/admin/surveys/s1/operations/contacts')}`,
    );
    expect(notFound).not.toHaveBeenCalled();
  });
});
