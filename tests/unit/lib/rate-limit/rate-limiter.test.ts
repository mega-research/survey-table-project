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

import { getRateLimiter, resetRateLimiterForTest } from '@/lib/rate-limit/rate-limiter';

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
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
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
      // response-mutation / response-segment / lookup 3개 그룹.
      expect(slidingWindowMock).toHaveBeenCalled();
      expect(ratelimitCtor).toHaveBeenCalled();
    });
  });
});
