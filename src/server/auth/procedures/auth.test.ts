import { createRouterClient } from '@orpc/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ORPCContext } from '@/server/context';
import type { UserStatus } from '@/shared/contracts/auth';

vi.mock('../services/auth', () => ({
  updatePassword: vi.fn(),
}));

import * as svc from '../services/auth';
import { auth } from './auth';

const HEADERS = new Headers({ cookie: 'better-auth.session_token=t' });

function authedContext(status: UserStatus = 'active'): ORPCContext {
  return {
    db: {} as never,
    user: { id: 'admin-1', email: 'a@b.com', name: '관리자', status, isSuperadmin: false },
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
