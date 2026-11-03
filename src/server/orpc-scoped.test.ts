import { createRouterClient } from '@orpc/server';
import * as z from 'zod';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ORPCContext } from './context';
import { assertSurveyAccess, assertSurveyWriteAccess, authed, scoped } from './orpc';

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

// 보기만 하는 게스트 grant (guest-grants 의 VIEW_ONLY_GUEST_GRANTS) — guest9 · 2026 AI 공개본
const GUEST9 = 'c79af8a1-186a-4157-be4c-2bebfbde4a8d';
const VIEW_ONLY_SURVEY = '253534a5-913a-4891-a019-f9643ccea0a7';

const write = scoped
  .input(z.object({ surveyId: z.string() }))
  .handler(({ context, input }) => {
    assertSurveyWriteAccess(context.user.id, input.surveyId);
    return { ok: true };
  });

describe('assertSurveyWriteAccess — 설문 쓰기 권한', () => {
  it('보기만 하는 게스트는 자기 grant 설문이어도 쓰기가 FORBIDDEN', async () => {
    vi.stubEnv('ADMIN_USER_IDS', 'admin-1');
    vi.stubEnv('GUEST_SURVEY_GRANTS', `${GUEST9}:${VIEW_ONLY_SURVEY}`);
    const client = createRouterClient({ write, echo }, { context: ctx(GUEST9) });
    await expect(client.write({ surveyId: VIEW_ONLY_SURVEY })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    // 읽기(assertSurveyAccess)는 그대로 통과
    await expect(client.echo({ surveyId: VIEW_ONLY_SURVEY })).resolves.toEqual({ ok: true });
  });

  it('같은 계정의 보기 전용이 아닌 grant 설문은 쓰기 통과', async () => {
    vi.stubEnv('ADMIN_USER_IDS', 'admin-1');
    vi.stubEnv('GUEST_SURVEY_GRANTS', `${GUEST9}:${VIEW_ONLY_SURVEY},${GUEST9}:s-other`);
    const client = createRouterClient({ write }, { context: ctx(GUEST9) });
    await expect(client.write({ surveyId: 's-other' })).resolves.toEqual({ ok: true });
  });

  it('일반 게스트는 grant 설문 쓰기 통과, 다른 설문은 FORBIDDEN', async () => {
    vi.stubEnv('ADMIN_USER_IDS', 'admin-1');
    vi.stubEnv('GUEST_SURVEY_GRANTS', 'guest-1:s1');
    const client = createRouterClient({ write }, { context: ctx('guest-1') });
    await expect(client.write({ surveyId: 's1' })).resolves.toEqual({ ok: true });
    await expect(client.write({ surveyId: 's2' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('admin 은 쓰기 통과', async () => {
    vi.stubEnv('ADMIN_USER_IDS', 'admin-1');
    const client = createRouterClient({ write }, { context: ctx('admin-1') });
    await expect(client.write({ surveyId: VIEW_ONLY_SURVEY })).resolves.toEqual({ ok: true });
  });
});

const adminOnly = authed.handler(() => ({ ok: true }));

describe('authed 베이스 grant-first', () => {
  it('admin 은 통과', async () => {
    vi.stubEnv('ADMIN_USER_IDS', 'admin-1');
    const client = createRouterClient({ adminOnly }, { context: ctx('admin-1') });
    await expect(client.adminOnly()).resolves.toEqual({ ok: true });
  });

  it('grant 보유자는 allowlist 설정 여부와 무관하게 admin 전용 표면에서 FORBIDDEN', async () => {
    vi.stubEnv('ADMIN_USER_IDS', 'admin-1');
    vi.stubEnv('GUEST_SURVEY_GRANTS', 'guest-1:s1');
    const client = createRouterClient({ adminOnly }, { context: ctx('guest-1') });
    await expect(client.adminOnly()).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('allowlist 미설정 fail-open 이어도 grant 보유자는 admin 전용 표면에서 FORBIDDEN', async () => {
    vi.stubEnv('GUEST_SURVEY_GRANTS', 'guest-1:s1');
    const client = createRouterClient({ adminOnly }, { context: ctx('guest-1') });
    await expect(client.adminOnly()).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});
