import { describe, expect, it } from 'vitest';

import { securityHeaders } from '../../next.config';

// 전역 보안 헤더 정의 검증.
// next.config.ts 의 securityHeaders() 는 next 의 headers() 가 소비하는
// 순수 함수로, 전 라우트('/(.*)') 에 적용할 헤더 목록을 반환한다.
describe('securityHeaders', () => {
  it('전 라우트에 5개 보안 헤더를 적용하는 단일 규칙을 반환한다', () => {
    const rules = securityHeaders();

    expect(rules).toHaveLength(1);
    const rule = rules[0]!;
    expect(rule.source).toBe('/(.*)');

    const map = new Map(rule.headers.map((h) => [h.key, h.value]));

    expect(map.get('X-Frame-Options')).toBe('SAMEORIGIN');
    expect(map.get('X-Content-Type-Options')).toBe('nosniff');
    expect(map.get('Referrer-Policy')).toBe('strict-origin-when-cross-origin');
    expect(map.get('Strict-Transport-Security')).toBe(
      'max-age=63072000; includeSubDomains; preload',
    );
    expect(map.get('Permissions-Policy')).toBe(
      'camera=(), microphone=(), geolocation=(), interest-cohort=()',
    );
  });
});
