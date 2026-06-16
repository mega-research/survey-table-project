import { createRouterClient } from '@orpc/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ORPCContext } from '@/server/context';

// limit() 를 vi.fn 으로 두면 vitest 4 의 settledResults 추적이 throw/reject 를 unhandled
// error 로 보고해 테스트가 실패한다(프로덕션 catch 는 정상 동작). 평범한 함수로 위임하고
// 호출 키만 수동 수집해 이 아티팩트를 피한다.
type LimitResult = { success: boolean; remaining: number; resetMs: number };
const OK: LimitResult = { success: true, remaining: 10, resetMs: 0 };
const state = vi.hoisted(() => ({
  impl: (_key: string): Promise<{ success: boolean; remaining: number; resetMs: number }> =>
    Promise.resolve({ success: true, remaining: 10, resetMs: 0 }),
  calls: [] as string[],
}));
vi.mock('@/lib/rate-limit/rate-limiter', () => ({
  getRateLimiter: () => ({
    limit: (key: string) => {
      state.calls.push(key);
      return state.impl(key);
    },
  }),
}));

import { base, isRateLimited, withRateLimit } from '@/server/orpc';

beforeEach(() => {
  state.impl = () => Promise.resolve({ ...OK });
  state.calls = [];
});

describe('isRateLimited', () => {
  it('한도 내(success=true)면 false 를 반환한다', async () => {
    state.impl = () => Promise.resolve({ success: true, remaining: 10, resetMs: 0 });
    await expect(isRateLimited('lookup', '1.2.3.4')).resolves.toBe(false);
    expect(state.calls).toContain('lookup:1.2.3.4');
  });

  it('한도 초과(success=false)면 true 를 반환한다', async () => {
    state.impl = () => Promise.resolve({ success: false, remaining: 0, resetMs: 0 });
    await expect(isRateLimited('lookup', '1.2.3.4')).resolves.toBe(true);
  });

  it('limiter 호출이 실패하면 fail-open 으로 false 를 반환한다', async () => {
    // Upstash 장애/자격증명 오류 등으로 .limit() 이 실패해도 응답 수집이 죽지 않아야 한다.
    state.impl = () => Promise.reject(new Error('upstash unreachable'));
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(isRateLimited('response-mutation', '1.2.3.4')).resolves.toBe(false);
    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
  });
});

// withRateLimit 미들웨어가 isRateLimited 결과를 ORPCError 로 옮기고, 신뢰 IP 부재 시
// fail-closed 하는지 검증한다(limiter 실패→fail-open 은 isRateLimited 단위에서 다룸).
const testRouter = {
  ping: base.use(withRateLimit('lookup')).handler(() => 'ok'),
};

function ctx(headers: Headers): ORPCContext {
  return { db: {} as never, supabase: {} as never, user: null, headers };
}

const TRUSTED = () => new Headers({ 'x-real-ip': '203.0.113.7' });

describe('withRateLimit', () => {
  it('한도 내면 핸들러를 실행한다', async () => {
    state.impl = () => Promise.resolve({ success: true, remaining: 10, resetMs: 0 });
    const client = createRouterClient(testRouter, { context: ctx(TRUSTED()) });
    await expect(client.ping()).resolves.toBe('ok');
  });

  it('한도 초과 시 TOO_MANY_REQUESTS 로 거부한다', async () => {
    state.impl = () => Promise.resolve({ success: false, remaining: 0, resetMs: 0 });
    const client = createRouterClient(testRouter, { context: ctx(TRUSTED()) });
    await expect(client.ping()).rejects.toMatchObject({ code: 'TOO_MANY_REQUESTS' });
  });

  it('신뢰 IP 추출 불가 시 fail-closed 로 거부한다(limiter 미호출)', async () => {
    const client = createRouterClient(testRouter, { context: ctx(new Headers()) });
    await expect(client.ping()).rejects.toMatchObject({ code: 'TOO_MANY_REQUESTS' });
    expect(state.calls).toHaveLength(0);
  });
});
