import { describe, expect, it } from 'vitest';

import { adminPrefixRedirects } from '../../next.config';

// 옛 `/admin` 주소를 받는 리다이렉트 규칙. Next 는 **먼저 맞는 규칙 하나만** 적용하므로
// 순서가 곧 동작이다 — 옛 게스트 다리가 일반 규칙 뒤에 서면 한 번도 발화하지 않는다.
describe('adminPrefixRedirects', () => {
  const rules = adminPrefixRedirects();
  const indexOf = (source: string) => rules.findIndex((rule) => rule.source === source);

  it('옛 운영 콘솔 주소는 일반 규칙보다 먼저 다리 라우트로 간다', () => {
    const bare = indexOf('/admin/surveys/:surveyId/operations');
    const nested = indexOf('/admin/surveys/:surveyId/operations/:path*');
    const general = indexOf('/admin/:path*');

    expect(bare).toBeGreaterThanOrEqual(0);
    expect(nested).toBeGreaterThanOrEqual(0);
    expect(general).toBeGreaterThan(bare);
    expect(general).toBeGreaterThan(nested);
    expect(rules[bare]!.destination).toBe('/api/legacy-guest-link/:surveyId');
    expect(rules[nested]!.destination).toBe('/api/legacy-guest-link/:surveyId/:path*');
  });

  it('다리는 임시 리다이렉트다 — 영구(308)는 브라우저가 캐시해 걷어낼 수 없다', () => {
    for (const rule of rules.filter((r) => r.destination.startsWith('/api/legacy-guest-link'))) {
      expect(rule.permanent).toBe(false);
    }
  });

  it('나머지 옛 주소는 접두만 걷어 영구 이전한다', () => {
    const general = rules[indexOf('/admin/:path*')]!;

    expect(general.destination).toBe('/:path*');
    expect(general.permanent).toBe(true);
  });
});
