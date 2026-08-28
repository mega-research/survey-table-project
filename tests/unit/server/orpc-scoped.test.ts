import { createRouterClient } from '@orpc/server';
import { describe, expect, it } from 'vitest';

import type { ORPCContext } from '@/server/context';
import type { UserStatus, UserType } from '@/shared/contracts/auth';
import { authed, scoped } from '@/server/orpc';

/**
 * scoped/authed 베이스의 인증·상태·유형 게이트.
 *
 * 설문 접근 판정 자체는 베이스가 아니라 handler 첫 줄의 관문이 한다 —
 * assertScopedSurveyCapabilityRpc 는 src/server/rpc-survey-access.test.ts,
 * capability 매트릭스는 src/server/survey-access.test.ts 가 검증한다(티켓 10·21).
 */

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

const echo = scoped.handler(() => ({ ok: true }));

describe('scoped 베이스', () => {
  it('미인증은 UNAUTHORIZED', async () => {
    const client = createRouterClient({ echo }, { context: ctx(null) });
    await expect(client.echo()).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
    });
  });

  it.each(['pending', 'rejected', 'suspended', 'departed'] as const)(
    '%s 계정은 FORBIDDEN',
    async (status) => {
      const client = createRouterClient({ echo }, { context: ctx('user-1', status) });
      await expect(client.echo()).rejects.toMatchObject({
        code: 'FORBIDDEN',
      });
    },
  );

  it('active 계정은 베이스를 통과한다 (설문 접근은 handler 관문 몫)', async () => {
    const client = createRouterClient({ echo }, { context: ctx('admin-1') });
    await expect(client.echo()).resolves.toEqual({ ok: true });
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

  it('게스트 계정은 admin 전용 표면에서 FORBIDDEN', async () => {
    const client = createRouterClient(
      { adminOnly },
      { context: ctx('guest-1', 'active', 'guest') },
    );
    await expect(client.adminOnly()).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});

/**
 * 계정 유형 게이트 — guest/fieldwork 계정은 내부 표면(authed)에 들어오지 못한다.
 *
 * 티켓 03 이 사용자 관리에서 guest 유형 계정을 발급할 수 있게 만들었으므로, 그 계정이
 * 내부 표면에 들어오지 못하게 하는 서버 판정을 함께 둔다. 유형별 라우팅과 각 콘솔 화면은
 * 티켓 05·22·25 소관이고, scoped 는 게스트에게 열어줄 표면이라 유형으로 막지 않는다 —
 * 유형별 설문 접근(부여 모델 전 기본 거부)은 capability 코어의 계정 유형 게이트가 정한다.
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
});
