/**
 * 명단 이메일 칸 하나 → 발송 받는 사람 목록.
 *
 * 고객 명단에는 한 칸에 주소를 여럿 적은 값(「a@x.com / b@y.com」·「a@x.com, b@y.com」·줄바꿈으로 두 줄)과
 * 주소 가운데서 줄이 바뀐 값(「abcd@⏎example.kr」)이 섞여 온다. 칸을 통째로 주소 하나로 넘기면 메일 서비스가
 * `Invalid to field` 로 거부한다(2026-10-16 예술기업 후속조사 13명). 그래서 발송 직전에 나눠 메일 한 통의
 * 받는 사람 여러 명으로 보낸다 — 같은 조사 대상이라 초대 링크도 같다. 명단 값 자체는 바꾸지 않는다.
 *
 * 규칙: `/` `,` `;` 로 먼저 나누고, 조각 안에 `@` 가 하나면 공백·줄바꿈을 지워 한 주소로 붙이고, 둘 이상이면
 * 공백·줄바꿈으로 다시 나눈다. `@` 와 도메인 점이 있는 것만 남기고 대소문자 무시로 중복을 뺀다.
 * 하나도 못 건지면 빈 배열 — 호출부가 원래 값으로 보내 종전처럼 실패로 기록되게 한다(조용히 빠지지 않게).
 */

/** 메일 서비스(Resend)가 한 통에 받는 받는 사람 수 상한. */
export const MAX_RECIPIENTS_PER_MAIL = 50;

const LOOKS_LIKE_ADDRESS = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function splitEmailAddresses(raw: string): string[] {
  const tokens: string[] = [];
  for (const chunk of raw.split(/[/,;]/)) {
    const atCount = (chunk.match(/@/g) ?? []).length;
    if (atCount === 0) continue;
    if (atCount === 1) tokens.push(chunk.replace(/\s+/g, ''));
    else tokens.push(...chunk.split(/\s+/));
  }
  const seen = new Set<string>();
  const result: string[] = [];
  for (const token of tokens) {
    const address = token.trim();
    if (!LOOKS_LIKE_ADDRESS.test(address)) continue;
    const key = address.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(address);
  }
  return result.slice(0, MAX_RECIPIENTS_PER_MAIL);
}

/** 발송 `to` 값 — 나눌 수 있으면 나눈 목록, 못 건지면 원래 값 하나(메일 서비스가 거부해 실패로 남는다). */
export function mailToList(raw: string): string[] {
  const addresses = splitEmailAddresses(raw);
  return addresses.length > 0 ? addresses : [raw];
}
