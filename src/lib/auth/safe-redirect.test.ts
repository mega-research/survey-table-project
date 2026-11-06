import { describe, expect, it } from 'vitest';

import { sanitizeInternalPath, sanitizeRedirectPath } from '@/lib/auth/safe-redirect';

describe('sanitizeRedirectPath', () => {
  it('내부 절대경로는 그대로 통과한다', () => {
    expect(sanitizeRedirectPath('/surveys/s1/operations/overview')).toBe(
      '/surveys/s1/operations/overview',
    );
    expect(sanitizeRedirectPath('/surveys?page=2')).toBe('/surveys?page=2');
  });

  it('빈 값·null·undefined 는 기본 경로로', () => {
    expect(sanitizeRedirectPath('')).toBe('/surveys');
    expect(sanitizeRedirectPath(null)).toBe('/surveys');
    expect(sanitizeRedirectPath(undefined)).toBe('/surveys');
  });

  it('외부·프로토콜 상대·백슬래시 경로는 기본 경로로 — open redirect 차단', () => {
    for (const bad of ['https://evil.example', '//evil.example', '/\\evil.example']) {
      expect(sanitizeRedirectPath(bad)).toBe('/surveys');
    }
  });

  it('제어 문자로 // 검사를 우회하려는 경로는 기본 경로로', () => {
    for (const bad of ['/\t/evil.example', '/\n/evil.example', '\t//evil.example']) {
      expect(sanitizeRedirectPath(bad)).toBe('/surveys');
    }
  });

  it('루트와 로그인 페이지는 기본 경로로 — 로그인 직후 되돌아가는 의미가 없다', () => {
    expect(sanitizeRedirectPath('/')).toBe('/surveys');
    expect(sanitizeRedirectPath('/login')).toBe('/surveys');
    expect(sanitizeRedirectPath('/login?redirect=%2Fadmin')).toBe('/surveys');
  });
});

describe('sanitizeInternalPath', () => {
  it('내부 절대경로는 그대로, 그 외는 null — 파라미터를 아예 붙이지 않는 자리용', () => {
    expect(sanitizeInternalPath('/surveys/s1/operations/overview')).toBe(
      '/surveys/s1/operations/overview',
    );
    expect(sanitizeInternalPath('')).toBeNull();
    expect(sanitizeInternalPath(null)).toBeNull();
  });

  it('sanitizeRedirectPath 와 같은 차단 규칙을 쓴다 — 제어 문자 포함', () => {
    for (const bad of [
      'https://evil.example',
      '//evil.example',
      '/\\evil.example',
      '/\t/evil.example',
      '\t//evil.example',
    ]) {
      expect(sanitizeInternalPath(bad)).toBeNull();
    }
  });

  it('URL 해석이 지우는 탭·개행이나 역슬래시로 외부 호스트를 만드는 우회를 거부한다 (hotfix 이식)', () => {
    for (const raw of [
      '/\t/evil.example/signin',
      '/\n/evil.example',
      '/\r\n/evil.example',
      '/\t\\evil.example',
      '/x\\..\\..\\evil',
      '/\u0000/evil.example',
      '/\u007f/evil.example',
    ]) {
      expect(sanitizeInternalPath(raw)).toBeNull();
    }
  });

  it('같은 출처 내부 경로는 쿼리·해시와 함께 그대로 통과한다', () => {
    for (const path of ['/surveys', '/surveys/s1/preview?x=1&y=%2F%2F', '/surveys/s1/operations/profiles#row']) {
      expect(sanitizeInternalPath(path)).toBe(path);
    }
  });

  it('루트와 로그인 페이지는 그대로 통과한다 — 기본값 대체는 상위 함수 몫', () => {
    expect(sanitizeInternalPath('/')).toBe('/');
    expect(sanitizeInternalPath('/login')).toBe('/login');
  });
});
