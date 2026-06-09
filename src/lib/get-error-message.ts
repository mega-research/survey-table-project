/**
 * 에러 객체에서 사용자 표시용 메시지를 추출한다.
 *
 * 기존 컴포넌트들이 catch 블록에서 제각각 쓰던
 * `err instanceof Error ? err.message : fallback` 패턴을 한 곳으로 통일한 헬퍼.
 *
 * - `err` 가 Error 인스턴스면 그 `message` 를 그대로 반환.
 * - 그 외(문자열·unknown 등)는 `fallback` 을 반환.
 */
export function getErrorMessage(err: unknown, fallback: string): string {
  return err instanceof Error ? err.message : fallback;
}
