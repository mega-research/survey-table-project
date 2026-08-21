import { describe, expect, it } from 'vitest';

import {
  cycleStartFor,
  findPeriodFor,
  kstYmd,
  nextCycleStart,
  toPeriodSpecs,
  type PeriodInputRow,
} from '@/server/mail/services/billing-cycles';

const PRO_50K = {
  planLabel: 'Pro 50K',
  monthlyFeeKrw: 28_600,
  includedEmails: 50_000,
  overagePer1kKrw: 1_290,
};

function row(startDate: string, billingDay: number, plan = PRO_50K): PeriodInputRow {
  return { startDate, billingDayOfMonth: billingDay, ...plan };
}

// KST 의 특정 시각을 UTC Date 로 만드는 헬퍼.
function kst(y: number, m: number, d: number, h = 12): Date {
  // KST=UTC+9. UTC ms = Date.UTC(y,m,d,h) - 9h.
  return new Date(Date.UTC(y, m - 1, d, h) - 9 * 60 * 60 * 1000);
}

describe('toPeriodSpecs', () => {
  it('빈 입력이면 fallback period 반환', () => {
    const out = toPeriodSpecs([]);
    expect(out).toHaveLength(1);
    expect(out[0]?.billingDay).toBe(15);
    expect(out[0]?.monthlyFeeKrw).toBe(0);
  });

  it('입력이 정렬 안 되어 있어도 startDate ASC 로 정렬', () => {
    const out = toPeriodSpecs([row('2026-08-15', 15), row('2026-01-15', 15)]);
    expect(out.map((p) => p.startDateLabel)).toEqual(['2026-01-15', '2026-08-15']);
  });
});

describe('findPeriodFor', () => {
  it('at 보다 같거나 빠른 startDate 중 가장 늦은 period', () => {
    const periods = toPeriodSpecs([row('2026-01-15', 15), row('2026-08-15', 20)]);
    expect(findPeriodFor(kst(2026, 3, 1), periods).startDateLabel).toBe('2026-01-15');
    expect(findPeriodFor(kst(2026, 8, 15), periods).startDateLabel).toBe('2026-08-15');
    expect(findPeriodFor(kst(2026, 9, 1), periods).startDateLabel).toBe('2026-08-15');
  });

  it('가장 이른 period 보다도 이른 at 은 가장 이른 period 사용', () => {
    const periods = toPeriodSpecs([row('2026-06-15', 15)]);
    expect(findPeriodFor(kst(2026, 3, 1), periods).startDateLabel).toBe('2026-06-15');
  });
});

describe('cycleStartFor (단일 period)', () => {
  const periods = toPeriodSpecs([row('2026-01-15', 15)]);

  it('day < billingDay 면 전달 billingDay 가 사이클 시작', () => {
    expect(kstYmd(cycleStartFor(kst(2026, 4, 10), periods))).toBe('2026-03-15');
  });

  it('day === billingDay 면 그 달 billingDay 가 사이클 시작', () => {
    expect(kstYmd(cycleStartFor(kst(2026, 4, 15), periods))).toBe('2026-04-15');
  });

  it('day > billingDay 면 그 달 billingDay 가 사이클 시작', () => {
    expect(kstYmd(cycleStartFor(kst(2026, 4, 20), periods))).toBe('2026-04-15');
  });

  it('연 경계: 사이클 후보가 period.startDate 보다 이르면 period.startDate 가 사이클 시작', () => {
    // 2026-01-10 의 정상 cycleStart 후보는 2025-12-15. 하지만 period.startDate=2026-01-15 이라
    // transition 처리로 사이클 시작이 period.startDate 로 클램프됨.
    expect(kstYmd(cycleStartFor(kst(2026, 1, 10), periods))).toBe('2026-01-15');
  });

  it('연 경계: period 시작 후 12월 → 다음 해 1월 사이클', () => {
    // 한 사이클 추적: 2026-12-20 의 정상 사이클 후보 = 2026-12-15.
    expect(kstYmd(cycleStartFor(kst(2026, 12, 20), periods))).toBe('2026-12-15');
  });

  it('연 경계: 1월 초가 12월 사이클에 속함 (period 시작 후)', () => {
    // 2027-01-10 의 cycleStart 후보 = 2026-12-15. period.startDate=2026-01-15 보다 늦으므로 그대로.
    expect(kstYmd(cycleStartFor(kst(2027, 1, 10), periods))).toBe('2026-12-15');
  });
});

describe('cycleStartFor (period 시계열, 결제일 변경)', () => {
  const periods = toPeriodSpecs([
    row('2026-01-15', 15),
    row('2026-08-20', 20),
  ]);

  it('첫 period 적용 구간', () => {
    expect(kstYmd(cycleStartFor(kst(2026, 5, 10), periods))).toBe('2026-04-15');
  });

  it('두 번째 period 적용 구간', () => {
    expect(kstYmd(cycleStartFor(kst(2026, 9, 1), periods))).toBe('2026-08-20');
  });

  it('두 번째 period 시작 직후도 그 period 의 첫 사이클로 매핑', () => {
    expect(kstYmd(cycleStartFor(kst(2026, 8, 20), periods))).toBe('2026-08-20');
  });

  it('transition: 두 번째 period.startDate 가 사이클 시작 ≤ day < billingDay 케이스', () => {
    // 2026-08-22 는 day=22 > billingDay=20 → cycle start 후보=2026-08-20.
    // 2026-08-20 이 period.startDate 이므로 정확히 일치.
    expect(kstYmd(cycleStartFor(kst(2026, 8, 22), periods))).toBe('2026-08-20');
  });
});

describe('nextCycleStart', () => {
  const periods = toPeriodSpecs([row('2026-01-15', 15)]);

  it('정상 사이클 다음 시작 = 다음 달 같은 day', () => {
    const cycleStart = cycleStartFor(kst(2026, 4, 20), periods);
    expect(kstYmd(nextCycleStart(cycleStart, periods))).toBe('2026-05-15');
  });

  it('12월 사이클의 다음 시작 = 다음 해 1월', () => {
    const cycleStart = cycleStartFor(kst(2026, 12, 20), periods);
    expect(kstYmd(cycleStart)).toBe('2026-12-15');
    expect(kstYmd(nextCycleStart(cycleStart, periods))).toBe('2027-01-15');
  });

  it('다음 period 가 사이클 도중 시작하면 그 시점이 사이클 종료', () => {
    const periods2 = toPeriodSpecs([
      row('2026-01-15', 15),
      row('2026-05-20', 20),
    ]);
    // 2026-04-15 ~ 5-14 가 정상 사이클이지만, 다음 period 가 5-20 시작 → 영향 없음 (5-20 > 5-14).
    const cycleStart = cycleStartFor(kst(2026, 4, 20), periods2);
    expect(kstYmd(cycleStart)).toBe('2026-04-15');
    expect(kstYmd(nextCycleStart(cycleStart, periods2))).toBe('2026-05-15');

    // 2026-05-15 ~ 6-14 정상 사이클이지만 5-20 transition → 종료가 5-20 로 단축.
    const cs2 = cycleStartFor(kst(2026, 5, 16), periods2);
    expect(kstYmd(cs2)).toBe('2026-05-15');
    expect(kstYmd(nextCycleStart(cs2, periods2))).toBe('2026-05-20');
  });
});

describe('kstYmd', () => {
  it('KST 자정의 UTC Date 를 YYYY-MM-DD 로 출력', () => {
    expect(kstYmd(new Date(Date.UTC(2026, 4, 14, 15)))).toBe('2026-05-15'); // UTC 5-14 15:00 = KST 5-15 00:00
  });
});
