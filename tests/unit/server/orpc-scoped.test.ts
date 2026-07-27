import { createRouterClient } from '@orpc/server';
import * as z from 'zod';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ORPCContext } from '@/server/context';
import { assertSurveyAccess, scoped } from '@/server/orpc';

afterEach(() => vi.unstubAllEnvs());

function ctx(userId: string | null): ORPCContext {
  return {
    db: {} as never,
    supabase: {} as never,
    user: userId ? ({ id: userId, email: 'x@y.z' } as never) : null,
  };
}

const echo = scoped
  .input(z.object({ surveyId: z.string() }))
  .handler(({ context, input }) => {
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

  it('allowlist 밖 + grant 없음은 FORBIDDEN', async () => {
    vi.stubEnv('ADMIN_USER_IDS', 'admin-1');
    const client = createRouterClient({ echo }, { context: ctx('nobody') });
    await expect(client.echo({ surveyId: 's1' })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  });

  it('admin 은 어느 설문이든 통과', async () => {
    vi.stubEnv('ADMIN_USER_IDS', 'admin-1');
    const client = createRouterClient({ echo }, { context: ctx('admin-1') });
    await expect(client.echo({ surveyId: 'any' })).resolves.toEqual({ ok: true });
  });

  it('게스트는 grant 설문만 통과, 다른 설문은 FORBIDDEN', async () => {
    vi.stubEnv('ADMIN_USER_IDS', 'admin-1');
    vi.stubEnv('GUEST_SURVEY_GRANTS', 'guest-1:s1');
    const client = createRouterClient({ echo }, { context: ctx('guest-1') });
    await expect(client.echo({ surveyId: 's1' })).resolves.toEqual({ ok: true });
    await expect(client.echo({ surveyId: 's2' })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  });

  it('allowlist 미설정 fail-open + grant 보유 게스트가 타 설문 호출 시 FORBIDDEN', async () => {
    vi.stubEnv('GUEST_SURVEY_GRANTS', 'guest-1:s1');
    const client = createRouterClient({ echo }, { context: ctx('guest-1') });
    await expect(client.echo({ surveyId: 's1' })).resolves.toEqual({ ok: true });
    await expect(client.echo({ surveyId: 's2' })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  });
});
