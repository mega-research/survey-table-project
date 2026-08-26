import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * admin 레이아웃은 2단 게이트의 두 번째 단이다 — proxy 가 통과시킨 쿠키의 유효성과
 * 계정 상태(active), 게스트 경로 제한을 서버에서 다시 본다.
 */
// 실제 Headers 를 쓴다 — Map 은 부재 키에 undefined 를 돌려줘서 `get(x) !== null` 판정이
// 뒤집힌다(prefetch 오탐). 게이트가 Headers 의미론에 기대므로 더미도 Headers 여야 한다.
const { readSessionUser, redirect, requestHeaders } = vi.hoisted(() => ({
  readSessionUser: vi.fn(),
  redirect: vi.fn((to: string) => {
    throw new Error(`REDIRECT:${to}`);
  }),
  requestHeaders: new Headers(),
}));

vi.mock('@/lib/auth/session', () => ({ readSessionUser }));
vi.mock('next/navigation', () => ({ redirect }));
vi.mock('next/headers', () => ({ headers: async () => requestHeaders }));
vi.mock('@/components/providers/query-provider', () => ({
  QueryProvider: ({ children }: { children: React.ReactNode }) => children,
}));

import AdminLayout from '@/app/admin/layout';

const ACTIVE = {
  id: 'admin-1',
  email: 'a@b.com',
  name: '관리자',
  status: 'active' as const,
  isSuperadmin: false,
};

function resetHeaders() {
  for (const key of [...requestHeaders.keys()]) requestHeaders.delete(key);
}

function render(pathname: string) {
  resetHeaders();
  if (pathname !== '') requestHeaders.set('x-pathname', pathname);
  return AdminLayout({ children: 'PAGE' as unknown as React.ReactNode });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});

describe('AdminLayout 재검증', () => {
  it('세션이 없으면 원래 목적지를 실어 로그인으로 보낸다 — 쿠키만 있고 무효한 경우', async () => {
    readSessionUser.mockResolvedValue(null);
    await expect(render('/admin/surveys')).rejects.toThrow(
      'REDIRECT:/admin/login?redirect=%2Fadmin%2Fsurveys',
    );
  });

  it.each(['pending', 'rejected', 'suspended', 'departed'] as const)(
    '%s 계정은 로그인으로 되돌린다',
    async (status) => {
      readSessionUser.mockResolvedValue({ ...ACTIVE, status });
      await expect(render('/admin/surveys')).rejects.toThrow('REDIRECT:/admin/login');
    },
  );

  it('active 계정은 통과한다', async () => {
    readSessionUser.mockResolvedValue(ACTIVE);
    await expect(render('/admin/surveys')).resolves.toBeDefined();
    expect(redirect).not.toHaveBeenCalled();
  });

  it('로그인 페이지는 세션을 보지 않는다 — 미인증도 폼을 봐야 한다', async () => {
    await expect(render('/admin/login')).resolves.toBeDefined();
    expect(readSessionUser).not.toHaveBeenCalled();
  });

  it('게스트가 grant 밖 경로에 오면 원래 목적지를 실어 강제 로그아웃으로 보낸다', async () => {
    vi.stubEnv('GUEST_SURVEY_GRANTS', 'admin-1:survey-a');
    readSessionUser.mockResolvedValue(ACTIVE);
    await expect(render('/admin/billing/mail-cost')).rejects.toThrow(
      'REDIRECT:/admin/logout?redirect=%2Fadmin%2Fbilling%2Fmail-cost',
    );
  });

  it('prefetch 는 로그아웃 라우트로 보내지 않는다 — 몰래 세션이 지워지는 사고 방지', async () => {
    vi.stubEnv('GUEST_SURVEY_GRANTS', 'admin-1:survey-a');
    readSessionUser.mockResolvedValue(ACTIVE);
    resetHeaders();
    requestHeaders.set('x-pathname', '/admin/billing/mail-cost');
    requestHeaders.set('next-router-prefetch', '1');
    await expect(
      AdminLayout({ children: 'PAGE' as unknown as React.ReactNode }),
    ).rejects.toThrow('REDIRECT:/admin/login?redirect=%2Fadmin%2Fbilling%2Fmail-cost');
  });

  it('게스트가 grant 설문 안의 차단 화면에 오면 그 설문 overview 로 되돌린다', async () => {
    vi.stubEnv('GUEST_SURVEY_GRANTS', 'admin-1:survey-a');
    readSessionUser.mockResolvedValue(ACTIVE);
    await expect(render('/admin/surveys/survey-a/operations/quota')).rejects.toThrow(
      'REDIRECT:/admin/surveys/survey-a/operations/overview',
    );
  });

  it('게스트의 grant 설문 콘솔은 통과한다', async () => {
    vi.stubEnv('GUEST_SURVEY_GRANTS', 'admin-1:survey-a');
    readSessionUser.mockResolvedValue(ACTIVE);
    await expect(
      render('/admin/surveys/survey-a/operations/contacts'),
    ).resolves.toBeDefined();
  });
});
