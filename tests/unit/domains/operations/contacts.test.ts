import { describe, expect, it } from 'vitest';
import {
  CONTACTS_SORT_KEYS,
  CONTACTS_QFIELDS,
  CONTACTS_PAGE_SIZE,
  maskEmail,
  maskPhone,
  maskBizNumber,
  attrsKeyOf,
} from '@/lib/operations/contacts';

// normalizeContactListArgs / hasActiveContactFilters 테스트는 함수 제거와 함께 삭제됨
// (다중 조건 필터 모델로 전환 — page.tsx 가 인라인으로 page/sort/dir 파싱).

describe('maskEmail', () => {
  it('일반 이메일', () => {
    expect(maskEmail('hong.gildong@example.com')).toBe('ho***@***.com');
  });
  it('한 글자 로컬', () => {
    expect(maskEmail('a@example.com')).toBe('a***@***.com');
  });
  it('null/빈 문자 → "—"', () => {
    expect(maskEmail(null)).toBe('—');
    expect(maskEmail('')).toBe('—');
  });
  it('@ 없는 잘못된 입력 → "—"', () => {
    expect(maskEmail('not-an-email')).toBe('—');
  });
});

describe('maskPhone', () => {
  it('010 11자리', () => {
    expect(maskPhone('01012345678')).toBe('010-****-5678');
  });
  it('010 하이픈 포함', () => {
    expect(maskPhone('010-1234-5678')).toBe('010-****-5678');
  });
  it('숫자 4자 미만 → "—"', () => {
    expect(maskPhone('123')).toBe('—');
  });
  it('null → "—"', () => {
    expect(maskPhone(null)).toBe('—');
  });
});

describe('maskBizNumber', () => {
  it('10자리 사업자번호', () => {
    expect(maskBizNumber('1234567890')).toBe('123-**-*7890');
  });
  it('하이픈 포함 정규화', () => {
    expect(maskBizNumber('123-45-67890')).toBe('123-**-*7890');
  });
  it('자리수 부족 → "—"', () => {
    expect(maskBizNumber('123')).toBe('—');
  });
});

describe('whitelist exports', () => {
  it('CONTACTS_SORT_KEYS contains resid + respondedAt', () => {
    expect(CONTACTS_SORT_KEYS).toContain('resid');
    expect(CONTACTS_SORT_KEYS).toContain('respondedAt');
  });
  it('CONTACTS_PAGE_SIZE = 20', () => {
    expect(CONTACTS_PAGE_SIZE).toBe(20);
  });
  it('CONTACTS_QFIELDS contains all/resid/email/group', () => {
    expect(CONTACTS_QFIELDS).toEqual(expect.arrayContaining(['all', 'resid', 'email', 'group']));
  });
});

describe('attrsKeyOf', () => {
  it("'attrs.전시회명' → '전시회명'", () => {
    expect(attrsKeyOf('attrs.전시회명')).toBe('전시회명');
  });
  it("'system.resid' → null", () => {
    expect(attrsKeyOf('system.resid')).toBeNull();
  });
  it("빈 문자열 → null", () => {
    expect(attrsKeyOf('')).toBeNull();
  });
});
