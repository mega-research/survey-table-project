import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * requireAuth 의 계정 유형 게이트 (역할 모델 v2 티켓 03).
 *
 * 사용자 관리에서 guest 유형 계정을 발급할 수 있게 되면서, 그 계정이 내부 표면에
 * 들어오지 못하게 막는 축이 하나 더 필요해졌다. requireAuth 는 REST 라우트(export·업로드)와
 * RSC 가드가 함께 쓰는 문이라 oRPC `authed` 와 같은 판정을 유지해야 한다 — 한쪽만 막으면
 * 다른 쪽이 형제 우회 경로가 된다.
 *
 * 유형별 라우팅(로그인 후 게스트 홈·실사 홈)과 각 콘솔 표면은 티켓 05·22·25 소관이다.
 */

const readSessionUser = vi.fn();

vi.mock('next/headers', () => ({ headers: () => Promise.resolve(new Headers()) }));
vi.mock('@/lib/auth/session', () => ({ readSessionUser }));

async function loadRequireAuth() {
  const mod = await import('@/lib/auth');
  return mod.requireAuth;
}

function sessionUser(over: Record<string, unknown> = {}) {
  return {
    id: 'u-1',
    email: 'u@megaresearch.co.kr',
    name: '테스트',
    status: 'active',
    isSuperadmin: false,
    userType: 'internal',
    ...over,
  };
}

beforeEach(() => {
  vi.resetModules();
  readSessionUser.mockReset();
});

describe('requireAuth 계정 유형 게이트', () => {
  it('내부 active 계정은 통과한다', async () => {
    readSessionUser.mockResolvedValue(sessionUser());
    const requireAuth = await loadRequireAuth();
    await expect(requireAuth()).resolves.toMatchObject({ id: 'u-1' });
  });

  it.each(['guest', 'fieldwork'] as const)('%s 유형 계정은 거부한다', async (userType) => {
    readSessionUser.mockResolvedValue(sessionUser({ userType }));
    const requireAuth = await loadRequireAuth();
    await expect(requireAuth()).rejects.toThrow();
  });

  it('비활성 계정은 유형과 무관하게 거부한다', async () => {
    readSessionUser.mockResolvedValue(sessionUser({ status: 'suspended' }));
    const requireAuth = await loadRequireAuth();
    await expect(requireAuth()).rejects.toThrow();
  });
});
