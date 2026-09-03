import { describe, expect, it } from 'vitest';

import {
  shapeResponseTime,
  trimmedMean,
  type Platform,
} from '@/lib/operations/response-time-format';

describe('trimmedMean', () => {
  it('빈 배열 → null', () => {
    expect(trimmedMean([], 0.025)).toBeNull();
  });

  it('단일 값 [100] → 100 (n=1, 트림 0개)', () => {
    expect(trimmedMean([100], 0.025)).toBe(100);
  });

  it('n=10, trim=0.025 → 일반 평균과 동일 (floor(10*0.025)=0)', () => {
    const values = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const plain = values.reduce((s, v) => s + v, 0) / values.length;
    expect(trimmedMean(values, 0.025)).toBe(plain);
  });

  it('n=100 양쪽 outlier가 있는 경우 → 트림된 평균이 일반 평균보다 작아진다', () => {
    // 1..96 (정상값) + 9000, 10000 (상단 outlier 2개) → 2.5% trim 시 양쪽 2개씩 제거.
    // 하단 outlier는 1, 2 (작은 값) — 양쪽 2개씩 제거되면 균형이 맞다.
    const base: number[] = [];
    for (let i = 1; i <= 96; i++) base.push(i + 100); // 101..196 (정상값)
    const values = [1, 2, ...base, 9000, 10000];
    expect(values).toHaveLength(100);

    const plain = values.reduce((s, v) => s + v, 0) / values.length;
    const trimmed = trimmedMean(values, 0.025);
    expect(trimmed).not.toBeNull();
    // 트림된 평균은 일반 평균보다 의미 있게 작다 (상단 9000/10000 제거 효과 > 하단 1/2 제거).
    expect(trimmed!).toBeLessThan(plain);
  });

  it('n=100 정확히 양쪽 2개씩 제거 — 평균은 101..196 의 평균과 일치', () => {
    const base: number[] = [];
    for (let i = 1; i <= 96; i++) base.push(i + 100); // 101..196
    const values = [1, 2, ...base, 9000, 10000]; // 1, 2 → 제거, 9000, 10000 → 제거
    const expected = base.reduce((s, v) => s + v, 0) / base.length; // (101+196)/2 = 148.5
    expect(trimmedMean(values, 0.025)).toBeCloseTo(expected, 10);
  });

  it('NaN/Infinity 입력은 사전 필터링 — 결과가 유한값', () => {
    const result = trimmedMean([1, 2, 3, NaN, Infinity, -Infinity, 4, 5], 0.025);
    // 유효값 [1,2,3,4,5]만 남고 floor(5*0.025)=0이라 일반 평균.
    expect(result).toBe(3);
  });

  it('입력 배열을 변형하지 않는다', () => {
    const original = [10, 1, 100, 50, 5];
    const snapshot = [...original];
    trimmedMean(original, 0.025);
    expect(original).toEqual(snapshot);
  });
});

describe('shapeResponseTime', () => {
  it('빈 입력 → 4행, 모든 통계 null', () => {
    const result = shapeResponseTime([]);
    expect(result).toHaveLength(4);
    expect(result.map((r) => r.scope)).toEqual(['total', 'desktop', 'mobile', 'tablet']);
    expect(result.map((r) => r.label)).toEqual(['전체', '데스크톱', '모바일', '태블릿']);
    for (const row of result) {
      expect(row.n).toBe(0);
      expect(row.avg).toBeNull();
      expect(row.avgTrimmed).toBeNull();
      expect(row.min).toBeNull();
      expect(row.max).toBeNull();
    }
  });

  it('전부 desktop인 경우 — Desktop과 Total이 동일, Mobile/Pad는 비어 있음', () => {
    const rows: Array<{ platform: Platform | null; totalSeconds: number | null }> = [
      { platform: 'desktop', totalSeconds: 100 },
      { platform: 'desktop', totalSeconds: 200 },
      { platform: 'desktop', totalSeconds: 300 },
    ];
    const result = shapeResponseTime(rows);
    const total = result.find((r) => r.scope === 'total')!;
    const desktop = result.find((r) => r.scope === 'desktop')!;
    const mobile = result.find((r) => r.scope === 'mobile')!;
    const tablet = result.find((r) => r.scope === 'tablet')!;

    expect(total.n).toBe(3);
    expect(total.avg).toBe(200);
    expect(total.min).toBe(100);
    expect(total.max).toBe(300);

    expect(desktop).toEqual(total ? { ...total, scope: 'desktop', label: '데스크톱' } : total);

    expect(mobile.n).toBe(0);
    expect(mobile.avg).toBeNull();
    expect(tablet.n).toBe(0);
    expect(tablet.avg).toBeNull();
  });

  it('혼합 platform — Total은 모두 포함, sub-row는 분할', () => {
    const rows: Array<{ platform: Platform | null; totalSeconds: number | null }> = [
      { platform: 'desktop', totalSeconds: 100 },
      { platform: 'desktop', totalSeconds: 200 },
      { platform: 'mobile', totalSeconds: 300 },
      { platform: 'mobile', totalSeconds: 500 },
      { platform: 'tablet', totalSeconds: 400 },
    ];
    const result = shapeResponseTime(rows);
    const total = result.find((r) => r.scope === 'total')!;
    const desktop = result.find((r) => r.scope === 'desktop')!;
    const mobile = result.find((r) => r.scope === 'mobile')!;
    const tablet = result.find((r) => r.scope === 'tablet')!;

    expect(total.n).toBe(5);
    expect(total.avg).toBe((100 + 200 + 300 + 500 + 400) / 5);
    expect(total.min).toBe(100);
    expect(total.max).toBe(500);

    expect(desktop.n).toBe(2);
    expect(desktop.avg).toBe(150);
    expect(mobile.n).toBe(2);
    expect(mobile.avg).toBe(400);
    expect(tablet.n).toBe(1);
    expect(tablet.avg).toBe(400);
  });

  it('totalSeconds=null 행은 모든 행에서 제외', () => {
    const rows: Array<{ platform: Platform | null; totalSeconds: number | null }> = [
      { platform: 'desktop', totalSeconds: null },
      { platform: 'mobile', totalSeconds: null },
      { platform: 'desktop', totalSeconds: 100 },
    ];
    const result = shapeResponseTime(rows);
    expect(result.find((r) => r.scope === 'total')!.n).toBe(1);
    expect(result.find((r) => r.scope === 'desktop')!.n).toBe(1);
    expect(result.find((r) => r.scope === 'mobile')!.n).toBe(0);
  });

  it('platform=null 행은 Total에만 포함, sub-row에는 들어가지 않음', () => {
    const rows: Array<{ platform: Platform | null; totalSeconds: number | null }> = [
      { platform: null, totalSeconds: 100 },
      { platform: null, totalSeconds: 200 },
      { platform: 'desktop', totalSeconds: 300 },
    ];
    const result = shapeResponseTime(rows);
    expect(result.find((r) => r.scope === 'total')!.n).toBe(3);
    expect(result.find((r) => r.scope === 'desktop')!.n).toBe(1);
    expect(result.find((r) => r.scope === 'mobile')!.n).toBe(0);
    expect(result.find((r) => r.scope === 'tablet')!.n).toBe(0);
  });

  it('tablet platform은 "태블릿" 라벨 행으로 매핑', () => {
    const rows: Array<{ platform: Platform | null; totalSeconds: number | null }> = [
      { platform: 'tablet', totalSeconds: 250 },
    ];
    const result = shapeResponseTime(rows);
    const padRow = result.find((r) => r.scope === 'tablet')!;
    expect(padRow.label).toBe('태블릿');
    expect(padRow.n).toBe(1);
    expect(padRow.avg).toBe(250);
  });

  it('min/max는 단일 값일 때 동일, 여러 값일 때 양 끝', () => {
    const single: Array<{ platform: Platform | null; totalSeconds: number | null }> = [
      { platform: 'desktop', totalSeconds: 42 },
    ];
    const singleResult = shapeResponseTime(single);
    const desktopSingle = singleResult.find((r) => r.scope === 'desktop')!;
    expect(desktopSingle.min).toBe(42);
    expect(desktopSingle.max).toBe(42);

    const multi: Array<{ platform: Platform | null; totalSeconds: number | null }> = [
      { platform: 'mobile', totalSeconds: 7 },
      { platform: 'mobile', totalSeconds: 999 },
      { platform: 'mobile', totalSeconds: 50 },
    ];
    const multiResult = shapeResponseTime(multi);
    const mobile = multiResult.find((r) => r.scope === 'mobile')!;
    expect(mobile.min).toBe(7);
    expect(mobile.max).toBe(999);
  });

  it('n < 40에서는 trimmed 평균이 일반 평균과 동일 (floor(n*0.025)=0, C-4)', () => {
    // n=20 → floor(20*0.025)=0
    const rows: Array<{ platform: Platform | null; totalSeconds: number | null }> = [];
    for (let i = 1; i <= 20; i++) rows.push({ platform: 'desktop', totalSeconds: i * 10 });
    const result = shapeResponseTime(rows);
    const desktop = result.find((r) => r.scope === 'desktop')!;
    expect(desktop.n).toBe(20);
    expect(desktop.avgTrimmed).toBe(desktop.avg);
  });

  it('n=0 행의 avgTrimmed는 null (어댑터 출력 일관성)', () => {
    const result = shapeResponseTime([]);
    for (const row of result) {
      expect(row.avgTrimmed).toBeNull();
    }
  });
});
