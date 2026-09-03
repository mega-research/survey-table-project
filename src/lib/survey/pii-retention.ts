/**
 * 개인정보 보관기한 KST 변환 (ADR-0012, 그릴링 Q2 결정: 해당일 포함)
 *
 * 관리자는 날짜('YYYY-MM-DD')만 입력하고, "그 날짜의 KST 하루가 끝날 때까지 보유"로
 * 해석한다. 저장 timestamp = KST 익일 0시 = 해당일 15:00 UTC. 파기 스윕 조건은
 * pii_retention_until < now() 그대로 사용한다.
 */

const KST_END_OF_DAY_UTC_HOUR = 15; // KST 익일 0시 == 해당일 15:00 UTC

export function retentionDateToTimestamp(dateStr: string): Date {
  return new Date(`${dateStr}T${String(KST_END_OF_DAY_UTC_HOUR).padStart(2, '0')}:00:00.000Z`);
}

export function retentionTimestampToDate(ts: Date): string {
  // 역변환: 15시간을 빼면 UTC 날짜부가 입력 날짜와 일치한다.
  const shifted = new Date(ts.getTime() - KST_END_OF_DAY_UTC_HOUR * 3600 * 1000);
  return shifted.toISOString().slice(0, 10);
}

/**
 * 보관기한이 지난 PII 를 파기할 때 값 자리에 남기는 표식.
 *
 * 마이그레이션(`0050`, `0095`)의 sweep 이 암호문 자리에 이 문자열을 넣는다. 값이
 * 사라졌다는 사실은 남기되 원문은 복원할 수 없게 하는 표식이라, **응답으로 다시
 * 흘러들어가서는 안 된다** — 읽기 경계가 이 상수로 걸러낸다.
 */
export const PII_REDACTED_MARKER = '[개인정보 파기됨]';

/** 이 값이 파기 표식인가. */
export function isPiiRedactedValue(value: unknown): boolean {
  return value === PII_REDACTED_MARKER;
}
