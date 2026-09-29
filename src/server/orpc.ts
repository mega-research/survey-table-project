import { ORPCError, os } from '@orpc/server';

import { getTrustedClientIpOrNull } from '@/lib/rate-limit/client-ip';
import { type RateLimitGroup, isRateLimitedTwoTier } from '@/lib/rate-limit/rate-limiter';
import { isActiveUser, isInternalUser } from '@/shared/contracts/auth';

import type { ORPCContext } from './context';
import { resolveLinkActorForSurvey } from './fieldwork-link';
import type { Actor } from './survey-access';
import { extractSurveyIdOrUndefined, rpcLoggingMiddleware } from './rpc-logging';

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
 * sessionId(응답 생성 계열) 우선, 없으면 responseId(saveDraft/complete 계열), 없으면
 * token(외주 실사 링크의 비밀번호 검증 — 링크 하나가 곧 클라이언트 축이다).
 * 최상위 string 키 외에는 접근하지 않는다 (rpc-logging 의 surveyId 추출과 같은 관례).
 * 클라이언트 임의 값이므로 길이 상한으로 Redis 키 폭주를 막는다 — 식별자 회전 남용은
 * isRateLimitedTwoTier 의 IP 전체 가드가 담당하므로 여기서 진위를 검증하지 않는다.
 *
 * `token` 을 맨 뒤에 둔 것은 기존 버킷 키를 건드리지 않기 위해서다 — 이 축을 실제로 쓰는
 * 그룹(IP_WIDE_GROUPS 등재분) 중 `token` 입력을 받는 것은 링크 검증뿐이고, 나머지는 앞의 두
 * 키에서 이미 값을 얻는다. 미등재 그룹(lookup·public-read)은 클라이언트 축 자체를 무시한다.
 */
function extractRateLimitClientId(input: unknown): string | null {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return null;
  const record = input as Record<string, unknown>;
  for (const key of ['sessionId', 'responseId', 'token'] as const) {
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
 * 세션·계정 상태 공통 가드 — authed/scoped 가 함께 쓴다.
 * 미인증은 UNAUTHORIZED, 비활성 계정은 FORBIDDEN. 통과하면 non-null 로 좁혀진다.
 */
function requireActiveUser(user: ORPCContext['user']): NonNullable<ORPCContext['user']> {
  if (!user) {
    throw new ORPCError('UNAUTHORIZED', { message: '인증이 필요합니다.' });
  }
  if (!isActiveUser(user.status)) {
    throw new ORPCError('FORBIDDEN', { message: '활성 계정만 접근할 수 있습니다.' });
  }
  return user;
}

/**
 * 관리자 베이스 — Better Auth 세션 필수 + 계정 상태·유형 가드.
 *
 * 1) context.user non-null 검사(미인증이면 UNAUTHORIZED).
 * 2) status === 'active' 검사 — 비활성 계정(suspended/departed 등)은 FORBIDDEN.
 *    세션 발급 자체를 lib/auth/server.ts 훅이 막지만, 발급 뒤 상태가 바뀐 세션도
 *    있으므로 요청 시점에 다시 본다.
 * 3) userType === 'internal' 검사 — guest/fieldwork 계정은 내부 표면 전체에서 거부한다.
 *    각자의 콘솔(티켓 22·25)은 scoped 등 자기 가드로 열린다. 유형별 라우팅은 티켓 05.
 *
 * 게스트 판정이 여기서 한 줄 사라진 것이 티켓 21 의 자국이다 — 예전에는 env grant 보유자를
 * userId 로 따로 걸렀다. 지금은 계정 유형이 곧 게스트라 위의 3)이 그 일을 함께 한다.
 *
 * 통과하면 context.user가 non-null로 좁혀진다.
 */
export const authed = base.use(({ context, next }) => {
  const user = requireActiveUser(context.user);
  if (!isInternalUser(user.userType)) {
    throw new ORPCError('FORBIDDEN', { message: '접근 권한이 없습니다.' });
  }
  return next({ context: { user } });
});

/**
 * 슈퍼어드민 베이스 — authed(세션 + active + 내부 계정) + isSuperadmin.
 *
 * 전역 관리 표면(사용자 관리·계정 상태 전이·실사 업체 관리) 전용이다. 슈퍼어드민이
 * 아닌 내부 계정은 FORBIDDEN — 권한 없음과 존재 여부를 구분하지 않는다(authed 와 같은 코드).
 * authed 파생이라 게스트 차단·비활성 계정 차단은 한 번만 쓰여 있다.
 */
export const superadmin = authed.use(({ context, next }) => {
  if (!context.user.isSuperadmin) {
    throw new ORPCError('FORBIDDEN', { message: '슈퍼어드민만 접근할 수 있습니다.' });
  }
  return next({ context: { user: context.user } });
});

/**
 * 자기 계정 베이스 — 세션 + active. **계정 유형을 보지 않는다.**
 *
 * 프로필처럼 "누구든 자기 것만 만지는" 표면 전용이다. authed 는 내부 전용이라 게스트·실사가
 * 자기 이름·비밀번호조차 바꿀 수 없고, scoped 는 설문 스코프를 강제하는 자리라 surveyId 가
 * 없는 이 표면에는 맞지 않는다.
 *
 * 자기 것만 만진다는 보장은 베이스가 아니라 handler 가 한다 — 대상 id 를 입력에서 받지 말고
 * context.user.id 를 쓸 것. 남의 계정을 지목할 수 있는 표면은 superadmin 소관이다(티켓 04).
 */
export const account = base.use(({ context, next }) => {
  return next({ context: { user: requireActiveUser(context.user) } });
});

/**
 * 설문 스코프 베이스 — **계정 또는 외주 실사 링크**가 통과한다 (ADR-0026, 티켓 06).
 *
 * 티켓 03 까지 이 베이스는 계정을 요구했다. 링크를 들이면 handler 가 `context.user.id` 를
 * 읽다 터지기 때문이었고, handler 들이 주체를 읽을 줄 알게 되는 것이 이 티켓의 일이다.
 * 지금 계약은 하나다 — **이 베이스를 쓰는 procedure 는 handler 첫 줄에서**
 * `assertScopedSurveyCapabilityRpc(context.actor, input.surveyId, '<capability>')`
 * **를 부른다.** 예외 없음(티켓 21 이 마지막 예외를 authed 로 옮겼다). 링크에게 열리는
 * capability 는 넷뿐이라(survey.view·operations.view·contacts.view·contacts.writeAttempts)
 * 나머지 표면은 관문이 전부 거부한다 — 그 사실은 `fieldwork-link-denial` 이 라우터를 열거해
 * 고정한다.
 *
 * 인증 가드가 `account` 와 더는 같지 않지만 **별개의 베이스로 둔다**는 이유는 그대로다:
 * 이쪽은 「설문 일치를 handler 가 강제한다」, 저쪽은 「자기 것만 만진다」.
 *
 * ## 계정이 있으면 계정이 이긴다
 *
 * 연구원이 자기가 발급한 링크를 같은 브라우저에서 눌러 보면 계정 세션과 `fw_` 쿠키가 함께
 * 실려 온다. 그때 링크를 먼저 보면 **그 설문의 admin 콘솔이 조용히 링크 권한으로 깎인다** —
 * 「방금까지 되던 편집이 안 된다」가 되고 원인이 쿠키라 아무도 못 찾는다. 계정을 먼저 보면
 * 반대 방향의 사고는 없다: 링크 콘솔 화면 자체는 주소의 토큰으로 판정하므로(RSC 관문)
 * 버튼 구성이 넓어지지 않고, 그 사람이 이미 가진 권한이 늘지도 않는다.
 *
 * **받아들인 어긋남이 하나 있다.** 그 상태에서 링크 콘솔을 보면 화면(RSC, 링크 주체 →
 * 실 파티션)과 그 화면이 부르는 RPC(계정 주체 → 테스트 모드면 test 파티션)가 다른 파티션을
 * 본다 — 테스트 모드를 켠 설문에서 필터 후보가 표의 행과 어긋나게 보인다. 겪는 사람은
 * **테스트 모드를 스스로 켜 둔 담당 연구원 한 명**이고, 반대로 고치면 위의 「admin 콘솔이
 * 깎인다」가 되살아난다.
 *
 * ## 계정이 없을 때만 DB 를 친다
 *
 * 링크 후보가 없으면 헤더 한 줄을 본 것이 전부이고(context), 계정이 있으면 그 자리에서
 * 끝난다 — 응답자·연구원 요청의 비용은 0 이다.
 */
export const scoped = base.use(async ({ context, next }, input: unknown) => {
  if (context.user !== null) {
    const user = requireActiveUser(context.user);
    // 계정 주체는 세션 값 그대로다 — `AuthUser` 가 판정이 읽는 만큼(`SurveyAccessUser`)을
    // 이미 담고 있어 옮겨 담을 것이 없다.
    return next({ context: { user, actor: user satisfies Actor } });
  }
  // 값이 실제로 그 설문인지는 묻지 않는다 — 판정은 링크 행과 관문이 하고, 여기서 하는 일은
  // **여러 개의 `fw_` 쿠키 중 어느 것을 볼지 고르는 것**뿐이다. 지목된 설문이 없으면 고를
  // 쿠키도 없어 주체를 알 수 없다(오늘 도달 경로는 없다 — scoped 표면 전수가 surveyId 를
  // 받는 것을 음성 스위트가 고정한다).
  const surveyId = extractSurveyIdOrUndefined(input);
  if (!surveyId) throw new ORPCError('UNAUTHORIZED', { message: '인증이 필요합니다.' });

  const link = await resolveLinkActorForSurvey(context.linkSessions, surveyId);
  // 계정 분기와 **같은 타입**을 실어 보낸다 — 분기마다 모양이 다르면 handler 의
  // `context.actor` 가 좁은 쪽으로 추론돼 계정 주체를 못 받는다.
  if (link.kind === 'ok') return next({ context: { actor: link.actor satisfies Actor as Actor } });

  // **거부 사유가 둘로 갈린다.**
  //  - `no_session` + 다른 링크 세션 보유 → NOT_FOUND. 이 주체에게 그 설문은 존재하지
  //    않는다(게스트의 미부여 설문과 같은 판단). 여기서 UNAUTHORIZED 를 주면 타 설문 id
  //    하나가 「세션이 끊겼다」로 보여 외주가 멀쩡한 비밀번호를 다시 넣는다.
  //  - 그 밖(세션 없음·무효) → UNAUTHORIZED. 접속하거나 다시 접속해야 하는 상태다.
  //    무효 사유(종료·중단·비밀번호 변경)를 갈라 말하지 않는 것은 코어의 계약이다.
  if (link.kind === 'no_session' && (context.linkSessions?.length ?? 0) > 0) {
    throw new ORPCError('NOT_FOUND', { message: '설문을 찾을 수 없습니다.' });
  }
  throw new ORPCError('UNAUTHORIZED', { message: '인증이 필요합니다.' });
});

/**
 * 계정 전용 scoped 표면이 세션 계정을 읽는 문 (티켓 06).
 *
 * scoped 베이스가 링크도 들이므로 `context.user` 는 null 일 수 있다. 이 문을 쓰는 표면들은
 * 요구 capability(`mail.send`·`responses.view`)가 링크에게 닫혀 있어 여기까지 오지 않지만,
 * 타입은 그 사실을 모른다. handler 마다 `!` 를 흩뿌리는 대신 한 곳으로 모으는 이유는
 * **나중에 그 표면 하나가 링크에 열릴 때 터질 자리를 하나로 두려는 것**이다.
 */
export function requireScopedAccount(context: ORPCContext): NonNullable<ORPCContext['user']> {
  return requireActiveUser(context.user);
}
