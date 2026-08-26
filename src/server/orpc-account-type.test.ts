/**
 * 계정 유형 게이트 — 어느 베이스가 어떤 유형을 통과시키는가 (역할 모델 v2 티켓 05).
 *
 * 음성 테스트가 이 파일의 목적이다. guest·fieldwork 계정은 로그인은 되지만 내부 표면
 * (설문·운영·export·업로드)에 닿으면 안 되고, 반대로 자기 계정 표면(프로필)에서는 막히면
 * 안 된다. 두 방향 중 하나만 지키면 계정 발급이 곧 내부 데이터 접근 경로가 되거나,
 * 발급한 계정이 자기 비밀번호조차 못 바꾸는 상태가 된다.
 */
import { createRouterClient } from '@orpc/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { UserStatus, UserType } from '@/shared/contracts/auth';
import { userTypeValues } from '@/shared/contracts/auth';

import type { ORPCContext } from './context';
import { account, authed, scoped, superadmin } from './orpc';

afterEach(() => vi.unstubAllEnvs());

function ctx(
  userType: UserType,
  opts: { status?: UserStatus; isSuperadmin?: boolean } = {},
): ORPCContext {
  const { status = 'active', isSuperadmin = true } = opts;
  return {
    db: {} as never,
    user: { id: `user-${userType}`, email: 'x@y.z', name: '테스트', status, isSuperadmin, userType },
  };
}

const internalOnly = authed.handler(({ context }) => ({ id: context.user.id }));
const superadminOnly = superadmin.handler(({ context }) => ({ id: context.user.id }));
const selfService = account.handler(({ context }) => ({ id: context.user.id }));
const surveyScoped = scoped.handler(({ context }) => ({ id: context.user.id }));

const NON_INTERNAL = userTypeValues.filter((t) => t !== 'internal');

describe('내부 전용 베이스 — guest·fieldwork 차단 (음성)', () => {
  it.each(NON_INTERNAL)('%s 계정은 authed 표면에서 FORBIDDEN', async (userType) => {
    const client = createRouterClient({ internalOnly }, { context: ctx(userType) });
    await expect(client.internalOnly()).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it.each(NON_INTERNAL)(
    '%s 계정은 슈퍼어드민 플래그가 있어도 superadmin 표면에서 FORBIDDEN',
    async (userType) => {
      // 유형 게이트가 슈퍼어드민 플래그보다 먼저다 — 발급 실수로 플래그가 켜져도 새지 않는다.
      const client = createRouterClient({ superadminOnly }, { context: ctx(userType) });
      await expect(client.superadminOnly()).rejects.toMatchObject({ code: 'FORBIDDEN' });
    },
  );

  it('내부 계정은 통과한다 (게이트가 전부를 막는 것이 아니다)', async () => {
    const client = createRouterClient({ internalOnly }, { context: ctx('internal') });
    await expect(client.internalOnly()).resolves.toEqual({ id: 'user-internal' });
  });
});

describe('자기 계정 베이스 — 세 유형 모두 통과', () => {
  it.each(userTypeValues)('%s 계정도 account 표면을 쓴다', async (userType) => {
    // 프로필(이름·아바타·비밀번호)은 세 유형 공통이다. 내부 전용으로 두면 발급한 게스트가
    // 자기 비밀번호조차 못 바꾼다.
    const client = createRouterClient({ selfService }, { context: ctx(userType) });
    await expect(client.selfService()).resolves.toEqual({ id: `user-${userType}` });
  });

  it.each(['suspended', 'departed'] as const)(
    '%s 계정은 유형과 무관하게 FORBIDDEN',
    async (status) => {
      const client = createRouterClient(
        { selfService },
        { context: ctx('guest', { status }) },
      );
      await expect(client.selfService()).rejects.toMatchObject({ code: 'FORBIDDEN' });
    },
  );

  it('미인증은 UNAUTHORIZED', async () => {
    const client = createRouterClient({ selfService }, { context: { db: {} as never, user: null } });
    await expect(client.selfService()).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });
});

describe('설문 스코프 베이스 — 유형으로 막지 않는다', () => {
  it.each(userTypeValues)('%s 계정도 scoped 베이스를 통과한다', async (userType) => {
    // scoped 는 유형이 아니라 설문 일치로 막는다(handler 의 assertSurveyAccess).
    // 게스트 콘솔(티켓 22)·실사 콘솔(티켓 25)이 이 축으로 열린다.
    const client = createRouterClient({ surveyScoped }, { context: ctx(userType) });
    await expect(client.surveyScoped()).resolves.toEqual({ id: `user-${userType}` });
  });
});

describe('설문 단위 env grant 게스트 — 유형 축과 별개로 살아 있다', () => {
  it('grant 보유 내부 계정도 authed 표면에서 FORBIDDEN', async () => {
    // 티켓 21 에서 이 축이 계정 유형으로 합쳐질 때까지 두 판정이 함께 걸린다.
    vi.stubEnv('GUEST_SURVEY_GRANTS', 'user-internal:s1');
    const client = createRouterClient({ internalOnly }, { context: ctx('internal') });
    await expect(client.internalOnly()).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('grant 보유자도 자기 계정 표면은 쓴다', async () => {
    vi.stubEnv('GUEST_SURVEY_GRANTS', 'user-internal:s1');
    const client = createRouterClient({ selfService }, { context: ctx('internal') });
    await expect(client.selfService()).resolves.toEqual({ id: 'user-internal' });
  });
});
