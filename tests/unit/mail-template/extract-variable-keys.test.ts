import { describe, expect, it } from 'vitest';

import { extractVariableKeys } from '@/lib/mail/variable-extractor';

describe('extractVariableKeys', () => {
  it('단일 토큰 추출', () => {
    expect(extractVariableKeys('안녕 {{수행기관}}')).toEqual(['수행기관']);
  });
  it('여러 소스 통합 + 중복 제거', () => {
    const r = extractVariableKeys('{{a}} {{b}}', '{{b}} {{c}}', '{{a}}');
    expect(r.sort()).toEqual(['a', 'b', 'c']);
  });
  it('공백 트림', () => {
    expect(extractVariableKeys('{{ 수행기관 }}')).toEqual(['수행기관']);
  });
  it('토큰 없으면 빈 배열', () => {
    expect(extractVariableKeys('plain text')).toEqual([]);
  });
});
