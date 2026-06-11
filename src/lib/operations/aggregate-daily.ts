/**
 * 운영 현황 콘솔 — A2 일자별 참여자수 차트를 위한 시계열 집계.
 *
 * 파일 구성:
 *   - 본 파일: 타입 정의 + 순수 변환 함수 `shapeDailyBuckets` (서버 의존성 없음 → 테스트 가능)
 *   - `aggregate-daily.server.ts`: 실제 DB 호출 어댑터 `aggregateDaily` /
 *     `aggregateDailyAvailableDates` (KST 기반 SQL).
 *
 * 정책 (plan §9):
 *   - day 모드: 응답이 존재하는 날짜의 min~max 사이를 모두 채워 연속 x축으로 만든다 (gap = 0).
 *   - hour 모드: 선택된 일자(KST)의 24시간 분포를 항상 24개 버킷으로 반환한다.
 *   - 시간대는 SQL `AT TIME ZONE 'Asia/Seoul'` 으로 고정 — JS Date 산술에 의존하지 않는다.
 */

export type DailyMode = 'day' | 'hour';

export interface DailyBucket {
  /** 'YYYY-MM-DD' (day 모드) | 'YYYY-MM-DD HH:00' (hour 모드, KST). */
  bucket: string;
  /** 라벨 — day 모드: 'MM-DD (요일)', hour 모드: 'HH시'. */
  label: string;
  count: number;
}

export interface DailyRow {
  /** day 모드: 'YYYY-MM-DD' / hour 모드: 'YYYY-MM-DD HH:00' */
  bucket: string;
  count: number;
}

const KOREAN_WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'] as const;

/**
 * 'YYYY-MM-DD' → 'MM-DD (요일)' 라벨 변환.
 * KST는 SQL에서 이미 적용되어 들어오므로, JS Date의 시차 보정은 불필요하다.
 * (Date 생성자에 'YYYY-MM-DD'만 주면 UTC midnight으로 해석되지만,
 *  요일 추출은 UTC 기준이어도 일관되므로 문제 없음.)
 */
export function formatDayLabel(ymd: string): string {
  const [, mm, dd] = ymd.split('-');
  // UTC 기준으로 요일을 뽑되, 모든 입력에 동일하게 적용되므로 일관성 보장.
  const date = new Date(`${ymd}T00:00:00Z`);
  const weekday = KOREAN_WEEKDAYS[date.getUTCDay()] ?? '';
  return `${mm}-${dd} (${weekday})`;
}

/** 'YYYY-MM-DD HH:00' → 'HH시' */
function formatHourLabel(bucket: string): string {
  // bucket: 'YYYY-MM-DD HH:00'
  const hourPart = bucket.slice(11, 13);
  return `${hourPart}시`;
}

/** 'YYYY-MM-DD' 두 개 사이의 모든 날짜를 (포함하여) 오름차순 배열로 반환. */
function enumerateDays(startYmd: string, endYmd: string): string[] {
  const out: string[] = [];
  const start = new Date(`${startYmd}T00:00:00Z`);
  const end = new Date(`${endYmd}T00:00:00Z`);
  for (
    let cursor = new Date(start);
    cursor.getTime() <= end.getTime();
    cursor.setUTCDate(cursor.getUTCDate() + 1)
  ) {
    const yyyy = cursor.getUTCFullYear();
    const mm = String(cursor.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(cursor.getUTCDate()).padStart(2, '0');
    out.push(`${yyyy}-${mm}-${dd}`);
  }
  return out;
}

/**
 * 순수 함수: 원시 bucket 행을 차트 데이터로 변환한다.
 *
 * - day 모드: rows 가 비어 있으면 빈 배열을 반환. 그렇지 않으면 min~max 사이를
 *   모두 채워 연속된 일자 배열을 만든다 (없는 날은 count = 0).
 * - hour 모드: `hourModeDate` (YYYY-MM-DD) 가 필요하다. 항상 24개 버킷
 *   ('00시'~'23시') 을 반환하고 누락된 시간은 count = 0 으로 채운다.
 */
export function shapeDailyBuckets(
  rows: DailyRow[],
  mode: DailyMode,
  hourModeDate?: string,
): DailyBucket[] {
  if (mode === 'day') {
    if (rows.length === 0) return [];
    const sorted = [...rows].sort((a, b) => (a.bucket < b.bucket ? -1 : 1));
    const map = new Map<string, number>();
    for (const r of sorted) map.set(r.bucket, r.count);
    const firstBucket = sorted[0]?.bucket ?? '';
    const lastBucket = sorted[sorted.length - 1]?.bucket ?? '';
    const days = enumerateDays(firstBucket, lastBucket);
    return days.map((ymd) => ({
      bucket: ymd,
      label: formatDayLabel(ymd),
      count: map.get(ymd) ?? 0,
    }));
  }

  // hour 모드
  if (!hourModeDate) {
    // 호출자 실수 — 빈 배열을 반환하는 대신 24버킷 0 응답으로 graceful 처리할 수도 있지만,
    // 잘못된 호출을 조용히 삼키면 디버깅이 어렵다. 명시적 에러가 더 안전하다.
    throw new Error('shapeDailyBuckets(hour) requires hourModeDate');
  }
  const map = new Map<string, number>();
  for (const r of rows) map.set(r.bucket, r.count);
  const out: DailyBucket[] = [];
  for (let h = 0; h < 24; h++) {
    const hh = String(h).padStart(2, '0');
    const bucket = `${hourModeDate} ${hh}:00`;
    out.push({
      bucket,
      label: formatHourLabel(bucket),
      count: map.get(bucket) ?? 0,
    });
  }
  return out;
}
