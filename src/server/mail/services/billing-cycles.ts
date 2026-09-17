/**
 * 사이클 경계 계산 — KST(Asia/Seoul) 고정. 순수 함수만 모았다(server-only 의존성 없음).
 *
 * Period 시계열을 받아 임의 시각이 어느 사이클에 속하는지, 그 사이클의 다음 시작은 언제인지 계산한다.
 * 요금제 변경/결제일 변경이 사이클 경계에 미치는 영향을 한 곳에서 처리.
 */

export const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

export interface PeriodSpec {
  /** KST 자정의 UTC ms — 이 시각부터 이 period 가 적용됨 (포함). */
  startUtcMs: number;
  /** "YYYY-MM-DD" (KST). 디버깅·표시용. */
  startDateLabel: string;
  /** 매달 결제일 (1~28). */
  billingDay: number;
  /** plan 정보 — freezing 용. */
  planLabel: string;
  monthlyFeeKrw: number;
  includedEmails: number;
  overagePer1kKrw: number;
}

export interface PeriodInputRow {
  startDate: string; // YYYY-MM-DD
  billingDayOfMonth: number;
  planLabel: string;
  monthlyFeeKrw: number;
  includedEmails: number;
  overagePer1kKrw: number;
}

/** Period 등록이 0건일 때 사용할 fallback (모든 금액 0, 결제일 15, 포함량 0 → 비용 0 표시). */
export const FALLBACK_PERIOD: PeriodSpec = {
  startUtcMs: Date.UTC(1970, 0, 1) - KST_OFFSET_MS,
  startDateLabel: '1970-01-01',
  billingDay: 15,
  planLabel: '미등록',
  monthlyFeeKrw: 0,
  includedEmails: 0,
  overagePer1kKrw: 0,
};

export function toPeriodSpecs(rows: readonly PeriodInputRow[]): PeriodSpec[] {
  if (rows.length === 0) return [FALLBACK_PERIOD];
  // 입력은 startDate ASC 정렬되어 있다고 가정. 방어적으로 sort.
  const sorted = [...rows].sort((a, b) => a.startDate.localeCompare(b.startDate));
  return sorted.map((r) => ({
    startUtcMs: parseDateToKstMidnightUtcMs(r.startDate),
    startDateLabel: r.startDate,
    billingDay: r.billingDayOfMonth,
    planLabel: r.planLabel,
    monthlyFeeKrw: r.monthlyFeeKrw,
    includedEmails: r.includedEmails,
    overagePer1kKrw: r.overagePer1kKrw,
  }));
}

export function findPeriodFor(at: Date, periods: readonly PeriodSpec[]): PeriodSpec {
  // periods 는 startUtcMs ASC. at 보다 같거나 빠른 것 중 가장 늦은 것.
  let result = periods[0]!;
  const atMs = at.getTime();
  for (const p of periods) {
    if (p.startUtcMs <= atMs) result = p;
    else break;
  }
  return result;
}

export function cycleStartFor(at: Date, periods: readonly PeriodSpec[]): Date {
  const period = findPeriodFor(at, periods);
  const kst = new Date(at.getTime() + KST_OFFSET_MS);
  const y = kst.getUTCFullYear();
  const m = kst.getUTCMonth();
  const d = kst.getUTCDate();

  let cy = y;
  let cm = m;
  if (d < period.billingDay) {
    cm -= 1;
    if (cm < 0) {
      cm = 11;
      cy -= 1;
    }
  }
  let cycleUtcMs = Date.UTC(cy, cm, period.billingDay) - KST_OFFSET_MS;

  // 사이클 시작이 적용 period 의 startDate 보다 이르면 → period.startDate 가 사이클 시작 (transition).
  if (cycleUtcMs < period.startUtcMs) {
    cycleUtcMs = period.startUtcMs;
  }
  return new Date(cycleUtcMs);
}

export function nextCycleStart(cycleStart: Date, periods: readonly PeriodSpec[]): Date {
  const period = findPeriodFor(cycleStart, periods);
  const kst = new Date(cycleStart.getTime() + KST_OFFSET_MS);
  const y = kst.getUTCFullYear();
  const m = kst.getUTCMonth();
  const d = kst.getUTCDate();

  // 이번 사이클의 다음 사이클 시작 = (next month, period.billingDay).
  // 단, cycleStart 가 transition 으로 day !== billingDay 인 경우는
  //   cycleStart 이후 가장 가까운 period.billingDay 가 다음 사이클 시작.
  let nextUtcMs: number;
  if (d === period.billingDay) {
    nextUtcMs = Date.UTC(y, m + 1, period.billingDay) - KST_OFFSET_MS;
  } else if (d < period.billingDay) {
    nextUtcMs = Date.UTC(y, m, period.billingDay) - KST_OFFSET_MS;
  } else {
    nextUtcMs = Date.UTC(y, m + 1, period.billingDay) - KST_OFFSET_MS;
  }

  // 다음 period 가 cycleStart ~ nextUtcMs 사이에 시작하면 그 period.startDate 가 사이클 종료.
  for (const p of periods) {
    if (p.startUtcMs > cycleStart.getTime() && p.startUtcMs < nextUtcMs) {
      nextUtcMs = p.startUtcMs;
      break; // ASC 정렬이라 가장 이른 transition 만.
    }
  }
  return new Date(nextUtcMs);
}

function parseDateToKstMidnightUtcMs(yyyymmdd: string): number {
  const [y, m, d] = yyyymmdd.split('-').map((s) => parseInt(s, 10));
  return Date.UTC(y!, (m ?? 1) - 1, d ?? 1) - KST_OFFSET_MS;
}

export function kstYmd(at: Date): string {
  const kst = new Date(at.getTime() + KST_OFFSET_MS);
  const y = kst.getUTCFullYear();
  const m = String(kst.getUTCMonth() + 1).padStart(2, '0');
  const d = String(kst.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}
