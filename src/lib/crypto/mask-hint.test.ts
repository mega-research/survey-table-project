import { describe, expect, it } from 'vitest';

import { maskHint } from '@/lib/crypto/mask-hint';

describe('maskHint', () => {
  it('빈/공백 값은 빈 문자열을 반환한다', () => {
    expect(maskHint('address', '')).toBe('');
    expect(maskHint('address', '   ')).toBe('');
  });

  it('email 은 local/domain 앞 3자만 노출한다', () => {
    expect(maskHint('email', 'asdfg@naver.com')).toBe('asd...@nav...');
  });

  it('휴대폰/전화/사업자번호는 앞자리만 노출한다', () => {
    expect(maskHint('mobile', '010-2233-4455')).toBe('010-22...');
    expect(maskHint('phone', '02-3456-7890')).toBe('02-345...');
    expect(maskHint('biz_number', '123-45-67890')).toBe('123-45...');
  });

  it('이름/담당자는 첫 글자만 노출한다', () => {
    expect(maskHint('name', '홍길동')).toBe('홍**');
    expect(maskHint('representative', '김담당')).toBe('김**');
  });

  describe('address', () => {
    it('공백으로 구분된 주소는 첫 단어만 노출하고 나머지는 가린다', () => {
      // 첫 토큰만 노출하고 뒤 토큰이 있으면 '...' 으로 가린다.
      expect(maskHint('address', '서울시 강남구 역삼동')).toBe('서울시...');
    });

    it('공백 없는 한글 주소도 전체가 노출되지 않는다', () => {
      // 회귀(M35): split(/\s+/)[0] 가 공백 없는 입력에서 전체 문자열을 반환해
      // 주소 PII 가 마스킹 없이 그대로 저장/표시되던 버그.
      const full = '서울특별시강남구테헤란로152';
      const masked = maskHint('address', full);
      expect(masked).not.toBe(full);
      expect(masked).toContain('...');
      expect(masked).toBe('서울특별시강...');
      // 노출 부분은 원본 앞부분 6자에 한정된다.
      expect([...masked.replace('...', '')].length).toBeLessThanOrEqual(6);
    });

    it('앞 6자 이하의 짧은 단일 토큰 주소는 그대로 노출한다', () => {
      expect(maskHint('address', '서울')).toBe('서울');
      expect(maskHint('address', '서울특별시강')).toBe('서울특별시강');
    });
  });
});
