import type { SurveyEndRedirects } from '@/shared/contracts/survey';

/**
 * 종료 후 이동 주소 (패널 연동, surveys.end_redirects 0138).
 *
 * 패널 업체가 보낸 응답자를 결과별 종료 페이지로 돌려보낸다. 저장(서버)과 이동(응답 화면)이
 * 같은 판정을 써야 해서 lib 에 둔다 — 저장이 거른 주소를 화면이 다시 받아들이면 안 된다.
 *
 * 주소는 http(s) 만 받는다. 이 값은 응답자 브라우저의 location 으로 그대로 들어가므로
 * `javascript:` 같은 스킴을 통과시키면 설문 페이지에서 스크립트가 돈다.
 *
 * 이어 넘길 값(passParams): 패널이 링크에 붙여 보낸 회원 식별값(리멤버 `?euid=`)을 종료 주소에
 * 그대로 돌려주고 응답 행에도 남긴다. 어떤 이름을 받을지는 설정이 정하고, 응답 화면(주소 붙이기)과
 * 서버(응답 행 기록)가 같은 pickEntryParams 로 고른다.
 */

/** 응답이 끝난 결과 — 쿼터 마감은 입장·진행 중·제출 시점 어느 쪽이든 하나로 본다. */
export type EndRedirectOutcome = 'completed' | 'screened_out' | 'quota_closed';

/** 결과별 주소 칸 — 이어 넘길 값(passParams)은 주소가 아니다. */
export type EndRedirectUrlKey = Exclude<keyof SurveyEndRedirects, 'passParams'>;

const OUTCOME_KEY: Record<EndRedirectOutcome, EndRedirectUrlKey> = {
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
  // 주소 없이 이름만 있어도 남긴다 — 기록(응답 행)은 주소와 무관하게 쓸모가 있다
  const passParams = normalizePassParamNames(source['passParams']);
  if (passParams.length > 0) result.passParams = passParams;
  return Object.keys(result).length > 0 ? result : null;
}

/**
 * 이 결과로 끝났을 때 보낼 주소. 없으면 null — 종료 화면을 그대로 보인다.
 * 자격미달에 주소가 없을 때 완료 주소로 폴백하지 않는다 — 패널은 완료 주소 도착을 완료로 센다.
 */
export function resolveEndRedirectUrl(
  redirects: SurveyEndRedirects | null | undefined,
  outcome: EndRedirectOutcome,
  entryParams: Readonly<Record<string, string>> = {},
): string | null {
  if (!redirects) return null;
  const url = cleanUrl(redirects[OUTCOME_KEY[outcome]]);
  return url ? appendEntryParams(url, entryParams) : null;
}

// ============================================================
// 이어 넘길 값 (pass-through params)
// ============================================================

/** 설문 하나가 이어 넘길 수 있는 이름 수. 패널 연동에 한두 개면 충분하다. */
export const MAX_PASS_PARAMS = 5;

/**
 * 받을 값 길이 상한. 넘으면 자르지 않고 버린다 — 잘린 회원 ID 는 다른 사람의 ID 다.
 * 서버 입력 검증(domain/response 의 entryParams)도 이 상수를 쓴다.
 */
export const MAX_ENTRY_PARAM_VALUE_LENGTH = 200;

/** 영문자로 시작하는 영문·숫자·`_` `.` `-` 40자 이내. 쿼리 이름으로 흔들림 없이 쓰이는 범위다. */
const PASS_PARAM_NAME_PATTERN = /^[A-Za-z][A-Za-z0-9_.-]{0,39}$/;

/**
 * 우리 링크가 쓰는 쿼리 이름 — 초대 토큰·테스트 토큰을 패널 주소로 흘리면 남이 그 링크로
 * 응답을 이어 쓸 수 있다.
 */
const RESERVED_PARAM_NAMES: ReadonlySet<string> = new Set(['invite', 'test']);

function isPassParamName(name: string): boolean {
  return PASS_PARAM_NAME_PATTERN.test(name) && !RESERVED_PARAM_NAMES.has(name);
}

/** 저장·읽기 정규화 — 규칙에 맞는 이름만 순서대로, 중복 없이, 상한까지. */
export function normalizePassParamNames(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const names: string[] = [];
  for (const item of input) {
    if (typeof item !== 'string') continue;
    const name = item.trim();
    if (!isPassParamName(name) || names.includes(name)) continue;
    names.push(name);
    if (names.length >= MAX_PASS_PARAMS) break;
  }
  return names;
}

/** 빌더 입력칸(「euid, pid」) 해석 — 받을 수 없는 이름은 화면이 짚을 수 있게 따로 돌려준다. */
export function parsePassParamNames(text: string): { names: string[]; invalid: string[] } {
  const tokens = text.split(/[\s,]+/).filter((t) => t !== '');
  return {
    names: normalizePassParamNames(tokens),
    invalid: tokens.filter((t) => !isPassParamName(t)),
  };
}

/**
 * 들어온 값에서 설정된 이름의 값만 고른다. 응답 화면은 주소의 쿼리를, 서버는 클라이언트가
 * 보낸 객체를 넣는다 — 서버는 클라이언트가 고른 것을 믿지 않고 자기가 읽은 설정으로 다시 고른다.
 */
export function pickEntryParams(
  names: readonly string[],
  source: URLSearchParams | Readonly<Record<string, unknown>> | null | undefined,
): Record<string, string> {
  const picked: Record<string, string> = {};
  if (!source) return picked;
  for (const name of names) {
    const raw = source instanceof URLSearchParams ? source.get(name) : source[name];
    if (typeof raw !== 'string') continue;
    const value = raw.trim();
    if (value === '' || value.length > MAX_ENTRY_PARAM_VALUE_LENGTH) continue;
    picked[name] = value;
  }
  return picked;
}

/** 종료 주소에 값을 붙인다. 같은 이름이 주소에 이미 있으면 들어온 값으로 바꾼다. */
export function appendEntryParams(
  url: string,
  entryParams: Readonly<Record<string, string>>,
): string {
  const entries = Object.entries(entryParams);
  if (entries.length === 0) return url;
  const target = new URL(url);
  for (const [name, value] of entries) target.searchParams.set(name, value);
  return target.toString();
}

/**
 * 응답 행 metadata.entryParams 읽기 (내보내기). 문자열 값만 받고 남는 것이 없으면 undefined.
 * 쓰는 쪽은 response-entry 하나다 — 저장 모양이 바뀌면 둘을 같이 볼 것.
 */
export function readEntryParams(metadata: unknown): Record<string, string> | undefined {
  if (metadata === null || typeof metadata !== 'object') return undefined;
  return readStoredEntryParams((metadata as Record<string, unknown>)['entryParams']);
}

/** metadata.entryParams 칸 값 자체 읽기 — 응답 내역 목록처럼 그 칸만 꺼내 온 경우. */
export function readStoredEntryParams(stored: unknown): Record<string, string> | undefined {
  if (stored === null || typeof stored !== 'object' || Array.isArray(stored)) return undefined;
  const params: Record<string, string> = {};
  for (const [name, value] of Object.entries(stored)) {
    if (typeof value === 'string') params[name] = value;
  }
  return Object.keys(params).length > 0 ? params : undefined;
}
