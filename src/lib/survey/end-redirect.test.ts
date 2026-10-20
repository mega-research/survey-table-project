import { describe, expect, it } from 'vitest';

import { isEndRedirectUrl, normalizeEndRedirects, resolveEndRedirectUrl } from './end-redirect';

describe('isEndRedirectUrl', () => {
  it('http(s) 절대 주소만 받는다', () => {
    expect(isEndRedirectUrl('https://tally.so/r/rDyxNl')).toBe(true);
    expect(isEndRedirectUrl('http://example.com/done?x=1')).toBe(true);
    expect(isEndRedirectUrl('javascript:alert(1)')).toBe(false);
    expect(isEndRedirectUrl('data:text/html,hi')).toBe(false);
    expect(isEndRedirectUrl('tally.so/r/rDyxNl')).toBe(false);
    expect(isEndRedirectUrl('/relative')).toBe(false);
    expect(isEndRedirectUrl('')).toBe(false);
  });
});

describe('normalizeEndRedirects', () => {
  it('공백을 걷고 유효한 주소만 남긴다', () => {
    expect(
      normalizeEndRedirects({
        completed: '  https://tally.so/r/rDyxNl ',
        screenedOut: 'javascript:alert(1)',
        quotaClosed: '',
      }),
    ).toEqual({ completed: 'https://tally.so/r/rDyxNl' });
  });

  it('남는 주소가 없으면 null', () => {
    expect(normalizeEndRedirects({ completed: ' ', screenedOut: 'nope' })).toBeNull();
    expect(normalizeEndRedirects(null)).toBeNull();
    expect(normalizeEndRedirects(undefined)).toBeNull();
    expect(normalizeEndRedirects('https://a.com')).toBeNull();
  });

  it('모르는 키와 문자열이 아닌 값은 버린다', () => {
    expect(
      normalizeEndRedirects({ completed: 3, extra: 'https://a.com', quotaClosed: 'https://q.com' }),
    ).toEqual({ quotaClosed: 'https://q.com' });
  });
});

describe('resolveEndRedirectUrl', () => {
  const redirects = {
    completed: 'https://tally.so/r/rDyxNl',
    screenedOut: 'https://tally.so/r/4aXgWk',
    quotaClosed: 'https://tally.so/r/jeDOdx',
  };

  it('결과별 주소를 고른다', () => {
    expect(resolveEndRedirectUrl(redirects, 'completed')).toBe('https://tally.so/r/rDyxNl');
    expect(resolveEndRedirectUrl(redirects, 'screened_out')).toBe('https://tally.so/r/4aXgWk');
    expect(resolveEndRedirectUrl(redirects, 'quota_closed')).toBe('https://tally.so/r/jeDOdx');
  });

  it('자격미달 주소가 없으면 완료 주소로 폴백하지 않는다', () => {
    expect(resolveEndRedirectUrl({ completed: redirects.completed }, 'screened_out')).toBeNull();
  });

  it('설정이 없거나 저장된 값이 깨졌으면 null', () => {
    expect(resolveEndRedirectUrl(null, 'completed')).toBeNull();
    expect(resolveEndRedirectUrl({ completed: 'javascript:alert(1)' }, 'completed')).toBeNull();
  });
});
