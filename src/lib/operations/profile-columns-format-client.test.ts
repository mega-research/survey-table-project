import { describe, expect, it } from 'vitest';

import {
  clientVisibleProfileSort,
  withoutClientHiddenProfileColumns,
  withoutClientHiddenProfileTimings,
} from '@/lib/operations/profile-columns-format';

// 고객 계정(보기 전용 게스트)에 내지 않는 것 — 시작일시·소요시간. 종료일시는 남는다(2026-11-17 요청).

describe('withoutClientHiddenProfileColumns', () => {
  it('시작일시·소요시간 열을 빼고 종료일시와 나머지 열은 순서 그대로 둔다', () => {
    const columns = [
      { key: 'sys.idx', label: '순번', order: 0 },
      { key: 'sys.status', label: '상태', order: 1 },
      { key: 'sys.startedAt', label: '시작일시', order: 2 },
      { key: 'sys.completedAt', label: '종료일시', order: 3 },
      { key: 'sys.totalSeconds', label: '소요시간', order: 4 },
      { key: 'attrs.업체명', label: '업체명', order: 5 },
    ];
    expect(withoutClientHiddenProfileColumns(columns).map((c) => c.key)).toEqual([
      'sys.idx',
      'sys.status',
      'sys.completedAt',
      'attrs.업체명',
    ]);
  });

  it('관리자가 라벨을 바꿔 둔 열도 키로 판정해 뺀다', () => {
    const columns = [{ key: 'sys.totalSeconds', label: '응답 시간', order: 0 }];
    expect(withoutClientHiddenProfileColumns(columns)).toEqual([]);
  });
});

describe('clientVisibleProfileSort', () => {
  it('감춘 열로 정렬하라는 주소는 순번 정렬로 돌린다', () => {
    expect(clientVisibleProfileSort('startedAt')).toBe('idx');
    expect(clientVisibleProfileSort('totalSeconds')).toBe('idx');
  });

  it('보이는 열의 정렬은 그대로 둔다', () => {
    expect(clientVisibleProfileSort('completedAt')).toBe('completedAt');
    expect(clientVisibleProfileSort('status')).toBe('status');
    expect(clientVisibleProfileSort('attrs.업체명')).toBe('attrs.업체명');
  });
});

describe('withoutClientHiddenProfileTimings', () => {
  it('시작일시·소요시간 값을 비우고 종료일시와 나머지 값은 그대로 둔다', () => {
    const completedAt = new Date('2026-11-15T00:10:00Z');
    const rows = [
      {
        id: 'r1',
        status: 'completed',
        startedAt: new Date('2026-11-15T00:00:00Z'),
        completedAt,
        totalSeconds: 600,
      },
    ];
    expect(withoutClientHiddenProfileTimings(rows)).toEqual([
      { id: 'r1', status: 'completed', startedAt: null, completedAt, totalSeconds: null },
    ]);
    // 원본은 건드리지 않는다
    expect(rows[0]!.totalSeconds).toBe(600);
  });
});
