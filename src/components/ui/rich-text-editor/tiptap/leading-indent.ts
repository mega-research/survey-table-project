/**
 * 문단·줄 시작의 일반 스페이스를 &nbsp; 로 치환해 들여쓰기를 보존한다.
 *
 * HTML 공백 접기 규칙상 블록 시작(<p> 직후)이나 줄바꿈(<br>) 직후의 일반 스페이스는
 * 렌더링에서 사라지고, ProseMirror DOMParser 도 콘텐츠 재로드 시 같은 규칙으로 접는다.
 * 에디터에서 타이핑한 들여쓰기 스페이스가 "저장 후 풀리는" 원인 — 직렬화 시점에
 * &nbsp; 로 바꿔야 에디터 왕복과 응답 페이지 렌더 양쪽에서 살아남는다.
 *
 * 치환 범위는 <p>/<br> 뒤에 여는 인라인 태그(span/strong 등)만 사이에 둔 스페이스 런으로
 * 한정한다. <img> 등 void 요소가 끼면 그 뒤 스페이스는 줄 중간 공백이므로 건드리지 않는다.
 */
const LEADING_SPACE_RE = /(<(?:p|br)\b[^>]*>(?:<(?!\/|img\b|br\b)[^>]*>)*)((?:&nbsp;| )+)/gi;

export function preserveLeadingIndent(html: string): string {
  return html.replace(LEADING_SPACE_RE, (_match, prefix: string, run: string) => {
    return prefix + run.replace(/ /g, '&nbsp;');
  });
}
