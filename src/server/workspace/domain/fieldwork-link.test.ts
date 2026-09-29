import { describe, expect, it } from 'vitest';

import {
  FIELDWORK_LINK_PASSWORD_MIN_LENGTH,
  generateFieldworkLinkPassword,
  generateFieldworkLinkToken,
  normalizeFieldworkLinkPassword,
} from './fieldwork-link';

/**
 * 외주 실사 링크의 값 생성 규칙 (ADR-0026).
 *
 * 난수를 재현할 수는 없으니 **성질**을 본다 — 길이·문자셋·유일성. 특히 문자셋은 이 값이 전화로
 * 읽어 주는 값이라는 사실에서 나온 정책이라, 혼동 문자가 다시 들어오면 여기서 빨개져야 한다.
 */

describe('generateFieldworkLinkToken', () => {
  it('16자이고 URL-safe 문자만 쓴다', () => {
    for (let i = 0; i < 50; i += 1) {
      const token = generateFieldworkLinkToken();
      expect(token).toHaveLength(16);
      expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
    }
  });

  it('부딪히지 않는다', () => {
    const tokens = new Set(Array.from({ length: 500 }, generateFieldworkLinkToken));
    expect(tokens.size).toBe(500);
  });
});

describe('generateFieldworkLinkPassword', () => {
  it('최소 길이를 넘고 최소 길이 상수보다 짧지 않다', () => {
    const password = generateFieldworkLinkPassword();
    expect(password.length).toBeGreaterThanOrEqual(FIELDWORK_LINK_PASSWORD_MIN_LENGTH);
  });

  /** 전화로 읽어 주는 값이라 `0 O o 1 l I` 는 들어가지 않는다. */
  it('혼동 문자를 쓰지 않는다', () => {
    const sample = Array.from({ length: 300 }, generateFieldworkLinkPassword).join('');
    expect(sample).not.toMatch(/[0Oo1lI]/);
    expect(sample).toMatch(/^[A-Za-z2-9]+$/);
  });

  it('같은 값을 반복해 내지 않는다', () => {
    const passwords = new Set(Array.from({ length: 200 }, generateFieldworkLinkPassword));
    expect(passwords.size).toBe(200);
  });

  /** 문자셋 전체가 실제로 쓰여야 한다 — modulo 버림이 뒤쪽 문자를 통째로 날리면 여기서 걸린다. */
  it('대문자·소문자·숫자가 모두 나온다', () => {
    const sample = Array.from({ length: 200 }, generateFieldworkLinkPassword).join('');
    expect(sample).toMatch(/[A-Z]/);
    expect(sample).toMatch(/[a-z]/);
    expect(sample).toMatch(/[2-9]/);
  });
});

describe('normalizeFieldworkLinkPassword', () => {
  it('앞뒤 공백을 버린다 — 붙여넣기에서 따라오는 공백이 「맞는데 안 되는」 암호를 만든다', () => {
    expect(normalizeFieldworkLinkPassword('  Kq7mZt2b  ')).toBe('Kq7mZt2b');
  });

  it('가운데 공백은 그대로 둔다 — 일부러 넣은 구분일 수 있다', () => {
    expect(normalizeFieldworkLinkPassword('Kq7m Zt2b')).toBe('Kq7m Zt2b');
  });
});
