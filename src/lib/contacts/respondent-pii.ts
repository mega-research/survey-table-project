import type { PiiFieldType } from '@/lib/crypto/pii-fields';

/**
 * 응답 화면의 명단 값에 개인정보 열 합치기 — 명단에서 개인정보로 암호화된 열(사업자번호 · 이름 …)도
 * attrs 처럼 프리필 토큰(`{{열 이름}}`)·표시 조건이 읽는다. 설정 스위치는 없다.
 * 응답자 브라우저로는 **발행된 설문이 실제로 읽는 열만** 보낸다(`collectReferencedContactKeys`) —
 * 초대 링크만 있으면 쓰지도 않는 남의 연락처까지 꺼내 볼 수 있게 되면 안 되기 때문이다.
 * 서버 재평가는 전부 합쳐도 결과가 같다(설문이 읽지 않는 키는 평가에 쓰이지 않는다).
 * 서버(명단 값 로더)와 테스트가 쓰는 순수 모듈 — 'server-only' 금지.
 */

/**
 * 응답 화면에 낼 값 모양. 사업자번호는 저장 때 숫자만 남겨 두므로(normalizePii) 10자리면
 * `123-45-67890` 으로 되돌린다. 자릿수가 다르거나 다른 종류면 저장된 값 그대로다.
 */
export function formatRespondentPiiValue(fieldType: PiiFieldType, plain: string): string {
  if (fieldType === 'biz_number' && /^\d{10}$/.test(plain)) {
    return `${plain.slice(0, 3)}-${plain.slice(3, 5)}-${plain.slice(5)}`;
  }
  return plain;
}

/**
 * 명단 attrs 에 개인정보 열 값을 덧붙인다. attrs 에 같은 키가 있으면 attrs 가 이기고, 빈 값은 싣지 않는다
 * (키를 만들지 않아야 attrs 에 없던 열이 「빈 값으로 있음」으로 보이지 않는다).
 */
export function mergeRespondentAttrs(
  attrs: Record<string, string>,
  pii: Record<string, string>,
): Record<string, string> {
  const merged: Record<string, string> = { ...attrs };
  for (const [key, value] of Object.entries(pii)) {
    if (key in merged || value === '') continue;
    merged[key] = value;
  }
  return merged;
}

const HTML_ENTITIES: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&nbsp;': ' ',
};

// 명단 토큰 `{{키}}` — 서식본은 키 안에 태그가 낄 수 있다(`{{<strong>키</strong>}}`). 인용 토큰
// `{{{이름}}}` 은 명단 값이 아니라서 먼저 소비해 건너뛴다(substituteTokens 와 같은 단일 패스).
const TOKEN_PATTERN = /\{\{\{(?:[^{}])+\}\}\}|\{\{((?:[^{}<]|<[^>]*>)+)\}\}/g;
// 표시 조건·계산 수식·LUT 키 매핑의 명단 값 참조 — 모두 `attrsKey` 필드다.
const ATTRS_KEY_PATTERN = /"attrsKey":("(?:[^"\\]|\\.)*")/g;

/**
 * 설문 구조(발행 스냅샷 등)가 읽는 명단 값 키. 본문·제목·셀·프리필 템플릿의 `{{키}}` 토큰과
 * 표시 조건·계산 수식의 `attrsKey` 참조를 모은다. 구조 전체를 직렬화해 훑으므로 토큰이 놓인
 * 필드를 하나하나 알 필요가 없다 — 새 필드에 토큰을 쓸 수 있게 돼도 여기를 고치지 않는다.
 */
export function collectReferencedContactKeys(structure: unknown): Set<string> {
  const keys = new Set<string>();
  if (structure == null) return keys;
  const json = JSON.stringify(structure);
  for (const match of json.matchAll(ATTRS_KEY_PATTERN)) {
    const key = (JSON.parse(match[1] as string) as string).trim();
    if (key) keys.add(key);
  }
  for (const match of json.matchAll(TOKEN_PATTERN)) {
    if (match[1] === undefined) continue;
    // 직렬화된 문자열 안이라 따옴표·역슬래시가 이스케이프돼 있다 — 문자열 리터럴로 되돌린다.
    let raw: string;
    try {
      raw = JSON.parse(`"${match[1]}"`) as string;
    } catch {
      raw = match[1];
    }
    const key = raw
      .replace(/<[^>]*>/g, '')
      .replace(/&(?:amp|lt|gt|quot|#39|nbsp);/g, (e) => HTML_ENTITIES[e] ?? e)
      .trim();
    if (key) keys.add(key);
  }
  return keys;
}
