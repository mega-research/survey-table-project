import { Ratelimit, type Duration } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';

/**
 * rate limit 그룹별 한도 프리셋.
 *
 * 무중단 조정을 위해 상수로 분리한다. 값 변경은 이 객체만 수정하면 된다.
 * - response-mutation: 응답 시작/답변/완료 등 쓰기 mutation. 30회/1분.
 * - response-segment: Page Visibility 세그먼트 beacon. 빈번하므로 60회/1분.
 * - lookup: 토큰/attrs/중복 조회 등 읽기. 60회/1분.
 */
export const RATE_LIMIT_PRESETS = {
  'response-mutation': { tokens: 30, window: '1 m' },
  'response-segment': { tokens: 60, window: '1 m' },
  lookup: { tokens: 60, window: '1 m' },
} as const satisfies Record<string, { tokens: number; window: Duration }>;

export type RateLimitGroup = keyof typeof RATE_LIMIT_PRESETS;

export interface RateLimitResult {
  /** 통과(true) 또는 한도 초과(false). */
  success: boolean;
  /** 현재 윈도 내 남은 허용 요청 수. */
  remaining: number;
  /** 한도가 리셋되는 Unix 타임스탬프(ms). */
  resetMs: number;
}

export interface RateLimiter {
  limit(key: string): Promise<RateLimitResult>;
}

/**
 * Upstash 환경이 없을 때 사용하는 no-op limiter.
 * 가용성 우선(fail-open) — 항상 success 를 반환해 정상 트래픽을 막지 않는다.
 */
const noopLimiter: RateLimiter = {
  async limit(): Promise<RateLimitResult> {
    return { success: true, remaining: Number.POSITIVE_INFINITY, resetMs: 0 };
  },
};

/**
 * group 접두사("response-mutation:1.2.3.4")로 들어오는 키에서 그룹을 분리해
 * 그룹별 Ratelimit 인스턴스로 라우팅하는 Upstash 기반 limiter.
 */
class UpstashRateLimiter implements RateLimiter {
  private readonly limiters: Map<RateLimitGroup, Ratelimit>;

  constructor(redis: Redis) {
    this.limiters = new Map();
    for (const group of Object.keys(RATE_LIMIT_PRESETS) as RateLimitGroup[]) {
      const preset = RATE_LIMIT_PRESETS[group];
      this.limiters.set(
        group,
        new Ratelimit({
          redis,
          limiter: Ratelimit.slidingWindow(preset.tokens, preset.window),
          // 그룹별로 Redis 키 네임스페이스를 분리한다.
          prefix: `ratelimit:${group}`,
        }),
      );
    }
  }

  async limit(key: string): Promise<RateLimitResult> {
    const group = key.split(':', 1)[0] as RateLimitGroup;
    const limiter = this.limiters.get(group);
    if (!limiter) {
      // 미등록 그룹은 fail-open. 키 오타로 인한 의도치 않은 차단 방지.
      return { success: true, remaining: Number.POSITIVE_INFINITY, resetMs: 0 };
    }
    const result = await limiter.limit(key);
    return {
      success: result.success,
      remaining: result.remaining,
      resetMs: result.reset,
    };
  }
}

let cached: RateLimiter | null = null;
let warnedNoop = false;

/**
 * 싱글톤 limiter 팩토리.
 *
 * UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN 가 모두 설정되면 Upstash
 * limiter 를, 하나라도 없으면 no-op limiter 를 반환한다(최초 1회 console.warn).
 * Redis 클라이언트와 limiter 인스턴스를 재사용한다.
 *
 * 동시성: 이 함수 본문은 await 가 없는 완전 동기 코드라 단일 스레드 JS 이벤트 루프에서
 * cached 검사~할당 사이에 다른 요청이 끼어들 수 없다. 따라서 콜드스타트 동시 요청에도
 * Redis 클라이언트가 중복 생성되지 않는다(첫 동기 호출이 cached 를 채운 뒤 반환).
 */
export function getRateLimiter(): RateLimiter {
  if (cached) {
    return cached;
  }

  const url = process.env['UPSTASH_REDIS_REST_URL'];
  const token = process.env['UPSTASH_REDIS_REST_TOKEN'];

  if (!url || !token) {
    if (!warnedNoop) {
      warnedNoop = true;
      console.warn(
        '[rate-limit] UPSTASH_REDIS_REST_URL/UPSTASH_REDIS_REST_TOKEN 미설정 — no-op limiter 사용(fail-open). 운영 환경에서는 반드시 설정할 것.',
      );
    }
    cached = noopLimiter;
    return cached;
  }

  const redis = new Redis({ url, token });
  cached = new UpstashRateLimiter(redis);
  return cached;
}

/**
 * 테스트 전용 — 싱글톤 캐시와 경고 플래그를 초기화한다.
 */
export function resetRateLimiterForTest(): void {
  cached = null;
  warnedNoop = false;
}
