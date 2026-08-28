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
  userType: 'internal' as const,
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

  // 게스트의 경로 화이트리스트·강제 로그아웃 분기는 티켓 21 에서 사라졌다 —
  // 아래 「계정 유형 게이트」가 그 일을 대신한다(자기 홈으로 리다이렉트).
});

describe('AdminLayout 계정 유형 게이트', () => {
  it.each([
    ['guest', '/guest'],
    ['fieldwork', '/fieldwork'],
  ] as const)('%s 계정은 내부 경로에서 자기 홈으로 돌려보낸다', async (userType, home) => {
    // 티켓 03 이 계정 발급을 열었으므로 이 축이 없으면 발급이 곧 내부 표면 접근이 된다.
    readSessionUser.mockResolvedValue({ ...ACTIVE, userType });
    await expect(render('/admin/surveys')).rejects.toThrow('REDIRECT');
    expect(redirect).toHaveBeenCalledWith(home);
  });

  it.each(['guest', 'fieldwork'] as const)(
    '%s 계정도 프로필은 통과한다 (세 유형 공통 화면)',
    async (userType) => {
      readSessionUser.mockResolvedValue({ ...ACTIVE, userType });
      await render('/admin/profile');
      expect(redirect).not.toHaveBeenCalled();
    },
  );

  it('유형이 실려 오지 않으면 내부로 열지 않는다', async () => {
    // readSessionUser 의 안전 기본값과 같은 방향 — 값이 없으면 닫는 쪽으로 접는다.
    readSessionUser.mockResolvedValue({ ...ACTIVE, userType: undefined });
    await expect(render('/admin/surveys')).rejects.toThrow('REDIRECT');
  });
});
