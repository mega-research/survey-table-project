import { isAdminUserAllowed } from '@/lib/auth/admin-allowlist';

/**
 * 설문 단위 게스트 grant.
 *
 * GUEST_SURVEY_GRANTS="<userId>:<surveyId>[,...]" — 해당 유저는 그 설문의
 * operations 표면에만 접근한다. admin-allowlist 와 같은 접근제어 인프라 상수.
 *
 * 주의: ADMIN_USER_IDS 미설정(fail-open) 상태에서는 모든 인증 사용자가 admin
 * 취급이라 게스트 격리가 무의미하다. 게스트를 쓰려면 allowlist 를 반드시 설정할 것.
 */

const ENV_KEY = 'GUEST_SURVEY_GRANTS';

/** 콤마 분리 "userId:surveyId" 목록 파싱. 형식 불량 항목은 무시. */
export function parseGuestGrants(raw?: string): Map<string, string> {
  const map = new Map<string, string>();
  if (!raw) return map;
  for (const entry of raw.split(',')) {
    const trimmed = entry.trim();
    if (!trimmed) continue;
    const sep = trimmed.indexOf(':');
    if (sep <= 0) continue;
    const userId = trimmed.slice(0, sep).trim();
    const surveyId = trimmed.slice(sep + 1).trim();
    if (!userId || !surveyId) continue;
    map.set(userId, surveyId);
  }
  return map;
}

/** 게스트 grant 조회 — 없으면 null. */
export function getGuestSurveyId(userId: string): string | null {
  return parseGuestGrants(process.env[ENV_KEY]).get(userId) ?? null;
}

/** 설문 접근 판정 — admin 은 전체, 게스트는 grant 설문만. */
export function canAccessSurvey(userId: string, surveyId: string): boolean {
  if (isAdminUserAllowed(userId)) return true;
  return getGuestSurveyId(userId) === surveyId;
}

/**
 * 미들웨어용 게스트 경로 판정 (순수 함수).
 * 허용 경로면 null, 차단이면 리다이렉트 목적지 pathname 반환.
 */
export function guestPathRedirect(
  pathname: string,
  grantedSurveyId: string,
): string | null {
  if (pathname === '/admin/login') return null;
  const allowedPrefix = `/admin/surveys/${grantedSurveyId}/operations`;
  if (pathname === allowedPrefix || pathname.startsWith(`${allowedPrefix}/`)) {
    return null;
  }
  return `${allowedPrefix}/overview`;
}
