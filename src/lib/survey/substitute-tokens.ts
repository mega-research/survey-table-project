/**
 * 템플릿 안의 토큰을 두 채널로 나눠 치환한다.
 *
 * - `{{{인용이름}}}` → quotes[인용이름]  (응답 인용 — 앞 질문의 응답에서 계산된 파생값)
 * - `{{키}}`         → attrs[키]        (컨택 attrs — 운영자가 업로드한 명단 값)
 *
 * 메일 시스템의 {{var}} 치환과 이중괄호 syntax 가 같고, 응답 페이지 본문(notice/description/
 * table cell)과 단답형 prefill 평가에 공통 사용된다.
 *
 * - 미해결 키는 빈 문자열로 치환 (메일 mode='send' 와 동일 — 운영자에게 발송 결과 깨짐 방지)
 * - 키 좌우 공백 자동 trim ({{ name }} == {{name}})
 * - escape 없음 — HTML 컨텍스트에서 값에 사용자 입력이 들어갈 가능성 있으면 호출자가 sanitize
 *
 * **반드시 단일 패스로 유지할 것.** 채널별로 두 번 훑으면, 응답자가 기타 입력칸에 친 `{{키}}`
 * 가 인용값으로 본문에 꽂힌 뒤 두 번째 패스에서 컨택 attrs 로 치환되어 남의 명단 값이 노출된다.
 * alternation 하나로 한 번만 훑으면 치환된 자리를 다시 읽지 않으므로 원천 차단된다.
 *
 * 문자 클래스가 `[^{}]+` 인 것도 필수다. `[^}]+` 이면 `{{{X}}}` 에서 여는 중괄호까지 삼켜
 * `"[{X]}"` 로 망가진다.
 */
const TOKEN_PATTERN = /\{\{\{([^{}]+)\}\}\}|\{\{([^{}]+)\}\}/g;

export function substituteTokens(
  template: string,
  attrs: Record<string, string>,
  quotes: Record<string, string> = {},
): string {
  if (!template) return '';
  return template.replace(TOKEN_PATTERN, (_match, quoteKey?: string, attrsKey?: string) => {
    if (quoteKey !== undefined) return quotes[quoteKey.trim()] ?? '';
    return attrs[(attrsKey ?? '').trim()] ?? '';
  });
}
