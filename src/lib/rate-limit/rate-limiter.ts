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
 * - quota-check: 쿼터 판정 조회. 응답당 30회/1분. 읽기지만 lookup 과 분리 — 공유
 *   lookup 버킷이 NAT 진입 트래픽(resume/attrs/duplicate)으로 소진되면 쿼터 판정이
 *   fail-open 으로 조용히 스킵되는 품질 문제가 있어 전용 예산을 준다.
 * - lookup: 토큰/attrs/중복 조회 등 읽기. IP 당 60회/1분 (클라이언트 축 없음 —
 *   IP 가드 없이 축을 주면 회전 우회 표면만 생긴다).
 * - public-read: 응답 페이지 진입 시 설문 조회(bySlug/byPrivateToken/forResponse).
 *   IP 당 300회/1분. lookup 과 분리하는 이유는 잠식 방지다 — 진입 1회가 이미 lookup 을
 *   3회(resume/attrs/duplicate) 쓰는데 여기까지 얹으면 5회가 되어 같은 NAT 뒤 동시
 *   진입 인원이 20명/분에서 12명/분으로 떨어진다. 초과 시 응답자는 재시도 여지 없이
 *   설문 로딩 에러 화면을 본다(use-survey-loader 초기 로딩 catch).
 *   입력(slug/token/surveyId)에 sessionId·responseId 가 없어 클라이언트 축이 잡히지
 *   않으므로 키는 `public-read:ip` 단일 IP 버킷 — 사실상 IP 전체 가드다. 그래서 한도도
 *   세션 단위 fine 버킷이 아니라 다른 `-ip` 가드와 같은 스케일로 잡았다.
 *   IP_WIDE_GROUPS 에는 등재하지 않는다 — 클라이언트 축이 없으면 fine 키가 `group:ip`
 *   로 떨어져 가드 키와 축이 같아지고, 같은 IP 를 두 번 세는 왕복만 늘어난다.
 */
export const RATE_LIMIT_PRESETS = {
  'response-mutation': { tokens: 30, window: '1 m' },
  'response-mutation-ip': { tokens: 300, window: '1 m' },
  'response-segment': { tokens: 60, window: '1 m' },
  'response-segment-ip': { tokens: 600, window: '1 m' },
  'response-draft': { tokens: 60, window: '1 m' },
  'response-draft-ip': { tokens: 600, window: '1 m' },
  'quota-check': { tokens: 30, window: '1 m' },
  'quota-check-ip': { tokens: 300, window: '1 m' },
  lookup: { tokens: 60, window: '1 m' },
  // 공개 설문 조회. 진입 1회당 2회 소비(bySlug|byPrivateToken + forResponse)라 같은 IP 뒤
  // 약 150명/분까지 통과한다 — 실사 사무실 공용 IP 를 염두에 둔 여유값이다.
  // 주의: RSC 가 서비스를 직접 호출하는 경로(/i/[code], /preview/[token])는 procedure 를
  // 타지 않아 이 버킷에 계측되지 않는다.
  'public-read': { tokens: 300, window: '1 m' },
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
  'quota-check': 'quota-check-ip',
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

/** 그룹의 IP 전체 가드 그룹 조회. 미등재면 undefined. */
function ipWideGroupOf(group: RateLimitGroup): RateLimitGroup | undefined {
  return (IP_WIDE_GROUPS as Partial<Record<RateLimitGroup, RateLimitGroup>>)[group];
}

/** fine 버킷 키 조합 — IP 가드가 있는 그룹만 클라이언트 축을 붙인다 (회전 우회 방지). */
function fineKeyOf(group: RateLimitGroup, ip: string, clientId: string | null): string {
  return ipWideGroupOf(group) !== undefined && clientId !== null
    ? `${group}:${ip}:${clientId}`
    : `${group}:${ip}`;
}

/**
 * 키 목록 병렬 판정 코어 — 판정 가능한(fulfilled) 결과 중 하나라도 거부면 true.
 *
 * allSettled 를 쓰는 이유: Promise.all 이면 한 tier 의 reject 가 다른 tier 의 명시적
 * 거부(success=false)까지 삼켜 fail-open 이 된다. 부분 장애에서도 살아있는 tier 의
 * 거부는 반드시 존중하고, 실패한 tier 만 개별 fail-open 한다.
 *
 * 외부 의존성(Upstash) 호출 실패는 fail-open: 응답 수집 전체가 죽지 않게 한다.
 * env 미설정 시 noop 으로 fail-open 하는 정책(getRateLimiter)과 같은 계열. 한도 초과
 * (success=false)는 정상 거부로 유지하고, 호출 실패만 통과로 흡수한다.
 */
async function isRateLimitedKeys(group: RateLimitGroup, keys: string[]): Promise<boolean> {
  try {
    const limiter = getRateLimiter();
    const results = await Promise.allSettled(keys.map((key) => limiter.limit(key)));
    let limited = false;
    results.forEach((result, index) => {
      if (result.status === 'fulfilled') {
        if (!result.value.success) limited = true;
      } else {
        logger.error(
          { group, key: keys[index], err: result.reason },
          '[rate-limit] limiter 호출 실패 — 해당 tier fail-open',
        );
      }
    });
    return limited;
  } catch (err) {
    logger.error({ group, err }, '[rate-limit] limiter 호출 실패 — fail-open 통과');
    return false;
  }
}

/**
 * 2단 rate limit 판정 — 한도 초과면 true. oRPC withRateLimit 미들웨어용.
 *
 * fine 버킷과 IP 전체 가드 버킷을 병렬 판정해 어느 한쪽이라도 초과면 차단한다.
 * - IP_WIDE_GROUPS 등재 그룹 + clientId 존재: fine 키 = `group:ip:clientId`,
 *   가드 키 = `group-ip:ip` 2개를 본다.
 * - clientId 부재: fine 키가 `group:ip` 로 내려간다 (가드는 그대로).
 * - 미등재 그룹(lookup 등): clientId 를 무시하고 `group:ip` 단일 판정 —
 *   IP 가드 없는 그룹에 클라이언트 축을 주면 식별자 회전 우회가 되기 때문.
 */
export async function isRateLimitedTwoTier(
  group: RateLimitGroup,
  ip: string,
  clientId: string | null,
): Promise<boolean> {
  const ipWideGroup = ipWideGroupOf(group);
  const keys = [fineKeyOf(group, ip, clientId)];
  if (ipWideGroup !== undefined) {
    keys.push(`${ipWideGroup}:${ip}`);
  }
  return isRateLimitedKeys(group, keys);
}

/**
 * 1단계: IP 전체 가드만 판정. REST beacon 라우트가 본문을 읽기 전에 호출한다 —
 * malformed/스키마 불일치 요청도 예산을 소비하게 해, 무인증 공개 경로에서 파싱
 * CPU 를 공짜로 증폭시키는 것을 막는다. IP 가드가 없는 그룹은 판정 없이 통과
 * (이 헬퍼는 IP_WIDE_GROUPS 등재 그룹 전용 — 2단계 fine 판정이 남아 있다).
 */
export async function isRateLimitedIpGuardTier(
  group: RateLimitGroup,
  ip: string,
): Promise<boolean> {
  const ipWideGroup = ipWideGroupOf(group);
  if (ipWideGroup === undefined) return false;
  return isRateLimitedKeys(group, [`${ipWideGroup}:${ip}`]);
}

/**
 * 2단계: fine 버킷만 판정. REST beacon 라우트가 본문 검증 후 검증된 responseId 로
 * 호출한다. IP 가드는 1단계에서 이미 소비했으므로 여기서 다시 보지 않는다.
 */
export async function isRateLimitedFineTier(
  group: RateLimitGroup,
  ip: string,
  clientId: string | null,
): Promise<boolean> {
  return isRateLimitedKeys(group, [fineKeyOf(group, ip, clientId)]);
}

/**
 * 테스트 전용 — 싱글톤 캐시와 경고 플래그를 초기화한다.
 */
export function resetRateLimiterForTest(): void {
  cached = null;
  warnedNoop = false;
}
