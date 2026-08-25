/**
 * 운영 현황 콘솔 — A3 일자별 통계 표를 위한 일자별 집계.
 *
 * 파일 구성:
 *   - 본 파일: 타입 정의 + 순수 변환 함수 `shapeDailyStats` (서버 의존성 없음 → 테스트 가능)
 *   - server/operations/services/daily-stats.ts: 실제 DB 호출 어댑터 `getDailyStats` (KST 기반 SQL).
 *
 * 정책 (plan §5):
 *   - 기본 정렬: 일자 내림차순 (최근부터) — 목업 p1 "시간별 전환" 표와 동일.
 *   - completionRate / columnPct 는 분모 0일 때 null (호출 측에서 "—" 표시).
 *   - 라벨은 KST 기준 'YYYY-MM-DD (요일)' — 컬럼 정렬은 underlying `date` 문자열에 한다.
 */

export interface DailyStatsRow {
  /** YYYY-MM-DD (KST) */
  date: string;
  /** Display label e.g., '2026-04-27 (월)' */
  label: string;
  total: number;
  completed: number;
  /** completed / total — total=0 이면 null */
  completionRate: number | null;
  /** total / overallTotal — overallTotal=0 이면 null */
  columnPct: number | null;
  drop: number;
}

export interface DailyStatsRawRow {
  /** YYYY-MM-DD (KST) — DB에서 그대로 전달 */
  date: string;
  total: number;
  completed: number;
  drop: number;
}

const KOREAN_WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'] as const;

/**
 * 'YYYY-MM-DD' → 'YYYY-MM-DD (요일)' 라벨.
 * KST 변환은 SQL 단계에서 끝난다 — JS Date는 UTC 기준 요일만 추출하면 일관된다.
 */
function formatStatsLabel(ymd: string): string {
  const date = new Date(`${ymd}T00:00:00Z`);
  const weekday = KOREAN_WEEKDAYS[date.getUTCDay()];
  return `${ymd} (${weekday})`;
}

/**
 * 순수 함수: 원시 DB 행을 표 데이터로 변환한다.
 *
 * - completionRate: completed / total. total === 0 → null.
 * - columnPct: total / overallTotal. overallTotal === 0 → null.
 *   (분모가 0이라는 건 입력 자체가 빈 배열이라는 뜻이므로 실질적 영향은 없지만,
 *    방어적으로 0 분모를 처리해 NaN/Infinity 누출을 막는다.)
 * - 정렬: date 내림차순 (lexical 정렬은 YYYY-MM-DD 형식에 안전하다).
 */
export function shapeDailyStats(rows: DailyStatsRawRow[]): DailyStatsRow[] {
  const overallTotal = rows.reduce((acc, r) => acc + r.total, 0);

  return rows
    .map((r) => {
      const completionRate = r.total === 0 ? null : r.completed / r.total;
      const columnPct = overallTotal === 0 ? null : r.total / overallTotal;
      return {
        date: r.date,
        label: formatStatsLabel(r.date),
        total: r.total,
        completed: r.completed,
        completionRate,
        columnPct,
        drop: r.drop,
      };
    })
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
}
