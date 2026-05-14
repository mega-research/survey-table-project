/**
 * 템플릿 안의 {{key}} 토큰을 attrs[key] 값으로 치환.
 * 메일 시스템의 {{var}} 치환과 동일한 syntax로, 응답 페이지 본문(notice/description/table cell)과
 * 단답형 prefill 평가에 공통 사용된다.
 *
 * - 미해결 키는 빈 문자열로 치환 (메일 mode='send'와 동일 — 운영자에게 발송 결과 깨짐 방지)
 * - 키 좌우 공백 자동 trim ({{ name }} == {{name}})
 * - escape 없음 — HTML 컨텍스트에서 attrs 값에 사용자 입력이 들어갈 가능성 있으면 호출자가 sanitize
 */
export function substituteTokens(template: string, attrs: Record<string, string>): string {
  if (!template) return '';
  return template.replace(/\{\{([^}]+)\}\}/g, (_, rawKey) => {
    const key = rawKey.trim();
    return attrs[key] ?? '';
  });
}
