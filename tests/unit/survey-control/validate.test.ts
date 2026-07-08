import { describe, expect, it } from 'vitest';

import { isValidTestToken } from '@/lib/survey-control';

describe('isValidTestToken', () => {
  const flags = { testModeEnabled: true, testToken: 'tok-1' };

  it('모드 ON + 토큰 일치면 true', () => {
    expect(isValidTestToken(flags, 'tok-1')).toBe(true);
  });
  it('토큰 불일치면 false', () => {
    expect(isValidTestToken(flags, 'tok-2')).toBe(false);
  });
  it('모드 OFF면 토큰이 맞아도 false', () => {
    expect(isValidTestToken({ ...flags, testModeEnabled: false }, 'tok-1')).toBe(false);
  });
  it('토큰 미전달(null/undefined/빈문자열)이면 false', () => {
    expect(isValidTestToken(flags, null)).toBe(false);
    expect(isValidTestToken(flags, undefined)).toBe(false);
    expect(isValidTestToken(flags, '')).toBe(false);
  });
});
