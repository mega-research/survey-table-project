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

/**
 * HTML 서식본용 토큰 치환 — 서식이 토큰 안쪽이나 경계에 걸쳐도 원래 키로 치환한다.
 *
 * 편집기에서 `{{회사}}` 의 `회사` 만 굵게 하면 서식본은 `{{<strong>회사</strong>}}` 가 되고,
 * 키에 `&` 가 있으면 `{{R&amp;D}}` 가 된다. 평문용 substituteTokens 를 그대로 걸면 태그·엔티티가
 * 키에 섞여 조회에 실패하고 값이 빈 문자열로 사라진다.
 *
 * - 토큰 안의 태그는 순서대로 모두 남긴다 — 글자만 값으로 바꾸므로 태그 짝이 깨지지 않는다.
 *   첫 글자 앞의 태그는 값 앞에, 나머지는 값 뒤에 둔다(`{{<strong>회사</strong>}}` → `<strong>메가</strong>`).
 * - 키는 태그를 빼고 엔티티를 푼 글자다. 값은 HTML 이스케이프해 넣는다(서식본은 HTML 컨텍스트다).
 * - 평문 치환과 같이 단일 패스다 — 치환한 자리를 다시 읽지 않는다.
 */
const HTML_TOKEN_PATTERN =
  /\{\{\{((?:[^{}<]|<[^>]*>)+)\}\}\}|\{\{((?:[^{}<]|<[^>]*>)+)\}\}/g;
const TAG_PATTERN = /<[^>]*>/g;
const HTML_ENTITY_DECODE: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&nbsp;': ' ',
};

function escapeHtmlText(text: string): string {
  return text.replace(/[&<>"']/g, (ch) =>
    ch === '&' ? '&amp;' : ch === '<' ? '&lt;' : ch === '>' ? '&gt;' : ch === '"' ? '&quot;' : '&#39;',
  );
}

export function substituteTokensInHtml(
  html: string,
  attrs: Record<string, string>,
  quotes: Record<string, string> = {},
): string {
  if (!html) return '';
  return html.replace(HTML_TOKEN_PATTERN, (_match, quoteInner?: string, attrsInner?: string) => {
    const inner = quoteInner ?? attrsInner ?? '';
    const key = inner
      .replace(TAG_PATTERN, '')
      .replace(/&(?:amp|lt|gt|quot|#39|nbsp);/g, (m) => HTML_ENTITY_DECODE[m] ?? m)
      .trim();
    const value = quoteInner !== undefined ? (quotes[key] ?? '') : (attrs[key] ?? '');
    const tags = inner.match(TAG_PATTERN) ?? [];
    // 첫 글자(태그가 아닌 문자) 앞에 연속으로 붙은 태그만 값 앞에 둔다.
    const leading: string[] = [];
    let rest = inner;
    for (;;) {
      const m = /^<[^>]*>/.exec(rest);
      if (!m) break;
      leading.push(m[0]);
      rest = rest.slice(m[0].length);
    }
    const trailing = tags.slice(leading.length);
    return leading.join('') + escapeHtmlText(value) + trailing.join('');
  });
}
