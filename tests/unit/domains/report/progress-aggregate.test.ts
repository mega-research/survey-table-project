import { describe, it, expect } from 'vitest';
import { toneFromRate } from '@/lib/operations/report-progress';

describe('toneFromRate', () => {
  it('listCount=0 일 때 gray', () => {
    expect(toneFromRate(0, 0)).toBe('gray');
  });
  it('completedCount=0 일 때 gray', () => {
    expect(toneFromRate(0, 100)).toBe('gray');
  });
  it('1 <= rate < 25 일 때 rose', () => {
    expect(toneFromRate(1, 100)).toBe('rose');   // 1%
    expect(toneFromRate(24, 100)).toBe('rose');  // 24%
  });
  it('25 <= rate < 50 일 때 amber', () => {
    expect(toneFromRate(25, 100)).toBe('amber'); // 25%
    expect(toneFromRate(49, 100)).toBe('amber'); // 49%
  });
  it('50 <= rate <= 100 일 때 green', () => {
    expect(toneFromRate(50, 100)).toBe('green');  // 50%
    expect(toneFromRate(100, 100)).toBe('green'); // 100%
  });
});
