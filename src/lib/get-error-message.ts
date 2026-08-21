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

/**
 * RPC 결과의 `error` 필드처럼 null 가능한 문자열을 폴백과 함께 해석한다.
 *
 * try 본문에 `result.error ?? '...'` 를 직접 쓰면 React Compiler 가 try/catch 안의
 * value block 을 낮추지 못해 컴포넌트 전체가 skip 된다. 호출로 바꾸면 try 가 덮는
 * 범위는 그대로 두고 value block 만 없앨 수 있다.
 */
export function resultErrorMessage(error: string | null | undefined, fallback: string): string {
  return error ?? fallback;
}
