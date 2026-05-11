/**
 * body_html / subject / from_name 에서 사용된 변수 토큰 키 추출.
 * 같은 키 반복은 중복 제거. 발송 시 검증/UX 캐시.
 */
export function extractVariableKeys(...sources: string[]): string[] {
  const set = new Set<string>();
  const re = /\{\{([^}]+)\}\}/g;
  for (const s of sources) {
    let m: RegExpExecArray | null;
    re.lastIndex = 0;
    while ((m = re.exec(s)) !== null) {
      set.add(m[1].trim());
    }
  }
  return Array.from(set);
}
