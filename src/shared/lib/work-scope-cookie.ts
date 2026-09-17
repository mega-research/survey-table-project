'use client';

import { SYSTEM_SCOPE, WORK_SCOPE_COOKIE } from '@/shared/contracts/workspace';

/**
 * 마지막으로 고른 작업 범위 — 브라우저가 기억하는 편의값이다 (역할 모델 v2 티켓 07).
 *
 * **판정의 근거가 아니다.** 서버는 이 값을 받아도 멤버십으로 다시 해석하고(server/work-scope),
 * 해산된 팀이나 남의 팀이 들어오면 첫 활성 팀으로 접는다. 그래서 여기서는 유효성을 따지지
 * 않는다 — 화면이 자체 검증을 시작하면 서버와 두 벌의 규칙이 생긴다.
 *
 * 쿠키를 쓰는 이유는 서버가 같은 값을 읽어야 해서다 — 첫 조회에는 화면이 아직 범위를 모르므로
 * 요청에 실려 간 쿠키가 서버의 출발점이 된다. 티켓 08 의 사이드바 스위처도 이 값을 쓴다.
 */
const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

export function readWorkScopeCookie(): string | null {
  if (typeof document === 'undefined') return null;
  const hit = document.cookie
    .split('; ')
    .find((part) => part.startsWith(`${WORK_SCOPE_COOKIE}=`));
  if (!hit) return null;
  const value = decodeURIComponent(hit.slice(WORK_SCOPE_COOKIE.length + 1));
  return value === '' ? null : value;
}

export function writeWorkScopeCookie(scope: string | typeof SYSTEM_SCOPE): void {
  if (typeof document === 'undefined') return;
  document.cookie = `${WORK_SCOPE_COOKIE}=${encodeURIComponent(scope)}; path=/; max-age=${ONE_YEAR_SECONDS}; SameSite=Lax`;
}
