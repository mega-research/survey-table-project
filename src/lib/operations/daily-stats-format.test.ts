import { describe, expect, it } from 'vitest';

import { shapeDailyStats } from '@/lib/operations/daily-stats-format';

describe('shapeDailyStats', () => {
  it('빈 입력 → 빈 배열', () => {
    expect(shapeDailyStats([])).toEqual([]);
  });

  it('단일 일자 + 모두 완료 → completionRate=1, columnPct=1', () => {
    // 2026-04-27 = 월요일
    const result = shapeDailyStats([
      { date: '2026-04-27', total: 10, completed: 10, drop: 0 },
    ]);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      date: '2026-04-27',
      label: '2026-04-27 (월)',
      total: 10,
      completed: 10,
      completionRate: 1,
      columnPct: 1,
      drop: 0,
    });
  });

  it('여러 일자 → 내림차순 정렬, 비율 계산 검증', () => {
    // 입력은 일부러 무작위 순서로 주어 정렬 책임이 함수에 있음을 확인.
    // 2026-04-25(토), 26(일), 27(월) — overallTotal = 50+30+20 = 100
    const result = shapeDailyStats([
      { date: '2026-04-26', total: 30, completed: 18, drop: 4 },
      { date: '2026-04-27', total: 20, completed: 10, drop: 2 },
      { date: '2026-04-25', total: 50, completed: 40, drop: 5 },
    ]);
    expect(result.map((r) => r.date)).toEqual([
      '2026-04-27',
      '2026-04-26',
      '2026-04-25',
    ]);
    expect(result[0]).toMatchObject({
      date: '2026-04-27',
      label: '2026-04-27 (월)',
      total: 20,
      completed: 10,
      completionRate: 0.5,
      columnPct: 0.2,
      drop: 2,
    });
    expect(result[1]).toMatchObject({
      date: '2026-04-26',
      label: '2026-04-26 (일)',
      completionRate: 18 / 30,
      columnPct: 0.3,
    });
    expect(result[2]).toMatchObject({
      date: '2026-04-25',
      label: '2026-04-25 (토)',
      completionRate: 0.8,
      columnPct: 0.5,
    });
  });

  it('total=0 행 (방어적 케이스) → completionRate / columnPct null, NaN 없음', () => {
    // 실제 SQL에서는 total=0 행이 나오지 않지만, 헬퍼는 분모 0에서 안전해야 한다.
    const result = shapeDailyStats([
      { date: '2026-04-27', total: 0, completed: 0, drop: 0 },
    ]);
    expect(result).toHaveLength(1);
    const row0 = result[0];
    if (!row0) throw new Error('expected result[0]');
    expect(row0.completionRate).toBeNull();
    // overallTotal 도 0 → columnPct null
    expect(row0.columnPct).toBeNull();
    expect(row0.drop).toBe(0);
  });

  it('한국어 요일 라벨이 달력과 일치 — 2026-04-27 = 월', () => {
    const result = shapeDailyStats([
      { date: '2026-04-22', total: 1, completed: 0, drop: 0 }, // 수
      { date: '2026-04-23', total: 1, completed: 0, drop: 0 }, // 목
      { date: '2026-04-24', total: 1, completed: 0, drop: 0 }, // 금
      { date: '2026-04-25', total: 1, completed: 0, drop: 0 }, // 토
      { date: '2026-04-26', total: 1, completed: 0, drop: 0 }, // 일
      { date: '2026-04-27', total: 1, completed: 0, drop: 0 }, // 월
      { date: '2026-04-28', total: 1, completed: 0, drop: 0 }, // 화
    ]);
    // 정렬은 내림차순이므로 28 → 22 순서.
    expect(result.map((r) => r.label)).toEqual([
      '2026-04-28 (화)',
      '2026-04-27 (월)',
      '2026-04-26 (일)',
      '2026-04-25 (토)',
      '2026-04-24 (금)',
      '2026-04-23 (목)',
      '2026-04-22 (수)',
    ]);
  });

  it('드롭 0건은 0 (null 아님)', () => {
    const result = shapeDailyStats([
      { date: '2026-04-27', total: 5, completed: 5, drop: 0 },
    ]);
    const dropRow = result[0];
    if (!dropRow) throw new Error('expected result[0]');
    expect(dropRow.drop).toBe(0);
    expect(typeof dropRow.drop).toBe('number');
  });

  it('월/년 경계를 가로지르는 입력에서도 내림차순 정렬', () => {
    const result = shapeDailyStats([
      { date: '2025-12-31', total: 5, completed: 3, drop: 1 },
      { date: '2026-01-02', total: 8, completed: 4, drop: 2 },
      { date: '2026-01-01', total: 7, completed: 5, drop: 0 },
    ]);
    expect(result.map((r) => r.date)).toEqual([
      '2026-01-02',
      '2026-01-01',
      '2025-12-31',
    ]);
  });

  it('columnPct 합계는 1.0 (분모 비교)', () => {
    const result = shapeDailyStats([
      { date: '2026-04-25', total: 33, completed: 10, drop: 0 },
      { date: '2026-04-26', total: 67, completed: 20, drop: 0 },
    ]);
    const sum = result.reduce((acc, r) => acc + (r.columnPct ?? 0), 0);
    expect(sum).toBeCloseTo(1.0, 10);
  });
});
