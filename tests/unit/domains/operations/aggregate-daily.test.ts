import { describe, expect, it } from 'vitest';

import { formatDayLabel, shapeDailyBuckets } from '@/lib/operations/aggregate-daily';

describe('shapeDailyBuckets — day 모드', () => {
  it('빈 입력 → 빈 배열', () => {
    expect(shapeDailyBuckets([], 'day')).toEqual([]);
  });

  it('단일 일자 → 길이 1 배열, MM-DD (요일) 라벨', () => {
    // 2026-04-22 = 수요일
    const result = shapeDailyBuckets([{ bucket: '2026-04-22', count: 7 }], 'day');
    expect(result).toEqual([
      { bucket: '2026-04-22', label: '04-22 (수)', count: 7 },
    ]);
  });

  it('희소 일자 → min~max 사이를 모두 채워 연속 x축 (gap = 0)', () => {
    // 2026-04-22(수), 23(목), 24(금), 25(토)
    const rows = [
      { bucket: '2026-04-22', count: 5 },
      { bucket: '2026-04-25', count: 3 },
    ];
    expect(shapeDailyBuckets(rows, 'day')).toEqual([
      { bucket: '2026-04-22', label: '04-22 (수)', count: 5 },
      { bucket: '2026-04-23', label: '04-23 (목)', count: 0 },
      { bucket: '2026-04-24', label: '04-24 (금)', count: 0 },
      { bucket: '2026-04-25', label: '04-25 (토)', count: 3 },
    ]);
  });

  it('월/년 경계를 가로지르는 범위에서도 정확히 채운다', () => {
    // 2025-12-31(수) → 2026-01-02(금): 1월 1일(목) 포함 3일
    const rows = [
      { bucket: '2025-12-31', count: 1 },
      { bucket: '2026-01-02', count: 2 },
    ];
    expect(shapeDailyBuckets(rows, 'day')).toEqual([
      { bucket: '2025-12-31', label: '12-31 (수)', count: 1 },
      { bucket: '2026-01-01', label: '01-01 (목)', count: 0 },
      { bucket: '2026-01-02', label: '01-02 (금)', count: 2 },
    ]);
  });

  it('역순으로 들어와도 chronological 정렬', () => {
    const rows = [
      { bucket: '2026-04-25', count: 3 },
      { bucket: '2026-04-22', count: 5 },
    ];
    const result = shapeDailyBuckets(rows, 'day');
    expect(result.map((b) => b.bucket)).toEqual([
      '2026-04-22',
      '2026-04-23',
      '2026-04-24',
      '2026-04-25',
    ]);
  });
});

describe('formatDayLabel — 공유 헬퍼 (차트 빈 슬롯 패딩과 동일 라벨 보장)', () => {
  it("'YYYY-MM-DD' → 'MM-DD (요일)' 형식", () => {
    // 2026-04-22 = 수요일
    expect(formatDayLabel('2026-04-22')).toBe('04-22 (수)');
  });

  it('요일별 한글 글자 매핑 (일~토)', () => {
    // 2026-04-26(일) ~ 2026-05-02(토)
    expect(formatDayLabel('2026-04-26')).toBe('04-26 (일)');
    expect(formatDayLabel('2026-04-27')).toBe('04-27 (월)');
    expect(formatDayLabel('2026-04-28')).toBe('04-28 (화)');
    expect(formatDayLabel('2026-04-29')).toBe('04-29 (수)');
    expect(formatDayLabel('2026-04-30')).toBe('04-30 (목)');
    expect(formatDayLabel('2026-05-01')).toBe('05-01 (금)');
    expect(formatDayLabel('2026-05-02')).toBe('05-02 (토)');
  });

  it('shapeDailyBuckets 가 만드는 라벨과 동일 (차트 패딩 byte-identity 보장)', () => {
    const [bucket] = shapeDailyBuckets(
      [{ bucket: '2026-04-22', count: 1 }],
      'day',
    );
    expect(bucket?.label).toBe(formatDayLabel('2026-04-22'));
  });
});

describe('shapeDailyBuckets — hour 모드', () => {
  it('빈 입력 + hourModeDate → 24개 버킷, 모두 count=0, 00시~23시 라벨', () => {
    const result = shapeDailyBuckets([], 'hour', '2026-04-27');
    expect(result).toHaveLength(24);
    expect(result[0]).toEqual({ bucket: '2026-04-27 00:00', label: '00시', count: 0 });
    expect(result[9]).toEqual({ bucket: '2026-04-27 09:00', label: '09시', count: 0 });
    expect(result[23]).toEqual({ bucket: '2026-04-27 23:00', label: '23시', count: 0 });
    expect(result.every((b) => b.count === 0)).toBe(true);
  });

  it('희소 시간대 → 24개 버킷, 매칭되는 시간만 채워지고 나머지는 0', () => {
    const rows = [
      { bucket: '2026-04-27 09:00', count: 12 },
      { bucket: '2026-04-27 14:00', count: 5 },
    ];
    const result = shapeDailyBuckets(rows, 'hour', '2026-04-27');
    expect(result).toHaveLength(24);
    expect(result[9]).toEqual({ bucket: '2026-04-27 09:00', label: '09시', count: 12 });
    expect(result[14]).toEqual({ bucket: '2026-04-27 14:00', label: '14시', count: 5 });
    // 인접한 시간들은 0
    const b8 = result[8]; const b10 = result[10]; const b13 = result[13]; const b15 = result[15];
    if (!b8 || !b10 || !b13 || !b15) throw new Error('expected buckets at indices 8,10,13,15');
    expect(b8.count).toBe(0);
    expect(b10.count).toBe(0);
    expect(b13.count).toBe(0);
    expect(b15.count).toBe(0);
    // 합계는 12+5
    expect(result.reduce((acc, b) => acc + b.count, 0)).toBe(17);
  });

  it('chronological 정렬 — bucket 시간순 (00 → 23)', () => {
    const rows = [
      { bucket: '2026-04-27 23:00', count: 1 },
      { bucket: '2026-04-27 00:00', count: 2 },
      { bucket: '2026-04-27 12:00', count: 3 },
    ];
    const result = shapeDailyBuckets(rows, 'hour', '2026-04-27');
    expect(result.map((b) => b.bucket.slice(11))).toEqual(
      Array.from({ length: 24 }, (_, h) => `${String(h).padStart(2, '0')}:00`),
    );
    const b0 = result[0]; const b12 = result[12]; const b23 = result[23];
    if (!b0 || !b12 || !b23) throw new Error('expected buckets at indices 0,12,23');
    expect(b0.count).toBe(2);
    expect(b12.count).toBe(3);
    expect(b23.count).toBe(1);
  });

  it('hourModeDate 누락 시 throw', () => {
    expect(() => shapeDailyBuckets([], 'hour')).toThrow();
  });
});
