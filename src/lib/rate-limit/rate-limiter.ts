import { logger } from '@/lib/logger';
import { Ratelimit, type Duration } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';

/**
 * rate limit 그룹별 한도 프리셋.
 *
 * 무중단 조정을 위해 상수로 분리한다. 값 변경은 이 객체만 수정하면 된다.
 *
 * 버킷 분리 원칙(2026-08-11, 리미터 제출 전멸 사고 후속): 실패 시 응답이 유실되는
 * 회당 소수 호출(생성/완료)과, 실패해도 안전망(다음 클릭 flush·이탈 beacon·최종 complete)이
 * 있는 고빈도 체크포인트(saveDraft)는 반드시 다른 버킷을 쓴다. 같은 버킷을 공유하면
 * 표 문항 연속 입력의 saveDraft 폭주가 complete 예산까지 소진해 제출이 전멸한다.
 *
 * 키 2단 구성(IP_WIDE_GROUPS + isRateLimitedTwoTier 참조): 기본 그룹은
 * `group:ip:clientId`(세션/응답 단위 — 같은 NAT IP 의 정상 응답자 상호 격리),
 * `-ip` 그룹은 `group-ip:ip`(IP 전체 상한 — 남용 방어). clientId 는 클라이언트 임의
 * 값이라 단독으로는 회전 우회가 가능하므로 반드시 IP 전체 가드와 짝으로만 쓴다.
 *
 * - response-mutation: 응답 생성(createWithFirstAnswer/createBlank)·완료(complete) 등
 *   회당 소수 호출 쓰기. 세션당 30회/1분.
 * - response-segment: Page Visibility 세그먼트 beacon. 응답당 60회/1분.
 * - response-draft: 임시 저장 쓰기 전체 — saveDraft RPC(디바운스 자동 저장 + "다음" flush)
 *   와 이탈 시점 beacon. 응답당 60회/1분 (클라이언트 디바운스 5초 + maxWait 15초 기준
 *   이론상 최대 12회/1분 — 재시도/멀티탭 여유 포함).
 * - *-ip: 위 그룹들의 IP 전체 가드. 같은 NAT(사무실/전시장/CGNAT)의 동시 응답자 수를
 *   고려해 세션 한도의 10배.
 * - lookup: 토큰/attrs/중복/쿼터 조회 등 읽기. IP 당 60회/1분 (클라이언트 축 없음 —
 *   IP 가드 없이 축을 주면 회전 우회 표면만 생긴다).
 */
export const RATE_LIMIT_PRESETS = {
  'response-mutation': { tokens: 30, window: '1 m' },
  'response-mutation-ip': { tokens: 300, window: '1 m' },
  'response-segment': { tokens: 60, window: '1 m' },
  'response-segment-ip': { tokens: 600, window: '1 m' },
  'response-draft': { tokens: 60, window: '1 m' },
  'response-draft-ip': { tokens: 600, window: '1 m' },
  lookup: { tokens: 60, window: '1 m' },
} as const satisfies Record<string, { tokens: number; window: Duration }>;

export type RateLimitGroup = keyof typeof RATE_LIMIT_PRESETS;

/**
 * 그룹별 IP 전체 가드 매핑. 여기 등재된 그룹만 클라이언트 축(fine 키)을 사용한다 —
 * IP 가드 없이 클라이언트 축만 주면 식별자 회전으로 한도를 통째로 우회할 수 있다.
 */
export const IP_WIDE_GROUPS = {
  'response-mutation': 'response-mutation-ip',
  'response-segment': 'response-segment-ip',
  'response-draft': 'response-draft-ip',
} as const satisfies Partial<Record<RateLimitGroup, RateLimitGroup>>;

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
 * limiter 를, 하나라도 없으면 no-op limiter 를 반환한다(최초 1회 경고 로그).
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
      logger.warn(
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
 * 2단 rate limit 판정 — 한도 초과면 true.
 *
 * fine 버킷과 IP 전체 가드 버킷을 병렬 판정해 어느 한쪽이라도 초과면 차단한다.
 * - IP_WIDE_GROUPS 등재 그룹 + clientId 존재: fine 키 = `group:ip:clientId`,
 *   가드 키 = `group-ip:ip` 2개를 본다.
 * - clientId 부재: fine 키가 `group:ip` 로 내려간다 (가드는 그대로).
 * - 미등재 그룹(lookup 등): clientId 를 무시하고 `group:ip` 단일 판정 —
 *   IP 가드 없는 그룹에 클라이언트 축을 주면 식별자 회전 우회가 되기 때문.
 *
 * 외부 의존성(Upstash) 호출은 fail-open: 장애/자격증명 오류 등으로 .limit() 이 throw 해도
 * false(통과)로 흡수해 응답 수집 전체가 죽지 않게 한다. env 미설정 시 noop 으로 fail-open
 * 하는 정책(getRateLimiter)과 같은 계열. 한도 초과(success=false)는 정상 거부로 유지하고,
 * throw 만 통과로 흡수한다.
 */
export async function isRateLimitedTwoTier(
  group: RateLimitGroup,
  ip: string,
  clientId: string | null,
): Promise<boolean> {
  const ipWideGroup = (IP_WIDE_GROUPS as Partial<Record<RateLimitGroup, RateLimitGroup>>)[
    group
  ];
  const fineKey =
    ipWideGroup !== undefined && clientId !== null
      ? `${group}:${ip}:${clientId}`
      : `${group}:${ip}`;
  try {
    const limiter = getRateLimiter();
    const checks = [limiter.limit(fineKey)];
    if (ipWideGroup !== undefined) {
      checks.push(limiter.limit(`${ipWideGroup}:${ip}`));
    }
    const results = await Promise.all(checks);
    return results.some((result) => !result.success);
  } catch (err) {
    logger.error({ group, err }, '[rate-limit] limiter 호출 실패 — fail-open 통과');
    return false;
  }
}

/**
 * 테스트 전용 — 싱글톤 캐시와 경고 플래그를 초기화한다.
 */
export function resetRateLimiterForTest(): void {
  cached = null;
  warnedNoop = false;
}
