import { describe, expect, it } from 'vitest';

import {
  normalizePii,
  type PiiFieldType,
} from '@/lib/crypto/pii-fields';

describe('normalizePii', () => {
  it('빈/공백 값은 빈 문자열로 정규화한다', () => {
    expect(normalizePii('name', '')).toBe('');
    expect(normalizePii('name', '   ')).toBe('');
  });

  it('email 은 소문자화하고 최소 형식 검증한다', () => {
    expect(normalizePii('email', '  Foo@Bar.com ')).toBe('foo@bar.com');
    // local 또는 domain 누락 / TLD 없음 → 빈 문자열
    expect(normalizePii('email', '@bar.com')).toBe('');
    expect(normalizePii('email', 'foo@')).toBe('');
    expect(normalizePii('email', 'foo@bar')).toBe('');
  });

  it('전화/사업자번호는 숫자만 남긴다', () => {
    expect(normalizePii('mobile', '010-1234-5678')).toBe('01012345678');
    expect(normalizePii('phone', '(02) 123-4567')).toBe('021234567');
    expect(normalizePii('biz_number', '123-45-67890')).toBe('1234567890');
  });

  it('이름/담당자/주소는 연속 공백을 단일 공백으로 합친다', () => {
    expect(normalizePii('name', '홍   길동')).toBe('홍 길동');
    expect(normalizePii('address', '서울시   강남구\t역삼동')).toBe('서울시 강남구 역삼동');
  });

  it('union 외 fieldType(경계 z.custom 통과분)도 빈 문자열을 반환하지 않고 공백 정규화로 폴백한다', () => {
    // 회귀: default 가 없으면 switch 를 빠져나가 undefined 를 반환하여
    // blindIndex 가 빈 문자열이 되고 PII 가 조용히 누락됐다.
    const unknown = 'Email' as unknown as PiiFieldType; // 대문자 등 union 외 값
    const result = normalizePii(unknown, '  hello   world ');
    expect(result).toBe('hello world');
    expect(result).not.toBe('');
    expect(result).toBeDefined();
  });
});
