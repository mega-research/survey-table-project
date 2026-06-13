import { createRouterClient } from '@orpc/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ORPCContext } from '@/server/context';
import { authed, pub } from '@/server/orpc';
import { resetAdminAllowlistWarningForTest } from '@/lib/auth/admin-allowlist';

const ENV_KEY = 'ADMIN_USER_IDS';

// authed 가드만 검증하기 위한 최소 procedure. 통과하면 user.id 를 그대로 반환한다.
const whoami = authed.handler(({ context }) => context.user.id);
// pub 가드는 allowlist 영향이 없어야 한다.
const ping = pub.handler(() => 'pong');

function authedContext(userId: string | null): ORPCContext {
  return {
    db: {} as never,
    supabase: { tag: 'test-supabase' } as never,
    user: userId === null ? null : { id: userId, email: null },
    headers: new Headers(),
  };
}

describe('authed allowlist 런타임 가드', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    resetAdminAllowlistWarningForTest();
    delete process.env[ENV_KEY];
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
    delete process.env[ENV_KEY];
  });

  it('세션이 없으면 UNAUTHORIZED 를 던진다', async () => {
    const client = createRouterClient({ whoami }, { context: authedContext(null) });
    await expect(client.whoami()).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });

  it('ADMIN_USER_IDS 미설정이면 fail-open 으로 통과한다', async () => {
    const client = createRouterClient({ whoami }, { context: authedContext('user-x') });
    await expect(client.whoami()).resolves.toBe('user-x');
  });

  it('allowlist 에 없는 user.id 는 FORBIDDEN 으로 차단한다', async () => {
    process.env[ENV_KEY] = 'admin-1,admin-2';
    const client = createRouterClient({ whoami }, { context: authedContext('intruder') });
    await expect(client.whoami()).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('allowlist 에 있는 user.id 는 통과한다', async () => {
    process.env[ENV_KEY] = 'admin-1,admin-2';
    const client = createRouterClient({ whoami }, { context: authedContext('admin-2') });
    await expect(client.whoami()).resolves.toBe('admin-2');
  });

  it('pub procedure 는 allowlist 가드 영향을 받지 않는다', async () => {
    process.env[ENV_KEY] = 'admin-1';
    // user 가 allowlist 에 없어도 pub 은 통과해야 한다.
    const client = createRouterClient({ ping }, { context: authedContext('intruder') });
    await expect(client.ping()).resolves.toBe('pong');
  });
});
