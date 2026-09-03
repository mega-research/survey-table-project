import { describe, expect, it } from 'vitest';

import {
  retentionDateToTimestamp,
  retentionTimestampToDate,
} from '@/lib/survey/pii-retention';

describe('보관기한 KST 변환 — 해당일 포함 의미론', () => {
  it('2026-12-31 은 KST 2027-01-01 00:00 (= UTC 2026-12-31 15:00) 이 된다', () => {
    const ts = retentionDateToTimestamp('2026-12-31');
    expect(ts.toISOString()).toBe('2026-12-31T15:00:00.000Z');
  });

  it('timestamp 를 날짜로 되돌리면 입력 날짜와 일치한다 (roundtrip)', () => {
    for (const d of ['2026-12-31', '2026-01-01', '2027-06-15']) {
      expect(retentionTimestampToDate(retentionDateToTimestamp(d))).toBe(d);
    }
  });
});
