import { describe, expect, it } from 'vitest';

import { sanitizeRedirectPath } from '@/lib/auth/safe-redirect';

describe('sanitizeRedirectPath', () => {
  it('내부 절대경로는 그대로 통과한다', () => {
    expect(sanitizeRedirectPath('/admin/surveys/s1/operations/overview')).toBe(
      '/admin/surveys/s1/operations/overview',
    );
    expect(sanitizeRedirectPath('/admin/surveys?page=2')).toBe('/admin/surveys?page=2');
  });

  it('빈 값·null·undefined 는 기본 경로로', () => {
    expect(sanitizeRedirectPath('')).toBe('/admin/surveys');
    expect(sanitizeRedirectPath(null)).toBe('/admin/surveys');
    expect(sanitizeRedirectPath(undefined)).toBe('/admin/surveys');
  });

  it('외부·프로토콜 상대·백슬래시 경로는 기본 경로로 — open redirect 차단', () => {
    for (const bad of ['https://evil.example', '//evil.example', '/\\evil.example']) {
      expect(sanitizeRedirectPath(bad)).toBe('/admin/surveys');
    }
  });

  it('제어 문자로 // 검사를 우회하려는 경로는 기본 경로로', () => {
    for (const bad of ['/\t/evil.example', '/\n/evil.example', '\t//evil.example']) {
      expect(sanitizeRedirectPath(bad)).toBe('/admin/surveys');
    }
  });

  it('루트와 로그인 페이지는 기본 경로로 — 로그인 직후 되돌아가는 의미가 없다', () => {
    expect(sanitizeRedirectPath('/')).toBe('/admin/surveys');
    expect(sanitizeRedirectPath('/admin/login')).toBe('/admin/surveys');
    expect(sanitizeRedirectPath('/admin/login?redirect=%2Fadmin')).toBe('/admin/surveys');
  });
});
