// 계정 유형별 홈과 로그인 직후 목적지 — 순수 함수 (server-only 아님, 미들웨어·RSC 공용).
import { type UserType, userTypeValues } from '@/shared/contracts/auth';

import { AUTH_PAGES, ACCOUNT_PAGES } from './protected-paths';

/**
 * 유형별 홈 — 로그인 직후 갈 곳이자, 남의 구역에서 되돌려 보낼 곳.
 *
 * 티켓 03 이 계정 유형 게이트를 앞당겨 넣은 뒤로 guest·fieldwork 계정은 로그인은 되는데
 * 목적지가 없어 내부 화면에서 거부만 됐다. 이 표가 그 구멍을 메운다 — 유형이 늘면 여기에
 * 한 줄이 늘고, 홈 경로가 바뀌어도 고칠 자리는 한 곳이다.
 *
 * 게스트·실사 홈은 이 티켓에서 스텁(빈 상태)이고 내용은 티켓 22·25 가 채운다.
 */
export const ACCOUNT_HOME_PATH: Record<UserType, string> = {
  internal: '/admin/surveys',
  guest: '/guest',
  fieldwork: '/fieldwork',
};

/**
 * 유형의 홈. 값이 없거나 어휘 밖이면 게스트 홈으로 접는다.
 *
 * 세션 페이로드를 건너온 값이라 타입만으로는 보장되지 않는다 — `readSessionUser` 가 이미
 * 같은 취지로 'guest' 를 안전 기본값으로 쓰고, 여기서도 같은 방향으로 접는다. 폴백이 없으면
 * `redirect(undefined)` 가 되어 리다이렉트가 조용히 깨진다.
 */
export function accountHomePath(userType: UserType | undefined): string {
  return (userType && ACCOUNT_HOME_PATH[userType]) || ACCOUNT_HOME_PATH.guest;
}

/** 게스트·실사 구역의 루트 경로 — proxy matcher·레이아웃 가드가 함께 본다. */
export const NON_INTERNAL_HOME_PATHS: readonly string[] = userTypeValues
  .filter((userType) => userType !== 'internal')
  .map((userType) => ACCOUNT_HOME_PATH[userType]);

/**
 * 이 경로가 해당 유형의 구역인가.
 *
 * 접두어 비교만 하면 `/guestbook` 이 게스트 구역으로 잡힌다 — 경계는 정확히 일치하거나
 * 다음 문자가 `/` 일 때만이다.
 */
export function isAccountTypePath(pathname: string, userType: UserType | undefined): boolean {
  // internal 의 홈은 /admin/surveys 지만 내부 구역은 /admin 전체다 — 유형 구역 판정은
  // 게스트·실사 전용이므로 내부는 이 함수의 대상이 아니다(항상 false).
  // 값이 없으면 어떤 구역도 자기 것이 아니다 — 안전한 방향으로 접는다.
  if (!userType || userType === 'internal') return false;
  const home = ACCOUNT_HOME_PATH[userType];
  return pathname === home || pathname.startsWith(`${home}/`);
}

/**
 * 로그인 직후 목적지.
 *
 * 내부 계정은 요청한 경로를 그대로 존중한다(정제는 호출측 sanitizeRedirectPath 몫).
 * 게스트·실사는 자기 구역과 공통 계정 화면(프로필)만 존중하고 나머지는 자기 홈으로 접는다 —
 * 내부 경로로 그대로 보내면 admin 게이트가 되돌려 보내 로그인 화면을 오가게 된다.
 *
 * 티켓 21 부터 **모든 계정이 이 함수 하나를 지난다**. 예전에는 설문 단위 env grant 게스트가
 * grant 설문 콘솔을 목적지로 삼아 따로 판정됐다.
 */
export function resolvePostLoginDestination(
  userType: UserType | undefined,
  target: string,
): string {
  const home = accountHomePath(userType);
  const path = target.split(/[?#]/)[0] ?? target;
  // 로그인 화면으로 되돌리면 그대로 로그인 화면을 오가는 루프가 된다.
  if (!path || AUTH_PAGES.has(path)) return home;
  // 자기 계정 화면은 유형과 무관하게 열린다.
  if (ACCOUNT_PAGES.has(path)) return target;
  if (userType === 'internal') return target;
  return isAccountTypePath(path, userType) ? target : home;
}
