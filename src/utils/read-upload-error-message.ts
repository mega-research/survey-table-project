/**
 * 업로드 실패 응답 본문에서 서버 메시지를 뽑는다. 비-JSON 이면 fallback.
 *
 * XHR load 핸들러 안에 있던 중첩 try/catch 를 그대로 옮긴 것이다 — try 본문의
 * optional chaining 은 React Compiler 가 낮추지 못해 컴포넌트 전체를 skip 시킨다.
 */
export function readUploadErrorMessage(responseText: string, fallback: string): string {
  try {
    const parsed = JSON.parse(responseText);
    if (parsed?.error) return String(parsed.error);
  } catch {
    // 비-JSON 응답은 기본 메시지 사용
  }
  return fallback;
}
