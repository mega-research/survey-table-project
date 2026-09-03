import { describe, expect, it } from 'vitest';

import { extractVariableKeys } from '@/lib/mail/variable-extractor';

// 소스는 배열 하나로 받는다 — rest+spread 는 대형 설문 규모 입력에서 V8 인자 상한
// RangeError 를 냈다 (Sentry 7665334735). 대형 입력 계약은 variable-extractor.test.ts 참조.
describe('extractVariableKeys', () => {
  it('단일 토큰 추출', () => {
    expect(extractVariableKeys(['안녕 {{수행기관}}'])).toEqual(['수행기관']);
  });
  it('여러 소스 통합 + 중복 제거', () => {
    const r = extractVariableKeys(['{{a}} {{b}}', '{{b}} {{c}}', '{{a}}']);
    expect(r.sort()).toEqual(['a', 'b', 'c']);
  });
  it('공백 트림', () => {
    expect(extractVariableKeys(['{{ 수행기관 }}'])).toEqual(['수행기관']);
  });
  it('토큰 없으면 빈 배열', () => {
    expect(extractVariableKeys(['plain text'])).toEqual([]);
  });
});
