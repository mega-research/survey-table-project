import { createRouterClient } from '@orpc/server';
import * as z from 'zod';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ORPCContext } from '@/server/context';
import type { UserStatus, UserType } from '@/shared/contracts/auth';
import { assertSurveyAccess, authed, scoped } from '@/server/orpc';

afterEach(() => vi.unstubAllEnvs());

function ctx(
  userId: string | null,
  status: UserStatus = 'active',
  userType: UserType = 'internal',
): ORPCContext {
  return {
    db: {} as never,
    user: userId
      ? { id: userId, email: 'x@y.z', name: '테스트', status, isSuperadmin: false, userType }
      : null,
  };
}

const echo = scoped.input(z.object({ surveyId: z.string() })).handler(({ context, input }) => {
  assertSurveyAccess(context.user, input.surveyId);
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

/**
 * 계정 유형 게이트 — guest/fieldwork 계정은 내부 표면(authed)에 들어오지 못한다.
 *
 * 티켓 03 이 사용자 관리에서 guest 유형 계정을 발급할 수 있게 만들었으므로, 그 계정이
 * 내부 표면에 들어오지 못하게 하는 서버 판정을 함께 둔다. 유형별 라우팅과 각 콘솔 화면은
 * 티켓 05·22·25 소관이고, scoped 는 게스트에게 열어줄 표면이라 유형으로 막지 않는다.
 */
describe('계정 유형 게이트', () => {
  it.each(['guest', 'fieldwork'] as const)('%s 유형 계정은 authed 에서 FORBIDDEN', async (userType) => {
    const client = createRouterClient({ adminOnly }, { context: ctx('u-1', 'active', userType) });
    await expect(client.adminOnly()).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('scoped 베이스 자체는 유형으로 막지 않는다 (게스트·실사 콘솔이 열릴 축)', async () => {
    // 베이스는 통과시킨다 — 티켓 22·25 의 콘솔이 이 축으로 열린다.
    const passthrough = scoped.handler(() => ({ ok: true }));
    const client = createRouterClient({ passthrough }, { context: ctx('u-1', 'active', 'guest') });
    await expect(client.passthrough()).resolves.toEqual({ ok: true });
  });

  it.each(['guest', 'fieldwork'] as const)(
    '%s 유형은 설문 일치 강제에서 막힌다 (부여 모델이 아직 없다)',
    async (userType) => {
      // 베이스를 통과하는 것과 임의 설문에 닿아도 되는 것은 다른 이야기다. 이 유형들에는
      // 아직 설문 부여 모델이 없으므로(티켓 21·24) assertSurveyAccess 가 기본 거부한다.
      const client = createRouterClient({ echo }, { context: ctx('u-1', 'active', userType) });
      await expect(client.echo({ surveyId: 's1' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    },
  );
});
