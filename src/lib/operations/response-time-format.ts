/**
 * 운영 현황 콘솔 — A4 응답시간 통계 표를 위한 집계.
 *
 * 파일 구성:
 *   - 본 파일: 타입 정의 + 순수 함수 (`trimmedMean`, `shapeResponseTime`)
 *     서버 의존성 없음 → 단위 테스트 대상.
 *   - server/operations/services/response-time.ts: DB 어댑터 `getResponseTime`.
 *
 * 정책 (plan §5, §10 C):
 *   - 표는 항상 4행 고정: Total / Desktop / Mobile / Pad (tablet → "Pad" 라벨).
 *   - n=0인 행은 모든 통계값을 null로 반환 (호출 측에서 "—" 표기).
 *   - 트리밍 평균: 양 끝에서 floor(n × trim) 만큼 제거 후 평균.
 *     n < 40 (trim=0.025 기준) 이면 floor(n×trim)=0 → 일반 평균과 동일 (C-4).
 *   - 입력의 비유한 값(NaN/Infinity)은 사전 필터 (C-11).
 *   - platform=null 행은 Total에는 포함, 어떤 sub-row에도 들어가지 않음.
 *   - totalSeconds=null 행은 모든 통계에서 제외 (의미 없는 값).
 */

export type Platform = 'desktop' | 'mobile' | 'tablet';

export interface ResponseTimeRow {
  /** label key for the row */
  scope: 'total' | 'desktop' | 'mobile' | 'tablet';
  /** display label, e.g., 'Total' / 'Desktop' / 'Mobile' / 'Pad' */
  label: string;
  /** Number of responses with non-null totalSeconds in this scope */
  n: number;
  /** Mean of all values (in seconds), or null if n=0 */
  avg: number | null;
  /** Mean after dropping the top and bottom 2.5%, or null if n=0 */
  avgTrimmed: number | null;
  /** Minimum (or null) */
  min: number | null;
  /** Maximum (or null) */
  max: number | null;
}

/**
 * 트리밍 평균: 양 끝에서 floor(n × trim) 개 값을 잘라낸 뒤 평균.
 *
 * - 빈 입력 → null.
 * - 단일 값 / 트림 갯수가 0이 되는 작은 표본 → 일반 평균과 동일.
 * - 입력 배열을 변형하지 않는다 (방어적 복사 후 정렬).
 * - 비유한 값(NaN/Infinity)은 사전에 필터링한다.
 */
export function trimmedMean(values: number[], trim: number): number | null {
  const finite = values.filter((v) => Number.isFinite(v));
  if (finite.length === 0) return null;

  const sorted = [...finite].sort((a, b) => a - b);
  const trimCount = Math.floor(sorted.length * trim);
  const sliced = sorted.slice(trimCount, sorted.length - trimCount);
  // sliced.length 가 0이 되는 일은 trim < 0.5 인 한 발생하지 않지만 방어적으로 체크.
  if (sliced.length === 0) return null;

  const sum = sliced.reduce((acc, v) => acc + v, 0);
  return sum / sliced.length;
}

/** 입력 데이터에서 trimmed mean 계산 시 사용하는 기본 trim 비율 (양쪽 2.5%). */
const DEFAULT_TRIM = 0.025;

/** plan §5 — 표는 항상 4행, 고정 순서: Total → Desktop → Mobile → Pad. */
const SCOPE_ORDER: Array<{
  scope: ResponseTimeRow['scope'];
  label: string;
  platform: Platform | null;
}> = [
  { scope: 'total', label: '전체', platform: null },
  { scope: 'desktop', label: '데스크톱', platform: 'desktop' },
  { scope: 'mobile', label: '모바일', platform: 'mobile' },
  { scope: 'tablet', label: '태블릿', platform: 'tablet' },
];

/**
 * 단일 값 배열에서 통계 객체 한 행을 만든다.
 * 빈 배열일 때는 모든 수치값을 null로 반환.
 */
function buildStats(
  scope: ResponseTimeRow['scope'],
  label: string,
  values: number[],
): ResponseTimeRow {
  if (values.length === 0) {
    return { scope, label, n: 0, avg: null, avgTrimmed: null, min: null, max: null };
  }

  const n = values.length;
  const sum = values.reduce((acc, v) => acc + v, 0);
  const avg = sum / n;
  const avgTrimmed = trimmedMean(values, DEFAULT_TRIM);
  let min = Infinity;
  let max = -Infinity;
  for (const v of values) {
    if (v < min) min = v;
    if (v > max) max = v;
  }
  return { scope, label, n, avg, avgTrimmed, min, max };
}

/**
 * 원시 응답 행을 4행 표로 변환한다.
 *
 * 절차:
 *   1. totalSeconds=null 행을 사전 제외 (분석 대상이 아님).
 *   2. 비유한 값은 추가로 제외 (C-11 방어적 처리).
 *   3. Total 버킷에는 platform 무관하게 모두 포함.
 *   4. Desktop/Mobile/Pad 버킷은 platform 일치 행만 포함 (platform=null은 sub-row에 들어가지 않음).
 *   5. 각 버킷에서 buildStats로 통계 객체 생성 → 항상 4행 고정 순서로 반환.
 */
export function shapeResponseTime(
  rows: Array<{ platform: Platform | null; totalSeconds: number | null }>,
): ResponseTimeRow[] {
  // totalSeconds 가 null이거나 비유한 값인 행은 사전 제거.
  const cleaned = rows.filter(
    (r): r is { platform: Platform | null; totalSeconds: number } =>
      r.totalSeconds !== null && Number.isFinite(r.totalSeconds),
  );

  return SCOPE_ORDER.map(({ scope, label, platform }) => {
    const values =
      platform === null
        ? cleaned.map((r) => r.totalSeconds)
        : cleaned.filter((r) => r.platform === platform).map((r) => r.totalSeconds);
    return buildStats(scope, label, values);
  });
}
