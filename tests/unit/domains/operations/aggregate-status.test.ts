import { describe, expect, it } from 'vitest';

import { mapRowsToCounts } from '@/lib/operations/aggregate-status-format';

describe('mapRowsToCounts', () => {
  it('mixed statuses: completed/in_progress/drop → 각 버킷에 합산되고 total은 in_progress 제외 합', () => {
    const rows = [
      { status: 'completed', count: 30 },
      { status: 'in_progress', count: 10 },
      { status: 'drop', count: 5 },
    ];
    expect(mapRowsToCounts(rows)).toEqual({
      total: 35,           // ← in_progress 제외 (completed 30 + drop 5)
      completed: 30,
      inProgress: 10,
      drop: 5,
      screenedOut: 0,
      quotafulOut: 0,
      bad: 0,
    });
  });

  it('빈 입력 → 모든 필드가 0', () => {
    expect(mapRowsToCounts([])).toEqual({
      total: 0,
      completed: 0,
      screenedOut: 0,
      quotafulOut: 0,
      bad: 0,
      drop: 0,
      inProgress: 0,
    });
  });

  it('알려지지 않은 status는 throw 하지 않고 어떤 버킷에도 합산되지 않음', () => {
    const rows = [{ status: 'unknown_value', count: 3 }];
    const result = mapRowsToCounts(rows);
    expect(result.total).toBe(0);  // 종결 버킷에 속하지 않으므로 total=0
    expect(result.completed).toBe(0);
    expect(result.screenedOut).toBe(0);
    expect(result.quotafulOut).toBe(0);
    expect(result.bad).toBe(0);
    expect(result.drop).toBe(0);
    expect(result.inProgress).toBe(0);
  });

  it('snake_case status를 camelCase 필드로 매핑한다', () => {
    const rows = [
      { status: 'screened_out', count: 7 },
      { status: 'quotaful_out', count: 4 },
      { status: 'bad', count: 2 },
    ];
    expect(mapRowsToCounts(rows)).toEqual({
      total: 6, // screened_out(7) 제외 — quotaful_out(4) + bad(2)
      completed: 0,
      screenedOut: 7,
      quotafulOut: 4,
      bad: 2,
      drop: 0,
      inProgress: 0,
    });
  });

  it('total === 적격 종결 카운트의 합 (in_progress·screened_out 제외)', () => {
    const rows = [
      { status: 'completed', count: 100 },
      { status: 'in_progress', count: 50 },
      { status: 'screened_out', count: 20 },
      { status: 'quotaful_out', count: 10 },
      { status: 'bad', count: 5 },
      { status: 'drop', count: 15 },
    ];
    const result = mapRowsToCounts(rows);
    const sumOfEligible =
      result.completed +
      result.quotafulOut +
      result.bad +
      result.drop;
    expect(result.total).toBe(130);  // in_progress(50)·screened_out(20) 제외
    expect(result.total).toBe(sumOfEligible);
    expect(result.inProgress).toBe(50);  // inProgress 필드는 보존됨
    expect(result.screenedOut).toBe(20); // 카운트 자체는 보존됨 (KPI 카드에 노출)
  });

  it('자격미달은 부적격이라 total 에 합산되지 않는다', () => {
    const rows = [
      { status: 'completed', count: 97 },
      { status: 'screened_out', count: 4 },
      { status: 'drop', count: 26 },
    ];
    const result = mapRowsToCounts(rows);

    expect(result.screenedOut).toBe(4);
    expect(result.total).toBe(123); // 97 + 26 — screened_out 제외
  });

  it('쿼터마감·불량은 적격 미완료라 total 에 남는다', () => {
    const rows = [
      { status: 'completed', count: 10 },
      { status: 'quotaful_out', count: 3 },
      { status: 'bad', count: 2 },
      { status: 'screened_out', count: 5 },
    ];
    expect(mapRowsToCounts(rows).total).toBe(15); // 10 + 3 + 2
  });
});
