import { ORPCError, os } from '@orpc/server';

import { isAdminUserAllowed } from '@/lib/auth/admin-allowlist';
import {
  canAccessSurvey,
  getGuestSurveyId,
  isAdminOrGuestGrantHolder,
} from '@/lib/auth/guest-grants';
import { getTrustedClientIpOrNull } from '@/lib/rate-limit/client-ip';
import { isRateLimitedTwoTier, type RateLimitGroup } from '@/lib/rate-limit/rate-limiter';

import type { ORPCContext } from './context';
import { rpcLoggingMiddleware } from './rpc-logging';

/** 컨텍스트 타입만 박은 원시 빌더 — 미들웨어 팩토리(withRateLimit) 전용. */
const root = os.$context<ORPCContext>();

/**
 * 모든 procedure의 뿌리. 로깅 미들웨어가 최전방에 붙어 pub/authed/scoped 파생
 * 전 procedure 의 성공/실패가 구조화 로그 1줄로 남는다 (rpc-logging.ts 참조).
 * 최전방이므로 rate limit·인증 미들웨어의 거부(TOO_MANY_REQUESTS 등)도 기록된다.
 */
export const base = root.use(rpcLoggingMiddleware);

/** 응답자(공개) 베이스 — 인증 불필요. */
export const pub = base;

/**
 * 검증 전 입력에서 rate limit 클라이언트 축 식별자를 추출한다.
 *
 * sessionId(응답 생성 계열) 우선, 없으면 responseId(saveDraft/complete 계열).
 * 최상위 string 키 외에는 접근하지 않는다 (rpc-logging 의 surveyId 추출과 같은 관례).
 * 클라이언트 임의 값이므로 길이 상한으로 Redis 키 폭주를 막는다 — 식별자 회전 남용은
 * isRateLimitedTwoTier 의 IP 전체 가드가 담당하므로 여기서 진위를 검증하지 않는다.
 */
function extractRateLimitClientId(input: unknown): string | null {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return null;
  const record = input as Record<string, unknown>;
  for (const key of ['sessionId', 'responseId'] as const) {
    const value = record[key];
    if (typeof value === 'string' && value.length > 0 && value.length <= 128) {
      return value;
    }
  }
  return null;
}

/**
 * rate limit 미들웨어 팩토리. pub 프로시저에 .use(withRateLimit(group)) 로 부착한다.
 *
 * 판정은 2단(isRateLimitedTwoTier): 입력의 sessionId/responseId 를 클라이언트 축으로
 * 삼아 같은 NAT IP 뒤의 정상 응답자들을 서로 격리하고(`group:ip:clientId`), IP 전체
 * 가드(`group-ip:ip`)가 식별자 회전 남용을 막는다. 한도 초과 시 TOO_MANY_REQUESTS.
 * Upstash env 미설정이면 limiter 가 no-op(항상 통과)이라 가용성에 영향 없음. limiter
 * 호출이 실패하면 isRateLimitedTwoTier 가 fail-open 으로 흡수한다.
 *
 * 신뢰 IP 추출 불가(헤더 부재)면 fail-closed 로 거부한다. 식별 불가한 익명 요청들이
 * 단일 'unknown' 버킷을 공유하면 상호 한도 잠식/약 DoS 가 되므로, 공유 버킷 대신
 * 차단한다(Vercel 표준 배포는 항상 신뢰 헤더가 채워져 이 경로에 도달하지 않음).
 */
export function withRateLimit(group: RateLimitGroup) {
  // base 는 로깅 미들웨어가 붙은 빌더라 .middleware() 가 없다 — 원시 root 로 만든다.
  return root.middleware(async ({ context, next }, input: unknown) => {
    const ip = getTrustedClientIpOrNull(context.headers ?? new Headers());
    if (ip === null) {
      throw new ORPCError('TOO_MANY_REQUESTS', {
        message: '요청을 식별할 수 없습니다. 잠시 후 다시 시도해 주세요.',
      });
    }
    if (await isRateLimitedTwoTier(group, ip, extractRateLimitClientId(input))) {
      throw new ORPCError('TOO_MANY_REQUESTS', {
        message: '요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.',
      });
    }
    return next();
  });
}

/**
 * 관리자 베이스 — supabase 세션 필수 + allowlist 런타임 가드.
 *
 * 1) context.user non-null 검사(미인증이면 UNAUTHORIZED).
 * 2) grant-first: 게스트 grant 보유자는 항상 게스트 — allowlist fail-open 여부와
 *    무관하게 admin 전용 표면에서 거부한다(FORBIDDEN). 게스트 허용 표면은 scoped 담당.
 * 3) ADMIN_USER_IDS allowlist 검사(미포함이면 FORBIDDEN).
 *    allowlist 미설정이면 fail-open(통과) — isAdminUserAllowed 참조.
 *
 * 통과하면 context.user가 non-null로 좁혀진다.
 */
export const authed = base.use(({ context, next }) => {
  if (!context.user) {
    throw new ORPCError('UNAUTHORIZED', { message: '인증이 필요합니다.' });
  }
  if (getGuestSurveyId(context.user.id) !== null) {
    throw new ORPCError('FORBIDDEN', { message: '접근 권한이 없습니다.' });
  }
  if (!isAdminUserAllowed(context.user.id)) {
    throw new ORPCError('FORBIDDEN', { message: '접근 권한이 없습니다.' });
  }
  return next({ context: { user: context.user } });
});

/**
 * 설문 스코프 베이스 — 세션 필수 + (admin allowlist ∨ 게스트 grant 보유).
 *
 * 게스트에게 열어줄 procedure 전용. 이 베이스를 쓰는 procedure 는 반드시
 * handler 첫 줄에서 assertSurveyAccess(context.user.id, input.surveyId) 를
 * 호출해 설문 일치를 강제해야 한다 (유일한 예외: 입력에 surveyId 가 없는
 * media.deleteMailAttachmentTmp — tmp 네임스페이스 검증에 의존).
 * 나머지 전 표면은 authed(admin 전용) 유지 — 게스트는 기본 거부.
 *
 * grant-first: grant 보유자는 admin allowlist 검사 없이 통과시킨다. 이후
 * assertSurveyAccess 가 설문 일치를 강제하므로 allowlist fail-open 여부와
 * 무관하게 게스트는 자기 설문 밖으로 나갈 수 없어 안전하다.
 */
export const scoped = base.use(({ context, next }) => {
  if (!context.user) {
    throw new ORPCError('UNAUTHORIZED', { message: '인증이 필요합니다.' });
  }
  if (!isAdminOrGuestGrantHolder(context.user.id)) {
    throw new ORPCError('FORBIDDEN', { message: '접근 권한이 없습니다.' });
  }
  return next({ context: { user: context.user } });
});

/** 설문 접근 강제 — admin 통과, 게스트는 grant 일치 필수. 불일치 FORBIDDEN. */
export function assertSurveyAccess(userId: string, surveyId: string): void {
  if (!canAccessSurvey(userId, surveyId)) {
    throw new ORPCError('FORBIDDEN', { message: '해당 설문에 대한 권한이 없습니다.' });
  }
}
