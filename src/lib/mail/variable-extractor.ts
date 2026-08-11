/**
 * body_html / subject / from_name 에서 사용된 변수 토큰 키 추출.
 * 같은 키 반복은 중복 제거. 발송 시 검증/UX 캐시.
 *
 * 소스 목록은 인자가 아니라 배열 하나로 받는다 — rest 파라미터 + spread 호출은
 * 입력이 설문 전체 텍스트(수만 개)일 때 V8 인자 상한에 걸려 RangeError(Maximum
 * call stack size exceeded)를 던진다 (대형 설문 편집 화면 크래시, Sentry 7665334735).
 */
export function extractVariableKeys(sources: readonly string[]): string[] {
  const set = new Set<string>();
  const re = /\{\{([^}]+)\}\}/g;
  for (const s of sources) {
    let m: RegExpExecArray | null;
    re.lastIndex = 0;
    while ((m = re.exec(s)) !== null) {
      const key = m[1];
      if (key !== undefined) set.add(key.trim());
    }
  }
  return Array.from(set);
}
