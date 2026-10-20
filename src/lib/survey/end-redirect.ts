import type { SurveyEndRedirects } from '@/shared/contracts/survey';

/**
 * 종료 후 이동 주소 (패널 연동, surveys.end_redirects 0138).
 *
 * 패널 업체가 보낸 응답자를 결과별 종료 페이지로 돌려보낸다. 저장(서버)과 이동(응답 화면)이
 * 같은 판정을 써야 해서 lib 에 둔다 — 저장이 거른 주소를 화면이 다시 받아들이면 안 된다.
 *
 * 주소는 http(s) 만 받는다. 이 값은 응답자 브라우저의 location 으로 그대로 들어가므로
 * `javascript:` 같은 스킴을 통과시키면 설문 페이지에서 스크립트가 돈다.
 */

/** 응답이 끝난 결과 — 쿼터 마감은 입장·진행 중·제출 시점 어느 쪽이든 하나로 본다. */
export type EndRedirectOutcome = 'completed' | 'screened_out' | 'quota_closed';

const OUTCOME_KEY: Record<EndRedirectOutcome, keyof SurveyEndRedirects> = {
  completed: 'completed',
  screened_out: 'screenedOut',
  quota_closed: 'quotaClosed',
};

/** http(s) 절대 주소인가. 앞뒤 공백은 호출자가 걷는다. */
export function isEndRedirectUrl(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  return url.protocol === 'http:' || url.protocol === 'https:';
}

function cleanUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed !== '' && isEndRedirectUrl(trimmed) ? trimmed : null;
}

/**
 * 저장 직전 정규화 — 공백을 걷고 http(s) 가 아닌 주소는 버린다. 남는 것이 없으면 null.
 * 설정 입력은 런타임 검증이 없는 z.custom 이라 여기가 유일한 관문이다.
 */
export function normalizeEndRedirects(input: unknown): SurveyEndRedirects | null {
  if (input === null || typeof input !== 'object') return null;
  const source = input as Record<string, unknown>;
  const result: SurveyEndRedirects = {};
  for (const key of Object.values(OUTCOME_KEY)) {
    const url = cleanUrl(source[key]);
    if (url) result[key] = url;
  }
  return Object.keys(result).length > 0 ? result : null;
}

/**
 * 이 결과로 끝났을 때 보낼 주소. 없으면 null — 종료 화면을 그대로 보인다.
 * 자격미달에 주소가 없을 때 완료 주소로 폴백하지 않는다 — 패널은 완료 주소 도착을 완료로 센다.
 */
export function resolveEndRedirectUrl(
  redirects: SurveyEndRedirects | null | undefined,
  outcome: EndRedirectOutcome,
): string | null {
  if (!redirects) return null;
  return cleanUrl(redirects[OUTCOME_KEY[outcome]]);
}
