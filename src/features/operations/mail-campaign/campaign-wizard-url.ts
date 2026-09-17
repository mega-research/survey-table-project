/**
 * 단체 메일 마법사 URL 헬퍼 — server-only 의존 없는 순수 모듈.
 */

/**
 * templateId 미지정 진입 시 리다이렉트할 쿼리 문자열.
 *
 * 기존 쿼리를 전부 보존한 채 templateId 만 채운다. 통째로 버리면 캠페인 상세의
 * "미응답자 재발송" 동선이 필터(col/q/op, hcol/hm/hv)·미응답 토글·자동 전체선택을
 * 모두 잃는다. 템플릿이 hard-delete 된 캠페인은 mail_template_id 가 NULL(FK SET NULL)
 * 이라 빈 templateId 로 이 경로에 실제로 진입한다.
 */
export function buildTemplateRedirectQuery(
  searchParams: Record<string, string | string[] | undefined>,
  templateId: string,
): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(searchParams)) {
    if (value === undefined) continue;
    if (key === 'templateId') continue; // 아래에서 확정값으로 한 번만 세팅
    for (const v of Array.isArray(value) ? value : [value]) params.append(key, v);
  }
  params.set('templateId', templateId);
  return params.toString();
}
