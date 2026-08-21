import { createRouterClient } from '@orpc/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ORPCContext } from '@/server/context';

vi.mock('../services/auth.service', () => ({
  getUser: vi.fn(),
  updatePassword: vi.fn(),
}));

import * as svc from '../services/auth.service';
import { auth } from './auth';

function authedContext(): ORPCContext {
  return {
    db: {} as never,
    supabase: { tag: 'authed-supabase' } as never,
    user: { id: 'admin-1', email: 'a@b.com' },
  };
}

function anonContext(): ORPCContext {
  return {
    db: {} as never,
    supabase: { tag: 'anon-supabase' } as never,
    user: null,
  };
}

describe('auth procedures', () => {
  beforeEach(() => vi.clearAllMocks());

  it('getUser(pub)는 익명 컨텍스트에서도 service.getUser 결과(null)를 반환한다', async () => {
    vi.mocked(svc.getUser).mockResolvedValue(null);
    const client = createRouterClient({ auth }, { context: anonContext() });
    const res = await client.auth.getUser();
    expect(svc.getUser).toHaveBeenCalledOnce();
    expect(res).toBeNull();
  });

  it('getUser는 인증 사용자를 그대로 반환한다', async () => {
    vi.mocked(svc.getUser).mockResolvedValue({ id: 'admin-1', email: 'a@b.com' } as never);
    const client = createRouterClient({ auth }, { context: authedContext() });
    const res = await client.auth.getUser();
    expect(res?.id).toBe('admin-1');
  });

  it('updatePassword는 입력과 context(supabase, user)를 service에 위임한다', async () => {
    vi.mocked(svc.updatePassword).mockResolvedValue({ success: true } as never);
    const ctx = authedContext();
    const client = createRouterClient({ auth }, { context: ctx });
    const input = {
      currentPassword: 'old-pw',
      newPassword: 'new-pw-1',
      confirmPassword: 'new-pw-1',
    };
    const res = await client.auth.updatePassword(input);
    expect(svc.updatePassword).toHaveBeenCalledWith(ctx.supabase, ctx.user, input);
    expect(res).toEqual({ success: true });
  });

  it('updatePassword는 service의 에러 메시지 반환을 통과시킨다', async () => {
    vi.mocked(svc.updatePassword).mockResolvedValue({ error: '현재 비밀번호가 올바르지 않습니다.' } as never);
    const client = createRouterClient({ auth }, { context: authedContext() });
    const res = await client.auth.updatePassword({
      currentPassword: 'wrong',
      newPassword: 'new-pw-1',
      confirmPassword: 'new-pw-1',
    });
    expect(res).toMatchObject({ error: '현재 비밀번호가 올바르지 않습니다.' });
  });

  it('인증 없으면 updatePassword가 UNAUTHORIZED로 막힌다', async () => {
    const client = createRouterClient({ auth }, { context: anonContext() });
    await expect(
      client.auth.updatePassword({
        currentPassword: 'x',
        newPassword: 'new-pw-1',
        confirmPassword: 'new-pw-1',
      }),
    ).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    expect(svc.updatePassword).not.toHaveBeenCalled();
  });
});
