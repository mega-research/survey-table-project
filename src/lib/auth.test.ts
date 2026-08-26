/**
 * REST·RSC 인증 가드의 계정 유형 축 (역할 모델 v2 티켓 05).
 *
 * oRPC 쪽 음성 테스트(server/orpc-account-type.test.ts)의 짝이다. 내부 표면은 procedure 만
 * 있는 게 아니라 export·업로드 같은 REST 라우트로도 열려 있어서, 그쪽 문이 유형을 안 보면
 * 계정 발급이 곧 PII 반출 경로가 된다. 두 문의 정책이 같은지를 여기서 고정한다.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AuthUser, UserStatus, UserType } from '@/shared/contracts/auth';
import { userTypeValues } from '@/shared/contracts/auth';

const { readSessionUser } = vi.hoisted(() => ({ readSessionUser: vi.fn() }));

vi.mock('@/lib/auth/session', () => ({ readSessionUser }));
vi.mock('next/headers', () => ({ headers: () => Promise.resolve(new Headers()) }));

import { getCurrentUser, requireActiveAccount, requireAuth } from './auth';

function user(userType: UserType, status: UserStatus = 'active'): AuthUser {
  return { id: `user-${userType}`, email: 'x@y.z', name: '테스트', status, isSuperadmin: false, userType };
}

const NON_INTERNAL = userTypeValues.filter((t) => t !== 'internal');

beforeEach(() => vi.clearAllMocks());

describe('requireAuth — 내부 전용 REST 표면 (음성)', () => {
  it.each(NON_INTERNAL)('%s 계정은 통과하지 못한다', async (userType) => {
    // export·업로드가 이 문을 지난다. 유형을 안 보면 발급한 게스트가 응답 PII 를 내려받는다.
    readSessionUser.mockResolvedValue(user(userType));
    await expect(requireAuth()).rejects.toThrow('인증이 필요합니다.');
  });

  it.each(['suspended', 'departed'] as const)('%s 내부 계정도 통과하지 못한다', async (status) => {
    readSessionUser.mockResolvedValue(user('internal', status));
    await expect(requireAuth()).rejects.toThrow();
  });

  it('미인증도 통과하지 못한다', async () => {
    readSessionUser.mockResolvedValue(null);
    await expect(requireAuth()).rejects.toThrow();
  });

  it('active 내부 계정만 통과한다', async () => {
    readSessionUser.mockResolvedValue(user('internal'));
    await expect(requireAuth()).resolves.toMatchObject({ userType: 'internal' });
  });
});

describe('requireActiveAccount — 자기 계정 REST 표면 (아바타 업로드)', () => {
  it.each(userTypeValues)('%s 계정도 통과한다', async (userType) => {
    // oRPC account 베이스와 같은 정책이라야 한다 — 한쪽만 열면 화면과 업로드가 갈린다.
    readSessionUser.mockResolvedValue(user(userType));
    await expect(requireActiveAccount()).resolves.toMatchObject({ userType });
  });

  it.each(['suspended', 'departed'] as const)('%s 계정은 유형과 무관하게 막힌다', async (status) => {
    readSessionUser.mockResolvedValue(user('guest', status));
    await expect(requireActiveAccount()).rejects.toThrow('인증이 필요합니다.');
  });

  it('미인증은 막힌다', async () => {
    readSessionUser.mockResolvedValue(null);
    await expect(requireActiveAccount()).rejects.toThrow();
  });
});

describe('getCurrentUser — 가드가 아니다', () => {
  it('비활성·비내부 계정도 그대로 돌려준다 (판정은 호출측 몫)', async () => {
    readSessionUser.mockResolvedValue(user('guest', 'suspended'));
    await expect(getCurrentUser()).resolves.toMatchObject({ userType: 'guest' });
  });
});
