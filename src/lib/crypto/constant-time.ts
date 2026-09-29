import { timingSafeEqual } from 'node:crypto';

/**
 * 상수시간 문자열 비교 — 비밀값 대조의 공용 규칙 (ADR-0026).
 *
 * `timingSafeEqual` 은 **길이가 다르면 던진다.** 그래서 호출부마다 「먼저 길이를 본다」를 다시
 * 쓰게 되는데, 그 한 줄이 두 곳에 있으면 한쪽만 고쳐지는 날 그쪽이 조용히 예외를 던지거나
 * 비교 자체를 건너뛴다. 규칙을 한 자리에 둔다.
 *
 * 길이는 새는 정보이고 그것을 받아들인 것이다 — 이 함수를 쓰는 두 값(HMAC 서명, 외주 실사
 * 링크의 공유 비밀번호)은 길이가 알려져도 추측에 도움이 되지 않는다.
 */
export function constantTimeEquals(expected: string, given: string): boolean {
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(given, 'utf8');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
