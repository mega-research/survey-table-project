import 'server-only';

import { createHmac } from 'node:crypto';

import { constantTimeEquals } from '@/lib/crypto/constant-time';
import {
  ACCESS_LINK_TOKEN_MAX_LENGTH,
  ACCESS_LINK_TOKEN_MIN_LENGTH,
} from '@/shared/contracts/workspace';

/**
 * 외주 실사 링크 세션 쿠키의 코덱 — 서명·검증·읽기 (ADR-0026).
 *
 * 인프라 어댑터라 `lib/auth` 에 산다. 판정은 `server/access-link` 의 코어가 하고 여기는
 * 「쿠키 값이 우리가 만든 것인가」만 답한다 — 형제 `session-revocation.ts` 와 같은 자리다.
 *
 * ## 쿠키 이름에 토큰을 넣는다
 *
 * 이름이 `fw_<token>` 인 이유는 둘이다.
 *  ① 업체가 두 조사를 병행하면 **한 브라우저에 링크 세션이 여럿** 선다. 이름이 고정이면
 *     나중에 들어간 조사가 앞선 조사를 덮어 로그인을 오가게 된다.
 *  ② path 를 `/fw/...` 로 좁힐 수 없다. 대리 응답이 `/survey/...` 로 나가므로 그 경로에도
 *     쿠키가 실려야 하고(티켓 09 의 전제), 그래서 path 는 `/` 다.
 *
 * 토큰은 이미 주소에 실려 있으므로 쿠키 이름이 새로 노출하는 것은 없다.
 *
 * ## 서명 비밀키는 세션 서명 비밀키를 재사용한다
 *
 * `BETTER_AUTH_SECRET` 은 계정 세션 쿠키를 서명하는 값이고 이것도 세션 쿠키다 — 반경이 같아
 * 키를 따로 두면 환경 셋에 관리 대상만 하나 늘고 얻는 것이 없다. 이 값이 새면 계정 세션도
 * 함께 위조되므로 링크 쪽만 지켜 봐야 소용이 없다.
 *
 * ## 서명이 있어도 DB 대조가 본체다
 *
 * payload 에 `passwordUpdatedAt` 을 담는 것은 **비밀번호 변경이 선 세션을 끊게** 하기
 * 위해서다. 매 요청 DB 값과 대조하고 다르면 거부한다 — 시각의 대소가 아니라 **값의 일치**라
 * 앱·DB 시계 오차와 무관하다(계정 쪽 `users.sessions_revoked_at` 과 같은 발상).
 * 서명은 그 앞단의 값싼 관문일 뿐이고, 서명만 보고 통과시키면 비밀번호를 바꿔도 세션이 산다.
 */

/** 쿠키 이름 접두 — 뒤에 링크 토큰이 붙는다. */
export const FIELDWORK_LINK_COOKIE_PREFIX = 'fw_';

/**
 * 세션 유효기간 — 12시간.
 *
 * 「하루 일하는 동안 다시 묻지 않는다」(스토리 18)가 기준이다. 더 길게 두지 않는 이유는
 * 공용 PC 에서 자리를 비우는 동선이 흔하기 때문이고, 그보다 짧은 차단은 「나가기」와
 * 비밀번호 변경이 진다.
 */
export const ACCESS_LINK_SESSION_MAX_AGE_SECONDS = 12 * 60 * 60;

/**
 * 구조화 로그·Sentry 태그의 `role` 값 (ADR-0026).
 *
 * 계정 유형 어휘(`logRoleForUserType`)와 **같은 축이 아니다** — 링크 주체에는 계정이 없다.
 * 어휘를 한 자리에 적어 두는 이유는 로그 분석이 표면마다 다른 이름으로 갈리지 않게 하려는
 * 것이고, 그 관례는 업로드 REST 가드와 rpc-logging 이 어휘를 공유하는 것과 같다.
 */
export const ACCESS_LINK_LOG_ROLE = 'link';

/**
 * 링크 토큰의 모양 — nanoid URL-safe, 계약이 정한 두 길이 사이.
 *
 * 주소에서 온 값을 쿠키 이름에 붙이므로 **먼저 좁힌다.** 세미콜론·공백이 섞인 값이 그대로
 * 들어가면 쿠키 헤더가 쪼개지고, 그것은 판정 이전의 사고다. 길이 어휘는
 * `shared/contracts/workspace` 가 소유한다 — 경계 스키마도 같은 값을 봐야 하고, 그쪽은
 * client-safe 라 이 파일(server-only)을 import 할 수 없다. 발번은
 * `server/workspace/domain/access-link` 의 `generateAccessLinkToken` 이 한다.
 */
const TOKEN_PATTERN = new RegExp(
  `^[A-Za-z0-9_-]{${ACCESS_LINK_TOKEN_MIN_LENGTH},${ACCESS_LINK_TOKEN_MAX_LENGTH}}$`,
);

export function isAccessLinkToken(token: string): boolean {
  return TOKEN_PATTERN.test(token);
}

export function fieldworkLinkCookieName(token: string): string {
  if (!isAccessLinkToken(token)) {
    throw new Error('fieldworkLinkCookieName: 링크 토큰 모양이 아니다');
  }
  return `${FIELDWORK_LINK_COOKIE_PREFIX}${token}`;
}

/** 쿠키에 담기는 주장 — 이 셋이 DB 대조의 재료다. */
export interface AccessLinkSessionClaim {
  linkId: string;
  surveyId: string;
  /** 발급 시점의 `survey_access_links.password_updated_at` (ISO). 값 일치로 대조한다. */
  passwordUpdatedAt: string;
}

function signingKey(): string {
  const secret = process.env['BETTER_AUTH_SECRET'];
  if (!secret) {
    throw new Error('BETTER_AUTH_SECRET env required (외주 실사 링크 세션 서명)');
  }
  return secret;
}

function toBase64Url(value: string): string {
  return Buffer.from(value, 'utf8').toString('base64url');
}

function signature(payload: string): string {
  return createHmac('sha256', signingKey()).update(payload).digest('base64url');
}

/** payload 와 서명을 점으로 이은 쿠키 값. */
export function signAccessLinkSession(claim: AccessLinkSessionClaim): string {
  const payload = toBase64Url(
    JSON.stringify({
      linkId: claim.linkId,
      surveyId: claim.surveyId,
      passwordUpdatedAt: claim.passwordUpdatedAt,
    }),
  );
  return `${payload}.${signature(payload)}`;
}

function signatureMatches(payload: string, given: string): boolean {
  return constantTimeEquals(signature(payload), given);
}

/**
 * 쿠키 값 → 주장. 위조·훼손·모양 불일치는 전부 `null` 이다.
 *
 * 사유를 갈라 돌려주지 않는다 — 호출부가 할 수 있는 일이 「비밀번호를 다시 받는다」 하나라
 * 갈라도 쓸 데가 없고, 갈라 두면 로그·응답에 위조 시도의 종류가 남아 공격자에게 되돌아간다.
 */
export function verifyAccessLinkSession(value: string): AccessLinkSessionClaim | null {
  const dot = value.indexOf('.');
  if (dot <= 0 || dot === value.length - 1) return null;
  const payload = value.slice(0, dot);
  if (!signatureMatches(payload, value.slice(dot + 1))) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const { linkId, surveyId, passwordUpdatedAt } = parsed as Record<string, unknown>;
  if (
    typeof linkId !== 'string' ||
    typeof surveyId !== 'string' ||
    typeof passwordUpdatedAt !== 'string'
  ) {
    return null;
  }
  return { linkId, surveyId, passwordUpdatedAt };
}

/** 한 요청이 들고 온 링크 세션 하나 — 토큰은 쿠키 이름에서 나온다. */
export interface AccessLinkSession {
  token: string;
  claim: AccessLinkSessionClaim;
}

/**
 * 쿠키 값의 퍼센트 디코딩 — **던지지 않는다.**
 *
 * `decodeURIComponent('%')` 는 `URIError` 를 던진다. 이 파일은 `createContext` 에서 **모든
 * 요청**에 돌므로, 누군가의 브라우저에 `fw_<토큰>=%` 한 줄이 남아 있으면 그 브라우저의 RPC
 * 전체가 500 이 된다 — 그것은 링크와 무관한 사람까지 끊는 사고다. 디코딩에 실패하면 원문을
 * 그대로 넘겨 서명 검증이 조용히 거부하게 한다(이 파일의 「훼손은 전부 null」 계약).
 */
function decodeCookieValue(raw: string): string {
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

/**
 * 요청 헤더의 `fw_*` 쿠키 전부를 읽어 검증한 것만 돌려준다.
 *
 * `next/headers` 의 `cookies()` 를 쓰지 않는 이유는 호출 자리가 여럿이기 때문이다 — oRPC
 * 컨텍스트는 route handler 의 `request.headers` 로 만들어지고 RSC·테스트 경로에는 요청
 * 컨텍스트가 아예 없을 수 있다. 헤더 하나만 보면 그 차이가 사라진다.
 *
 * **DB 를 치지 않는다.** 여기까지는 「우리가 서명한 쿠키인가」이고, 「지금도 유효한가」는
 * 판정 코어가 링크 행을 읽어 답한다.
 */
export function readFieldworkLinkSessions(headers: Headers): AccessLinkSession[] {
  const header = headers.get('cookie');
  if (!header) return [];
  const sessions: AccessLinkSession[] = [];
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq <= 0) continue;
    const name = part.slice(0, eq).trim();
    if (!name.startsWith(FIELDWORK_LINK_COOKIE_PREFIX)) continue;
    const token = name.slice(FIELDWORK_LINK_COOKIE_PREFIX.length);
    if (!isAccessLinkToken(token)) continue;
    const claim = verifyAccessLinkSession(decodeCookieValue(part.slice(eq + 1).trim()));
    if (claim) sessions.push({ token, claim });
  }
  return sessions;
}
