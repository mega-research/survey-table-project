import { isAdminUserAllowed } from '@/lib/auth/admin-allowlist';

/**
 * 설문 단위 게스트 grant.
 *
 * GUEST_SURVEY_GRANTS="<userId>:<surveyId>[,...]" — 해당 유저는 grant 된
 * 설문들의 operations 표면에만 접근한다. 같은 userId 를 반복 등재하면 설문
 * 여러 개를 가질 수 있다 (guest1:s1,guest1:s2). admin-allowlist 와 같은
 * 접근제어 인프라 상수.
 *
 * 주의: grant 보유자는 ADMIN_USER_IDS 설정 여부와 무관하게 항상 게스트로
 * 취급된다(canAccessSurvey grant-first). ADMIN_USER_IDS 미설정(fail-open) 이
 * 남기는 리스크는 grant 가 없는 임의 가입자가 admin 취급되는 경우로 한정되며,
 * 이 경우도 allowlist 를 반드시 설정해 막아야 한다.
 */

const ENV_KEY = 'GUEST_SURVEY_GRANTS';

/** 콤마 분리 "userId:surveyId" 목록 파싱 — 같은 userId 는 누적. 형식 불량 항목은 무시. */
export function parseGuestGrants(raw?: string): Map<string, string[]> {
  const map = new Map<string, string[]>();
  if (!raw) return map;
  for (const entry of raw.split(',')) {
    const trimmed = entry.trim();
    if (!trimmed) continue;
    const sep = trimmed.indexOf(':');
    if (sep <= 0) continue;
    const userId = trimmed.slice(0, sep).trim();
    const surveyId = trimmed.slice(sep + 1).trim();
    if (!userId || !surveyId) continue;
    const list = map.get(userId) ?? [];
    if (!list.includes(surveyId)) list.push(surveyId);
    map.set(userId, list);
  }
  return map;
}

/** 게스트 grant 설문 목록 조회 — 없으면 빈 배열. */
export function getGuestSurveyIds(userId: string): string[] {
  return parseGuestGrants(process.env[ENV_KEY]).get(userId) ?? [];
}

/** 게스트(설문 단위 grant 보유자) 여부. */
export function isGuestUser(userId: string): boolean {
  return getGuestSurveyIds(userId).length > 0;
}

/**
 * admin allowlist 통과 또는 게스트 grant 보유 판정 — 게스트에게 열린 표면
 * (scoped 베이스, 업로드 라우트)의 공용 1차 가드. 설문 일치는 별도로
 * canAccessSurvey/assertSurveyAccess 가 강제한다.
 */
export function isAdminOrGuestGrantHolder(userId: string): boolean {
  return isGuestUser(userId) || isAdminUserAllowed(userId);
}

/** 설문 접근 판정 — grant 보유자는 항상 게스트(grant 설문들만), 그 외는 admin allowlist 판정. */
export function canAccessSurvey(userId: string, surveyId: string): boolean {
  const granted = getGuestSurveyIds(userId);
  if (granted.length > 0) return granted.includes(surveyId);
  return isAdminUserAllowed(userId);
}

/** 게스트가 무권한 설문 URL 을 눌렀을 때 보내는 강제 로그아웃 라우트. */
export const GUEST_FORCE_LOGOUT_PATH = '/admin/logout';

/** 설문 콘솔(operations/preview) 경로 판정 — grant 불일치 시 강제 로그아웃 대상. */
const SURVEY_CONSOLE_PATH = /^\/admin\/surveys\/[^/]+\/(operations|preview)(\/|$)/;

/**
 * 미들웨어용 게스트 경로 판정 (순수 함수).
 * 허용 경로면 null, 차단이면 리다이렉트 목적지 pathname 반환.
 *
 * grant 된 설문들의 operations/preview 는 전부 허용한다. grant 밖 설문의
 * 콘솔은 자기 overview 로 조용히 돌리지 않고 즉시 로그아웃시켜 로그인
 * 화면으로 보낸다 — 그 설문 담당 계정으로 다시 로그인해야 한다는 운영
 * 결정(2026-08-14, 안내 페이지 대체).
 */
export function guestPathRedirect(
  pathname: string,
  grantedSurveyIds: readonly string[],
): string | null {
  if (pathname === '/admin/login') return null;
  // 강제 로그아웃 라우트 자신은 통과 — 리다이렉트 루프 방지.
  if (pathname === GUEST_FORCE_LOGOUT_PATH) return null;
  for (const grantedSurveyId of grantedSurveyIds) {
    // 설문 보기(발행 스냅샷 미리보기)는 읽기 전용 화면이라 게스트에게도 허용한다.
    const previewPath = `/admin/surveys/${grantedSurveyId}/preview`;
    if (pathname === previewPath || pathname.startsWith(`${previewPath}/`)) return null;
    const allowedPrefix = `/admin/surveys/${grantedSurveyId}/operations`;
    if (pathname === allowedPrefix || pathname.startsWith(`${allowedPrefix}/`)) {
      // 액션 procedure 가 authed(게스트 차단)로 남는 편집 화면은 경로도 함께 차단 —
      // 폼을 다 채운 뒤 FORBIDDEN 을 받는 반쪽 UI 를 만들지 않는다.
      // (컨택 목록·상세·수동 추가·메일·profiles 는 게스트 허용 procedure 와 짝이라 통과.)
      const blockedSubpaths = [
        'contacts/upload',
        'contacts/result-codes',
        'contacts/columns',
        'quota',
      ];
      for (const sub of blockedSubpaths) {
        const full = `${allowedPrefix}/${sub}`;
        if (pathname === full || pathname.startsWith(`${full}/`)) {
          return `${allowedPrefix}/overview`;
        }
      }
      return null;
    }
  }
  // grant 밖 설문 콘솔 경로 — 즉시 로그아웃 (grant 설문 경로는 위에서 이미 통과/차단됨)
  if (SURVEY_CONSOLE_PATH.test(pathname)) return GUEST_FORCE_LOGOUT_PATH;
  return `/admin/surveys/${grantedSurveyIds[0]}/operations/overview`;
}
