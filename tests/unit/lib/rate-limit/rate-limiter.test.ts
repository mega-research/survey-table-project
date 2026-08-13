import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// @upstash/ratelimit / @upstash/redis 모킹. env 가 설정된 경로에서만 사용된다.
// vi.mock 팩토리는 파일 최상단으로 hoist 되므로 mock 함수도 vi.hoisted 로 끌어올린다.
const { limitMock, ratelimitCtor, redisCtor, slidingWindowMock } = vi.hoisted(() => ({
  limitMock: vi.fn(),
  ratelimitCtor: vi.fn(),
  redisCtor: vi.fn(),
  slidingWindowMock: vi.fn((..._args: unknown[]) => ({ kind: 'sliding-window' })),
}));

vi.mock('@upstash/ratelimit', () => {
  class Ratelimit {
    static slidingWindow = slidingWindowMock;
    limit = limitMock;
    constructor(opts: unknown) {
      ratelimitCtor(opts);
    }
  }
  return { Ratelimit };
});

vi.mock('@upstash/redis', () => {
  class Redis {
    constructor(opts: unknown) {
      redisCtor(opts);
    }
  }
  return { Redis };
});

import { logger } from '@/lib/logger';
import {
  getRateLimiter,
  isRateLimitedFineTier,
  isRateLimitedIpGuardTier,
  isRateLimitedTwoTier,
  resetRateLimiterForTest,
} from '@/lib/rate-limit/rate-limiter';

const ENV_URL = 'UPSTASH_REDIS_REST_URL';
const ENV_TOKEN = 'UPSTASH_REDIS_REST_TOKEN';

describe('getRateLimiter', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    resetRateLimiterForTest();
    limitMock.mockReset();
    ratelimitCtor.mockReset();
    redisCtor.mockReset();
    slidingWindowMock.mockClear();
    delete process.env[ENV_URL];
    delete process.env[ENV_TOKEN];
    warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
    delete process.env[ENV_URL];
    delete process.env[ENV_TOKEN];
  });

  describe('env 미설정 (no-op fail-open)', () => {
    it('항상 success=true 를 반환한다', async () => {
      const limiter = getRateLimiter();
      const result = await limiter.limit('response-mutation:1.2.3.4');
      expect(result.success).toBe(true);
      // Upstash 클라이언트는 생성되지 않는다.
      expect(redisCtor).not.toHaveBeenCalled();
      expect(ratelimitCtor).not.toHaveBeenCalled();
    });

    it('no-op 경고를 최초 1회만 출력한다', () => {
      getRateLimiter();
      getRateLimiter();
      expect(warnSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe('env 설정 (Upstash 사용)', () => {
    beforeEach(() => {
      process.env[ENV_URL] = 'https://example.upstash.io';
      process.env[ENV_TOKEN] = 'test-token';
    });

    it('한도 내면 success=true, remaining/resetMs 를 전달한다', async () => {
      limitMock.mockResolvedValue({ success: true, remaining: 29, reset: 1_700_000_000_000 });
      const limiter = getRateLimiter();
      const result = await limiter.limit('response-mutation:1.2.3.4');
      expect(result.success).toBe(true);
      expect(result.remaining).toBe(29);
      expect(result.resetMs).toBe(1_700_000_000_000);
      expect(redisCtor).toHaveBeenCalledTimes(1);
    });

    it('한도 초과 시 success=false 를 반환한다', async () => {
      limitMock.mockResolvedValue({ success: false, remaining: 0, reset: 1_700_000_000_000 });
      const limiter = getRateLimiter();
      const result = await limiter.limit('response-mutation:1.2.3.4');
      expect(result.success).toBe(false);
      expect(result.remaining).toBe(0);
    });

    it('싱글톤으로 Redis 클라이언트를 재사용한다', () => {
      getRateLimiter();
      getRateLimiter();
      expect(redisCtor).toHaveBeenCalledTimes(1);
    });

    it('그룹별 sliding window 프리셋을 등록한다', () => {
      getRateLimiter();
      // RATE_LIMIT_PRESETS 에 등록된 전체 그룹 (mutation/segment/draft + *-ip 가드 + lookup).
      expect(slidingWindowMock).toHaveBeenCalled();
      expect(ratelimitCtor).toHaveBeenCalled();
    });
  });
});

describe('isRateLimitedTwoTier', () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    resetRateLimiterForTest();
    limitMock.mockReset();
    process.env[ENV_URL] = 'https://example.upstash.io';
    process.env[ENV_TOKEN] = 'test-token';
    errorSpy = vi.spyOn(logger, 'error').mockImplementation(() => {});
    limitMock.mockResolvedValue({ success: true, remaining: 10, reset: 0 });
  });

  afterEach(() => {
    errorSpy.mockRestore();
    delete process.env[ENV_URL];
    delete process.env[ENV_TOKEN];
  });

  it('IP 가드 그룹은 fine 키(ip:clientId)와 IP 가드 키를 병렬 판정한다', async () => {
    await expect(isRateLimitedTwoTier('response-draft', '1.2.3.4', 'sess-1')).resolves.toBe(
      false,
    );
    const keys = limitMock.mock.calls.map((call) => call[0]);
    expect(keys).toEqual(['response-draft:1.2.3.4:sess-1', 'response-draft-ip:1.2.3.4']);
  });

  it('clientId 가 없으면 fine 키는 IP 로 내려간다 (가드는 유지)', async () => {
    await expect(isRateLimitedTwoTier('response-draft', '1.2.3.4', null)).resolves.toBe(false);
    const keys = limitMock.mock.calls.map((call) => call[0]);
    expect(keys).toEqual(['response-draft:1.2.3.4', 'response-draft-ip:1.2.3.4']);
  });

  it('IP 가드가 없는 그룹(lookup)은 clientId 를 무시하고 단일 IP 키만 판정한다', async () => {
    // 가드 없는 그룹에 클라이언트 축을 주면 식별자 회전 우회가 되므로 축 자체를 막는다.
    await expect(isRateLimitedTwoTier('lookup', '1.2.3.4', 'sess-1')).resolves.toBe(false);
    const keys = limitMock.mock.calls.map((call) => call[0]);
    expect(keys).toEqual(['lookup:1.2.3.4']);
  });

  it('fine/가드 어느 한쪽이라도 초과면 true 를 반환한다', async () => {
    // 세션 축은 통과해도 IP 전체 가드가 초과인 케이스 (NAT 남용 시나리오).
    limitMock.mockImplementation((key: string) =>
      Promise.resolve(
        key.startsWith('response-draft-ip:')
          ? { success: false, remaining: 0, reset: 0 }
          : { success: true, remaining: 10, reset: 0 },
      ),
    );
    await expect(isRateLimitedTwoTier('response-draft', '1.2.3.4', 'sess-1')).resolves.toBe(
      true,
    );
  });

  it('limiter 호출이 실패하면 fail-open 으로 false 를 반환한다', async () => {
    // Upstash 장애/자격증명 오류로도 응답 수집이 죽지 않아야 한다.
    // reject 대신 sync throw — vi.fn 의 rejected settledResults 를 vitest 4 가
    // unhandled error 로 보고하는 아티팩트 회피 (async 래퍼가 rejection 으로 변환한다).
    limitMock.mockImplementation(() => {
      throw new Error('upstash unreachable');
    });
    await expect(isRateLimitedTwoTier('response-mutation', '1.2.3.4', 'sess-1')).resolves.toBe(
      false,
    );
    expect(errorSpy).toHaveBeenCalled();
  });

  it('한 tier 가 실패해도 다른 tier 의 명시적 거부는 차단으로 존중한다', async () => {
    // 부분 장애: fine 버킷은 success=false 로 판정했는데 IP 가드 호출만 throw.
    // Promise.all 이면 전체가 fail-open 되던 회귀 케이스 — allSettled 로 거부를 지킨다.
    limitMock.mockImplementation((key: string) => {
      if (key.startsWith('response-draft-ip:')) {
        throw new Error('upstash timeout');
      }
      return Promise.resolve({ success: false, remaining: 0, reset: 0 });
    });
    await expect(isRateLimitedTwoTier('response-draft', '1.2.3.4', 'sess-1')).resolves.toBe(
      true,
    );
    expect(errorSpy).toHaveBeenCalled();
  });

  it('isRateLimitedIpGuardTier 는 IP 가드 키만 판정한다', async () => {
    await expect(isRateLimitedIpGuardTier('response-draft', '1.2.3.4')).resolves.toBe(false);
    expect(limitMock.mock.calls.map((call) => call[0])).toEqual([
      'response-draft-ip:1.2.3.4',
    ]);
  });

  it('isRateLimitedIpGuardTier 는 가드 없는 그룹이면 판정 없이 통과한다', async () => {
    await expect(isRateLimitedIpGuardTier('lookup', '1.2.3.4')).resolves.toBe(false);
    expect(limitMock).not.toHaveBeenCalled();
  });

  it('isRateLimitedFineTier 는 fine 키만 판정한다', async () => {
    await expect(isRateLimitedFineTier('response-draft', '1.2.3.4', 'resp-1')).resolves.toBe(
      false,
    );
    expect(limitMock.mock.calls.map((call) => call[0])).toEqual([
      'response-draft:1.2.3.4:resp-1',
    ]);
  });
});
