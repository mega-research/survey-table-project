import { describe, expect, it } from 'vitest';
import { substituteTokens } from '@/lib/survey/substitute-tokens';

describe('substituteTokens', () => {
  it('단순 키 치환', () => {
    expect(substituteTokens('안녕 {{name}}', { name: '홍길동' })).toBe('안녕 홍길동');
  });

  it('한글 키 치환', () => {
    expect(substituteTokens('{{전시회명}} 안내', { 전시회명: 'AKEI 2026' })).toBe(
      'AKEI 2026 안내',
    );
  });

  it('동일 키 다회 치환', () => {
    expect(substituteTokens('{{x}} {{x}}', { x: 'A' })).toBe('A A');
  });

  it('미해결 키는 빈 문자열로', () => {
    expect(substituteTokens('A {{missing}} B', {})).toBe('A  B');
  });

  it('값이 빈 문자열이면 빈 문자열로 치환', () => {
    expect(substituteTokens('A{{x}}B', { x: '' })).toBe('AB');
  });

  it('템플릿 자체가 빈 문자열이면 빈 문자열', () => {
    expect(substituteTokens('', { x: 'A' })).toBe('');
  });

  it('attrs가 빈 객체여도 안전', () => {
    expect(substituteTokens('A{{x}}B', {})).toBe('AB');
  });

  it('키 좌우 공백 trim', () => {
    expect(substituteTokens('{{ name }}', { name: '홍길동' })).toBe('홍길동');
  });

  it('HTML 안의 토큰 치환 — 태그 깨지지 않음', () => {
    const input = '<p>전시회: <strong>{{전시회명}}</strong></p>';
    expect(substituteTokens(input, { 전시회명: 'AKEI' })).toBe(
      '<p>전시회: <strong>AKEI</strong></p>',
    );
  });

  it('치환값에 HTML 들어있어도 escape 안 함 (호출자 책임)', () => {
    expect(substituteTokens('{{x}}', { x: '<script>' })).toBe('<script>');
  });
});
