import { createRouterClient } from '@orpc/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ORPCContext } from '@/server/context';
import { superadmin } from '@/server/orpc';
import type { UserStatus } from '@/shared/contracts/auth';

afterEach(() => vi.unstubAllEnvs());

function ctx(
  userId: string | null,
  opts: { status?: UserStatus; isSuperadmin?: boolean } = {},
): ORPCContext {
  const { status = 'active', isSuperadmin = true } = opts;
  return {
    db: {} as never,
    user: userId ? { id: userId, email: 'x@y.z', name: '테스트', status, isSuperadmin } : null,
  };
}

const adminOnly = superadmin.handler(({ context }) => ({ id: context.user.id }));

describe('superadmin 베이스', () => {
  it('미인증은 UNAUTHORIZED', async () => {
    const client = createRouterClient({ adminOnly }, { context: ctx(null) });
    await expect(client.adminOnly()).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });

  it.each(['pending', 'rejected', 'suspended', 'departed'] as const)(
    '%s 슈퍼어드민 계정은 FORBIDDEN',
    async (status) => {
      const client = createRouterClient({ adminOnly }, { context: ctx('su-1', { status }) });
      await expect(client.adminOnly()).rejects.toMatchObject({ code: 'FORBIDDEN' });
    },
  );

  it('슈퍼어드민이 아닌 active 내부 계정은 FORBIDDEN', async () => {
    const client = createRouterClient(
      { adminOnly },
      { context: ctx('user-1', { isSuperadmin: false }) },
    );
    await expect(client.adminOnly()).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('게스트 grant 보유 계정은 슈퍼어드민 플래그가 있어도 FORBIDDEN', async () => {
    vi.stubEnv('GUEST_SURVEY_GRANTS', 'guest-1:s1');
    const client = createRouterClient({ adminOnly }, { context: ctx('guest-1') });
    await expect(client.adminOnly()).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('active 슈퍼어드민은 통과한다', async () => {
    const client = createRouterClient({ adminOnly }, { context: ctx('su-1') });
    await expect(client.adminOnly()).resolves.toEqual({ id: 'su-1' });
  });
});
