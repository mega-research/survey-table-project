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
 * 옛 운영 콘솔 주소에서 `/admin` 접두만 걷은 주소 — 다리가 발화하지 않을 때의 목적지.
 *
 * 일반 규칙(`/admin/:path*` → `/:path*`)이 냈을 답과 같아야 한다: 직원의 옛 북마크는 다리를
 * 거쳐도 종전과 같은 화면에 닿는다. 세그먼트는 주소에서 온 값이라 인코딩하고 점 세그먼트는
 * 버린다 — 실려 온 값이 콘솔 경로 밖을 가리키지 못한다.
 */
export function legacyConsoleStaffPath(surveyId: string, rest: readonly string[]): string {
  const tail = rest
    .filter((segment) => segment !== '' && segment !== '.' && segment !== '..')
    .map((segment) => `/${encodeURIComponent(segment)}`)
    .join('');
  return `/surveys/${encodeURIComponent(surveyId)}/operations${tail}`;
}
