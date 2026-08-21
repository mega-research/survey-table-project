import { describe, it, expect } from 'vitest';
import { sumActiveSeconds } from '@/lib/operations/active-seconds';
import type { PageVisit } from '@/shared/contracts/survey-response';

const v = (enteredAt: string, leftAt?: string, stepId = 'group:root'): PageVisit => ({
  stepId,
  enteredAt,
  ...(leftAt !== undefined ? { leftAt } : {}),
});

describe('sumActiveSeconds', () => {
  it('여러 segment의 활성시간을 합산한다', () => {
    const visits = [
      v('2026-05-29T00:00:00.000Z', '2026-05-29T00:00:10.000Z'), // 10s
      v('2026-05-29T08:00:00.000Z', '2026-05-29T08:00:05.000Z'), // 5s
    ];
    expect(sumActiveSeconds(visits)).toBe(15);
  });

  it('leftAt 누락 visit은 제외한다', () => {
    const visits = [
      v('2026-05-29T00:00:00.000Z', '2026-05-29T00:00:10.000Z'), // 10s
      v('2026-05-29T08:00:00.000Z'), // 열린 채 → 제외
    ];
    expect(sumActiveSeconds(visits)).toBe(10);
  });

  it('leftAt <= enteredAt(역전) 구간은 제외하고, 유효 segment 없으면 null을 반환한다', () => {
    const visits = [v('2026-05-29T00:00:10.000Z', '2026-05-29T00:00:05.000Z')];
    expect(sumActiveSeconds(visits)).toBeNull(); // 유효 segment 0개 → null
  });

  it('유효 segment가 없으면 null을 반환한다', () => {
    expect(sumActiveSeconds([])).toBeNull();
    expect(sumActiveSeconds(null)).toBeNull();
    expect(sumActiveSeconds(undefined)).toBeNull();
  });

  it('잘못된 timestamp는 무시한다', () => {
    const visits = [
      v('not-a-date', '2026-05-29T00:00:10.000Z'),
      v('2026-05-29T00:00:00.000Z', '2026-05-29T00:00:08.000Z'), // 8s
    ];
    expect(sumActiveSeconds(visits)).toBe(8);
  });
});
