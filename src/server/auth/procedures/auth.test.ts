import { createRouterClient } from '@orpc/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ORPCContext } from '@/server/context';
import { type UserStatus, type UserType, userTypeValues } from '@/shared/contracts/auth';

vi.mock('../services/auth', () => ({
  updatePassword: vi.fn(),
  getProfile: vi.fn(),
  updateProfile: vi.fn(),
}));

import { InvalidAvatarUrlError } from '../domain/auth';
import * as svc from '../services/auth';
import { auth } from './auth';

const HEADERS = new Headers({ cookie: 'better-auth.session_token=t' });

function authedContext(status: UserStatus = 'active', userType: UserType = 'internal'): ORPCContext {
  return {
    db: {} as never,
    user: { id: 'admin-1', email: 'a@b.com', name: '관리자', status, isSuperadmin: false, userType },
    headers: HEADERS,
  };
}

function anonContext(): ORPCContext {
  return { db: {} as never, user: null };
}

describe('auth procedures', () => {
  beforeEach(() => vi.clearAllMocks());

  it('getUser(pub)는 익명 컨텍스트에서 null 을 반환한다', async () => {
    const client = createRouterClient({ auth }, { context: anonContext() });
    await expect(client.auth.getUser()).resolves.toBeNull();
  });

  it('getUser 는 컨텍스트의 인증 사용자를 그대로 반환한다', async () => {
    const client = createRouterClient({ auth }, { context: authedContext() });
    const res = await client.auth.getUser();
    expect(res).toMatchObject({ id: 'admin-1', status: 'active', isSuperadmin: false });
  });

  it('updatePassword 는 입력과 context.headers 를 service 에 위임한다', async () => {
    vi.mocked(svc.updatePassword).mockResolvedValue({ success: true });
    const client = createRouterClient({ auth }, { context: authedContext() });
    const input = {
      currentPassword: 'old-pw-12',
      newPassword: 'new-pw-12',
      confirmPassword: 'new-pw-12',
    };
    const res = await client.auth.updatePassword(input);
    expect(svc.updatePassword).toHaveBeenCalledWith(HEADERS, input);
    expect(res).toEqual({ success: true });
  });

  it('updatePassword 는 service 의 에러 메시지 반환을 통과시킨다', async () => {
    vi.mocked(svc.updatePassword).mockResolvedValue({
      error: '현재 비밀번호가 올바르지 않습니다.',
    });
    const client = createRouterClient({ auth }, { context: authedContext() });
    const res = await client.auth.updatePassword({
      currentPassword: 'wrong-pw',
      newPassword: 'new-pw-12',
      confirmPassword: 'new-pw-12',
    });
    expect(res).toMatchObject({ error: '현재 비밀번호가 올바르지 않습니다.' });
  });

  it('인증 없으면 updatePassword 가 UNAUTHORIZED 로 막힌다', async () => {
    const client = createRouterClient({ auth }, { context: anonContext() });
    await expect(
      client.auth.updatePassword({
        currentPassword: 'x',
        newPassword: 'new-pw-12',
        confirmPassword: 'new-pw-12',
      }),
    ).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    expect(svc.updatePassword).not.toHaveBeenCalled();
  });

  it.each(['pending', 'rejected', 'suspended', 'departed'] as const)(
    '%s 계정은 updatePassword 가 FORBIDDEN 으로 막힌다',
    async (status) => {
      const client = createRouterClient({ auth }, { context: authedContext(status) });
      await expect(
        client.auth.updatePassword({
          currentPassword: 'x',
          newPassword: 'new-pw-12',
          confirmPassword: 'new-pw-12',
        }),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
      expect(svc.updatePassword).not.toHaveBeenCalled();
    },
  );
});

const PROFILE = {
  id: '55555555-5555-4555-8555-555555555555',
  name: '김새로',
  email: 'saero.kim@megaresearch.co.kr',
  image: null,
  userType: 'internal' as const,
  jobTitle: '연구원',
  organization: null,
};

describe('프로필 procedure — 세 계정 유형 공통', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(svc.getProfile).mockResolvedValue(PROFILE);
    vi.mocked(svc.updateProfile).mockResolvedValue(PROFILE);
  });

  it.each(userTypeValues)('%s 계정도 자기 프로필을 읽는다', async (userType) => {
    // 내부 전용(authed)에 두면 게스트·실사가 자기 이름조차 볼 수 없다.
    const client = createRouterClient({ auth }, { context: authedContext('active', userType) });
    await expect(client.auth.getProfile()).resolves.toMatchObject({ id: PROFILE.id });
    expect(svc.getProfile).toHaveBeenCalledWith('admin-1');
  });

  it.each(userTypeValues)('%s 계정도 자기 프로필을 수정한다', async (userType) => {
    const client = createRouterClient({ auth }, { context: authedContext('active', userType) });
    await client.auth.updateProfile({ name: '김새로', image: null });
    expect(svc.updateProfile).toHaveBeenCalledWith('admin-1', { name: '김새로', image: null });
  });

  it.each(userTypeValues)('%s 계정도 비밀번호를 바꾼다', async (userType) => {
    vi.mocked(svc.updatePassword).mockResolvedValue({ success: true });
    const client = createRouterClient({ auth }, { context: authedContext('active', userType) });
    await client.auth.updatePassword({
      currentPassword: 'old-pw-12',
      newPassword: 'new-pw-12',
      confirmPassword: 'new-pw-12',
    });
    expect(svc.updatePassword).toHaveBeenCalled();
  });

  it('대상 계정은 입력이 아니라 세션에서 온다 (남의 프로필을 지목할 수 없다)', async () => {
    const client = createRouterClient({ auth }, { context: authedContext() });
    await client.auth.updateProfile({
      name: '김새로',
      image: null,
      // 입력에 없는 키다 — zod 가 떨어뜨리고 service 는 세션 id 만 받는다.
      userId: 'victim',
    } as never);
    expect(svc.updateProfile).toHaveBeenCalledWith('admin-1', { name: '김새로', image: null });
  });

  it('이름은 비울 수 없다', async () => {
    const client = createRouterClient({ auth }, { context: authedContext() });
    await expect(
      client.auth.updateProfile({ name: '   ', image: null }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect(svc.updateProfile).not.toHaveBeenCalled();
  });

  it('우리 것이 아닌 아바타 주소는 BAD_REQUEST 로 바꾼다', async () => {
    vi.mocked(svc.updateProfile).mockRejectedValue(new InvalidAvatarUrlError());
    const client = createRouterClient({ auth }, { context: authedContext() });
    await expect(
      client.auth.updateProfile({ name: '김새로', image: 'https://evil.example/x.png' }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });

  it('미인증은 프로필도 UNAUTHORIZED', async () => {
    const client = createRouterClient({ auth }, { context: anonContext() });
    await expect(client.auth.getProfile()).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });

  it.each(['suspended', 'departed'] as const)('%s 계정은 프로필도 FORBIDDEN', async (status) => {
    const client = createRouterClient({ auth }, { context: authedContext(status) });
    await expect(client.auth.getProfile()).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});
