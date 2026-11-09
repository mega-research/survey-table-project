/**
 * 옛 게스트 주소 → 외주 실사 링크 다리의 순수 규칙.
 *
 * 옛 게스트 계정(env grant 모델)은 `/admin/surveys/<id>/operations` 를 쓰던 사람들이고, 그
 * 자리는 설문별 외주 실사 링크(`/fw/<token>`)가 이어받았다(ADR-0026). 북마크해 둔 옛 주소로
 * 와도 새 입구에 닿게 하는 것이 이 다리의 일이다. 판정과 조회는 라우트
 * (`app/api/legacy-guest-link`)가 하고, 여기는 그 재료만 둔다.
 *
 * **전환기 장치다.** 허용 목록이 비면 다리는 스스로 꺼지고 옛 주소는 접두만 걷힌 내부 콘솔
 * 주소로 간다 — 걷어낼 때는 env 를 비우는 것이 먼저고 코드는 그다음이다.
 */

/**
 * 허용 목록의 출처 — 옛 env grant(`<userId>:<surveyId>[,...]`)를 그대로 읽는다.
 *
 * 새 이름을 만들지 않은 이유는 이 값이 운영 환경에 이미 등록돼 있고, 「옛 게스트가 쓰던
 * 설문」의 정의가 정확히 이 목록이기 때문이다. 계정 쪽(userId)은 더는 아무 뜻이 없다 —
 * 그 계정 모델은 은퇴했고 여기서는 설문 id 만 쓴다.
 */
export const LEGACY_GUEST_GRANTS_ENV = 'GUEST_SURVEY_GRANTS';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * 옛 grant 목록에서 설문 id 집합을 뽑는다 — 소문자로 접고, UUID 모양이 아닌 항목은 버린다.
 *
 * 모양 검사가 여기 있는 것은 이 집합을 통과한 값이 곧바로 DB 조회의 인자가 되기 때문이다.
 * 주소에 실려 온 임의 문자열은 집합에 없으므로 조회까지 가지 못한다.
 */
export function parseLegacyGuestSurveyIds(raw: string | undefined): ReadonlySet<string> {
  const ids = new Set<string>();
  if (!raw) return ids;
  for (const entry of raw.split(',')) {
    const trimmed = entry.trim();
    const sep = trimmed.indexOf(':');
    if (sep <= 0) continue;
    const surveyId = trimmed
      .slice(sep + 1)
      .trim()
      .toLowerCase();
    if (UUID_RE.test(surveyId)) ids.add(surveyId);
  }
  return ids;
}

/**
 * 이 설문이 다리에 오른 설문인가 — 요청마다 env 를 읽는다(걷을 때 env 만 비우면 바로 꺼진다).
 *
 * **DB 를 묻기 전에 부른다.** 목록 밖의 설문은 링크 조회도 비밀번호 대조도 하지 않는다 — 다리가
 * 설문 id 하나로 링크를 찾아 주는 창구라, 대상을 좁히지 않으면 모든 설문이 그 창구가 된다.
 */
export function isLegacyBridgeSurvey(surveyId: string): boolean {
  return parseLegacyGuestSurveyIds(process.env[LEGACY_GUEST_GRANTS_ENV]).has(
    surveyId.toLowerCase(),
  );
}

/**
 * 다리 전용 비밀번호 화면의 주소 — 외주 링크가 여럿인 설문에서 쿠키로 링크를 고르지 못했을 때.
 *
 * `/fw` 아래에 둔 것은 그 구역이 1차 게이트(proxy) 밖이기 때문이다(계정 세션 없이 열린다).
 * `legacy` 는 링크 토큰이 될 수 없다 — 토큰은 16자 이상이라 `/fw/[token]` 과 겹치지 않는다.
 */
export function legacyBridgePasswordPath(surveyId: string): string {
  return `/fw/legacy/${encodeURIComponent(surveyId)}`;
}

/**
 * 다리 라우트 자체의 주소 — 다리 비밀번호 화면이 접속에 성공한 뒤 돌아가는 자리.
 *
 * 접속 표면은 토큰을 돌려주지 않는다(화면은 링크 주소를 모른다). 대신 방금 심은 쿠키를 들고 이
 * 주소를 다시 지나면 라우트가 「유효한 세션이 정확히 하나」로 그 링크를 고른다 — 고르는 판정이
 * 라우트 한 곳에만 있다.
 */
export function legacyBridgeRoutePath(surveyId: string): string {
  return `/api/legacy-guest-link/${encodeURIComponent(surveyId)}`;
}

/**
 * 옛 운영 콘솔 주소에서 `/admin` 접두만 걷은 주소 — 다리가 발화하지 않을 때의 목적지.
 *
 * 일반 규칙(`/admin/:path*` → `/:path*`)이 냈을 답과 같아야 한다: 직원의 옛 북마크는 다리를
 * 거쳐도 종전과 같은 화면에 닿는다. 탭 없는 주소를 여기서 고쳐 보내지 않는다 — 기본 탭은
 * 그 주소의 페이지(`surveys/[id]/operations/page.tsx`)가 정하고, 여기 한 벌 더 적으면 갈린다.
 * 세그먼트는 주소에서 온 값이라 인코딩하고 점 세그먼트는 버린다 — 실려 온 값이 콘솔 경로
 * 밖을 가리키지 못한다.
 */
export function legacyConsoleStaffPath(surveyId: string, rest: readonly string[]): string {
  const tail = rest
    .filter((segment) => segment !== '' && segment !== '.' && segment !== '..')
    .map((segment) => `/${encodeURIComponent(segment)}`)
    .join('');
  return `/surveys/${encodeURIComponent(surveyId)}/operations${tail}`;
}
