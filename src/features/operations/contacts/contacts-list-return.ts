/**
 * 조사 대상 목록 ↔ 단건 편집 사이에서 목록의 페이지·필터·정렬을 잃지 않게 하는 주소 조립.
 *
 * 목록 상태는 전부 목록 주소의 쿼리(page·sort·dir·col·q·op·hcol·hm·hv)에 있다. 행을 눌러 단건으로 갈 때
 * 그 쿼리를 통째로 `list` 파라미터에 실어 가고, 「목록」·삭제 뒤 이동은 그것으로 목록 주소를 다시 만든다.
 * 브라우저 뒤로가기(router.back)를 쓰지 않는 것은 저장·새 대상 생성 뒤 이동이나 링크로 바로 연 경우
 * 「뒤」가 목록이 아니기 때문이다. 경로는 고정이고 쿼리만 이어 붙이므로 바깥 주소로 새지 않는다.
 */
export const LIST_QUERY_PARAM = 'list';

/** 목록 주소 — listQuery 가 없으면 첫 페이지 목록이다. */
export function contactsListHref(surveyId: string, listQuery: string | null | undefined): string {
  const base = `/admin/surveys/${surveyId}/operations/contacts`;
  return listQuery ? `${base}?${listQuery.replace(/^\?/, '')}` : base;
}

/** 단건(또는 새 대상) 주소에 목록 쿼리를 실어 보낸다. contactPath 는 contactId 또는 'new'. */
export function contactDetailHref(
  surveyId: string,
  contactPath: string,
  listQuery: string | null | undefined,
): string {
  const base = `/admin/surveys/${surveyId}/operations/contacts/${contactPath}`;
  return listQuery
    ? `${base}?${new URLSearchParams({ [LIST_QUERY_PARAM]: listQuery }).toString()}`
    : base;
}

/** RSC 의 searchParams 객체 → 목록 쿼리 문자열 (배열 값은 같은 키로 반복). */
export function listQueryFromSearchParams(
  sp: Record<string, string | string[] | undefined>,
): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(sp)) {
    if (value === undefined) continue;
    for (const v of Array.isArray(value) ? value : [value]) query.append(key, v);
  }
  return query.toString();
}
