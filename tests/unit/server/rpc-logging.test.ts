import { createRouterClient, ORPCError } from '@orpc/server';
import * as z from 'zod';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ORPCContext } from '@/server/context';

// pino 실인스턴스 대신 스파이 — 미들웨어가 넘기는 바인딩 객체만 검증한다.
const logged = vi.hoisted(() => ({
  info: vi.fn(),
  error: vi.fn(),
}));
vi.mock('@/lib/logger', () => ({
  logger: { info: logged.info, error: logged.error },
  scheduleLogFlush: vi.fn(),
  flushLogs: vi.fn(),
  withContext: vi.fn(),
  createLogger: vi.fn(),
  REDACT_PATHS: [],
}));

import { authed, base, pub } from '@/server/orpc';

beforeEach(() => {
  logged.info.mockReset();
  logged.error.mockReset();
});

afterEach(() => vi.unstubAllEnvs());

function ctx(userId: string | null, headers?: Headers): ORPCContext {
  return {
    db: {} as never,
    supabase: {} as never,
    user: userId ? ({ id: userId, email: 'x@y.z' } as never) : null,
    ...(headers ? { headers } : {}),
  };
}

const testRouter = {
  ping: pub.handler(() => 'ok'),
  contacts: {
    list: pub
      .input(z.object({ surveyId: z.string(), attrs: z.record(z.string(), z.string()).optional() }))
      .handler(() => []),
  },
  boom: pub.handler(() => {
    throw new Error('db down');
  }),
  adminOnly: authed.handler(() => 'ok'),
};

describe('rpcLoggingMiddleware', () => {
  it('성공 시 rpc 경로·role·durationMs 를 info 1줄로 남긴다', async () => {
    vi.stubEnv('ADMIN_USER_IDS', 'admin-1');
    const client = createRouterClient(testRouter, { context: ctx('admin-1') });
    await expect(client.ping()).resolves.toBe('ok');

    expect(logged.info).toHaveBeenCalledTimes(1);
    const [fields, msg] = logged.info.mock.calls[0] as [Record<string, unknown>, string];
    expect(msg).toBe('[rpc] 완료');
    expect(fields).toMatchObject({ rpc: 'ping', userId: 'admin-1', role: 'admin' });
    expect(fields['durationMs']).toBeTypeOf('number');
    expect(logged.error).not.toHaveBeenCalled();
  });

  it('중첩 라우터는 점 구분 경로(contacts.list)로 기록하고 surveyId 만 추출한다', async () => {
    vi.stubEnv('ADMIN_USER_IDS', 'admin-1');
    const client = createRouterClient(testRouter, { context: ctx('admin-1') });
    await client.contacts.list({ surveyId: 'svy-1', attrs: { secret: 'pii' } });

    const [fields] = logged.info.mock.calls[0] as [Record<string, unknown>];
    expect(fields).toMatchObject({ rpc: 'contacts.list', surveyId: 'svy-1' });
    // allowlist 관례 — input 본문(attrs 등)은 어떤 키로도 로그에 실리지 않는다
    expect(fields).not.toHaveProperty('attrs');
    expect(fields).not.toHaveProperty('input');
  });

  it('비인증은 role=anonymous, 신뢰 헤더가 있으면 ip 를 바인딩한다', async () => {
    const headers = new Headers({ 'x-real-ip': '203.0.113.7' });
    const client = createRouterClient(testRouter, { context: ctx(null, headers) });
    await client.ping();

    const [fields] = logged.info.mock.calls[0] as [Record<string, unknown>];
    expect(fields).toMatchObject({ role: 'anonymous', ip: '203.0.113.7' });
    expect(fields['userId']).toBeUndefined();
  });

  it('게스트 grant 보유자는 role=guest 로 기록한다', async () => {
    vi.stubEnv('ADMIN_USER_IDS', 'admin-1');
    vi.stubEnv('GUEST_SURVEY_GRANTS', 'guest-1:svy-1');
    const client = createRouterClient(testRouter, { context: ctx('guest-1') });
    await client.ping();

    const [fields] = logged.info.mock.calls[0] as [Record<string, unknown>];
    expect(fields).toMatchObject({ userId: 'guest-1', role: 'guest' });
  });

  it('세션은 있으나 allowlist 밖 + grant 없음은 role=user 로 기록한다', async () => {
    vi.stubEnv('ADMIN_USER_IDS', 'admin-1');
    const client = createRouterClient(testRouter, { context: ctx('nobody') });
    await client.ping();

    const [fields] = logged.info.mock.calls[0] as [Record<string, unknown>];
    expect(fields).toMatchObject({ userId: 'nobody', role: 'user' });
  });

  it('인증 미들웨어 거부(UNAUTHORIZED)도 code 와 함께 error 로 기록한다', async () => {
    const client = createRouterClient(testRouter, { context: ctx(null) });
    await expect(client.adminOnly()).rejects.toMatchObject({ code: 'UNAUTHORIZED' });

    expect(logged.error).toHaveBeenCalledTimes(1);
    const [fields, msg] = logged.error.mock.calls[0] as [Record<string, unknown>, string];
    expect(msg).toBe('[rpc] 실패');
    expect(fields).toMatchObject({ rpc: 'adminOnly', role: 'anonymous', code: 'UNAUTHORIZED' });
    expect(fields['err']).toBeInstanceOf(ORPCError);
    expect(logged.info).not.toHaveBeenCalled();
  });

  it('비-ORPCError 는 wire 마스킹과 같은 INTERNAL_SERVER_ERROR code 로 기록한다', async () => {
    const client = createRouterClient(testRouter, { context: ctx(null) });
    await expect(client.boom()).rejects.toBeDefined();

    const [fields] = logged.error.mock.calls[0] as [Record<string, unknown>];
    expect(fields).toMatchObject({ rpc: 'boom', code: 'INTERNAL_SERVER_ERROR' });
    expect(fields['durationMs']).toBeTypeOf('number');
    expect(fields['err']).toBeInstanceOf(Error);
  });

  it('base 파생이므로 미들웨어를 다시 붙이지 않은 procedure 도 커버된다', async () => {
    // base 를 직접 쓰는 procedure (health 등) 회귀 방어
    const direct = { health: base.handler(() => 'up') };
    const client = createRouterClient(direct, { context: ctx(null) });
    await client.health();
    expect(logged.info).toHaveBeenCalledTimes(1);
    const [fields] = logged.info.mock.calls[0] as [Record<string, unknown>];
    expect(fields).toMatchObject({ rpc: 'health' });
  });
});
