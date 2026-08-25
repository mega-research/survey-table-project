import { createRouterClient } from '@orpc/server';
import * as z from 'zod';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ORPCContext } from '@/server/context';
import type { UserStatus } from '@/shared/contracts/auth';
import { assertSurveyAccess, authed, scoped } from '@/server/orpc';

afterEach(() => vi.unstubAllEnvs());

function ctx(userId: string | null, status: UserStatus = 'active'): ORPCContext {
  return {
    db: {} as never,
    user: userId
      ? { id: userId, email: 'x@y.z', name: '테스트', status, isSuperadmin: false }
      : null,
  };
}

const echo = scoped.input(z.object({ surveyId: z.string() })).handler(({ context, input }) => {
  assertSurveyAccess(context.user.id, input.surveyId);
  return { ok: true };
});

describe('scoped 베이스', () => {
  it('미인증은 UNAUTHORIZED', async () => {
    const client = createRouterClient({ echo }, { context: ctx(null) });
    await expect(client.echo({ surveyId: 's1' })).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
    });
  });

  it.each(['pending', 'rejected', 'suspended', 'departed'] as const)(
    '%s 계정은 FORBIDDEN',
    async (status) => {
      const client = createRouterClient({ echo }, { context: ctx('user-1', status) });
      await expect(client.echo({ surveyId: 's1' })).rejects.toMatchObject({
        code: 'FORBIDDEN',
      });
    },
  );

  it('grant 없는 active 계정은 어느 설문이든 통과', async () => {
    const client = createRouterClient({ echo }, { context: ctx('admin-1') });
    await expect(client.echo({ surveyId: 'any' })).resolves.toEqual({ ok: true });
  });

  it('게스트는 grant 설문만 통과, 다른 설문은 FORBIDDEN', async () => {
    vi.stubEnv('GUEST_SURVEY_GRANTS', 'guest-1:s1');
    const client = createRouterClient({ echo }, { context: ctx('guest-1') });
    await expect(client.echo({ surveyId: 's1' })).resolves.toEqual({ ok: true });
    await expect(client.echo({ surveyId: 's2' })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  });
});

const adminOnly = authed.handler(({ context }) => ({ id: context.user.id }));

describe('authed 베이스', () => {
  it('미인증은 UNAUTHORIZED', async () => {
    const client = createRouterClient({ adminOnly }, { context: ctx(null) });
    await expect(client.adminOnly()).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });

  it('active 계정은 통과', async () => {
    const client = createRouterClient({ adminOnly }, { context: ctx('admin-1') });
    await expect(client.adminOnly()).resolves.toEqual({ id: 'admin-1' });
  });

  it.each(['pending', 'rejected', 'suspended', 'departed'] as const)(
    '%s 계정은 FORBIDDEN — 세션 발급 후 상태가 바뀐 경우까지 막는다',
    async (status) => {
      const client = createRouterClient({ adminOnly }, { context: ctx('admin-1', status) });
      await expect(client.adminOnly()).rejects.toMatchObject({ code: 'FORBIDDEN' });
    },
  );

  it('게스트 grant 보유자는 admin 전용 표면에서 FORBIDDEN', async () => {
    vi.stubEnv('GUEST_SURVEY_GRANTS', 'guest-1:s1');
    const client = createRouterClient({ adminOnly }, { context: ctx('guest-1') });
    await expect(client.adminOnly()).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});
