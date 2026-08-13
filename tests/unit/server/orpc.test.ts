import { createRouterClient } from '@orpc/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ORPCContext } from '@/server/context';

// isRateLimitedTwoTier 를 평범한 위임 함수로 모킹하고 호출 인자만 수집한다.
// (vi.fn reject 는 vitest 4 settledResults 추적이 unhandled error 로 보고하는
// 아티팩트가 있어 평범한 함수 위임을 유지한다 — 한도 판정/fail-open 자체는
// rate-limiter.test.ts 의 isRateLimitedTwoTier 단위 테스트가 담당한다.)
const state = vi.hoisted(() => ({
  impl: (): Promise<boolean> => Promise.resolve(false),
  calls: [] as Array<{ group: string; ip: string; clientId: string | null }>,
}));
vi.mock('@/lib/rate-limit/rate-limiter', () => ({
  isRateLimitedTwoTier: (group: string, ip: string, clientId: string | null) => {
    state.calls.push({ group, ip, clientId });
    return state.impl();
  },
}));

// orpc.ts 의 로깅 미들웨어(rpc-logging) 콘솔 오염 방지용 mock
const logged = vi.hoisted(() => ({ info: vi.fn(), error: vi.fn() }));
vi.mock('@/lib/logger', () => ({
  logger: { info: logged.info, error: logged.error },
  scheduleLogFlush: vi.fn(),
  flushLogs: vi.fn(),
  withContext: vi.fn(),
  createLogger: vi.fn(),
  REDACT_PATHS: [],
}));

import { base, withRateLimit } from '@/server/orpc';

beforeEach(() => {
  state.impl = () => Promise.resolve(false);
  state.calls = [];
  logged.info.mockClear();
  logged.error.mockClear();
});

// withRateLimit 미들웨어의 책임 3가지를 검증한다:
// (1) 신뢰 IP 부재 시 fail-closed, (2) 검증 전 입력에서 클라이언트 축(sessionId/responseId)
// 추출 후 isRateLimitedTwoTier 위임, (3) 판정 결과의 TOO_MANY_REQUESTS 변환.
const testRouter = {
  ping: base.use(withRateLimit('lookup')).handler(() => 'ok'),
  echo: base.use(withRateLimit('response-mutation')).handler(() => 'ok'),
};

function ctx(headers: Headers): ORPCContext {
  return { db: {} as never, supabase: {} as never, user: null, headers };
}

const TRUSTED = () => new Headers({ 'x-real-ip': '203.0.113.7' });

describe('withRateLimit', () => {
  it('한도 내면 핸들러를 실행한다', async () => {
    const client = createRouterClient(testRouter, { context: ctx(TRUSTED()) });
    await expect(client.ping()).resolves.toBe('ok');
    expect(state.calls).toEqual([{ group: 'lookup', ip: '203.0.113.7', clientId: null }]);
  });

  it('한도 초과 시 TOO_MANY_REQUESTS 로 거부한다', async () => {
    state.impl = () => Promise.resolve(true);
    const client = createRouterClient(testRouter, { context: ctx(TRUSTED()) });
    await expect(client.ping()).rejects.toMatchObject({ code: 'TOO_MANY_REQUESTS' });
  });

  it('신뢰 IP 추출 불가 시 fail-closed 로 거부한다(limiter 미호출)', async () => {
    const client = createRouterClient(testRouter, { context: ctx(new Headers()) });
    await expect(client.ping()).rejects.toMatchObject({ code: 'TOO_MANY_REQUESTS' });
    expect(state.calls).toHaveLength(0);
  });

  it('입력의 sessionId 를 클라이언트 축으로 전달한다', async () => {
    const client = createRouterClient(testRouter, { context: ctx(TRUSTED()) });
    await client.echo({ sessionId: 'sess-1', responseId: 'resp-9' });
    // sessionId 가 responseId 보다 우선한다.
    expect(state.calls).toEqual([
      { group: 'response-mutation', ip: '203.0.113.7', clientId: 'sess-1' },
    ]);
  });

  it('sessionId 가 없으면 responseId 로 폴백한다', async () => {
    const client = createRouterClient(testRouter, { context: ctx(TRUSTED()) });
    await client.echo({ responseId: 'resp-9' });
    expect(state.calls).toEqual([
      { group: 'response-mutation', ip: '203.0.113.7', clientId: 'resp-9' },
    ]);
  });

  it('식별자가 없거나 비정상(비문자열/과대 길이)이면 clientId 는 null 이다', async () => {
    const client = createRouterClient(testRouter, { context: ctx(TRUSTED()) });
    await client.echo({ surveyId: 's1' });
    await client.echo({ sessionId: 123 });
    await client.echo({ sessionId: 'x'.repeat(129) });
    await client.echo(undefined);
    expect(state.calls.map((call) => call.clientId)).toEqual([null, null, null, null]);
  });
});
