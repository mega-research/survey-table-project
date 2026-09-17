/**
 * mail-cost 컴포넌트 공용 포매터.
 *
 * 한국어 통화/숫자 표시 일관성을 위해 한 곳에 모음. 날짜·시각은 src/lib/date-formatters
 * 와 <LocalDateTime /> 사용.
 */

export function formatKrw(n: number): string {
  return `${n.toLocaleString('ko-KR')}원`;
}

export function formatInt(n: number): string {
  return n.toLocaleString('ko-KR');
}
