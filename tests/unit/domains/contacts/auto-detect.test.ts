import { describe, expect, it } from 'vitest';
import {
  autoDetectPiiMapping,
  autoDetectSystemFields,
  detectPiiType,
} from '@/lib/contacts/auto-detect';

describe('autoDetectSystemFields', () => {
  it('group 자동 매칭은 "전시회명" 우선', () => {
    const headers = ['연번', '전시회명', '대륙', '기업명'];
    expect(autoDetectSystemFields(headers).group).toBe(1);
  });

  it('group 자동 매칭이 없으면 undefined 반환', () => {
    const headers = ['no', 'name', 'email'];
    expect(autoDetectSystemFields(headers).group).toBeUndefined();
  });

  it('PII (email/biz/phone) 는 더 이상 systemFields 에 속하지 않음 — autoDetectPiiMapping 참고', () => {
    const headers = ['연번', '전시회명', '이메일', '사업자번호', '전화'];
    const r = autoDetectSystemFields(headers);
    expect(r.group).toBe(1);
    // email/biz/phone 같은 키는 더 이상 존재하지 않음
    expect(Object.keys(r)).toEqual(['group']);
  });
});

describe('detectPiiType', () => {
  it('정확한 한국어 헤더 → PII 타입 매칭', () => {
    expect(detectPiiType('이메일')).toBe('email');
    expect(detectPiiType('사업자번호')).toBe('biz_number');
    expect(detectPiiType('이름')).toBe('name');
    expect(detectPiiType('주소')).toBe('address');
  });

  it('휴대폰 패턴은 phone 보다 먼저 mobile 로 매칭', () => {
    expect(detectPiiType('휴대폰')).toBe('mobile');
    expect(detectPiiType('휴대폰번호')).toBe('mobile');
    expect(detectPiiType('전화')).toBe('phone');
    expect(detectPiiType('전화번호')).toBe('phone');
  });

  it('변형 표현도 부분 포함으로 매칭', () => {
    expect(detectPiiType('담당자 이메일')).toBe('email');
    expect(detectPiiType('사업자등록번호')).toBe('biz_number');
    expect(detectPiiType('담당자 휴대폰번호')).toBe('mobile');
  });

  it('PII 키워드 없으면 undefined', () => {
    expect(detectPiiType('연번')).toBeUndefined();
    expect(detectPiiType('전시회명')).toBeUndefined();
    expect(detectPiiType('')).toBeUndefined();
  });
});

describe('autoDetectPiiMapping', () => {
  it('여러 PII 컬럼을 헤더 → 타입 매핑으로 반환', () => {
    const headers = ['연번', '전시회명', '담당자 이메일', '사업자번호', '담당자 휴대폰번호'];
    const mapping = autoDetectPiiMapping(headers);
    expect(mapping).toEqual({
      '담당자 이메일': 'email',
      '사업자번호': 'biz_number',
      '담당자 휴대폰번호': 'mobile',
    });
  });

  it('PII 키워드 없으면 빈 객체', () => {
    expect(autoDetectPiiMapping(['연번', '전시회명', '기업명'])).toEqual({});
  });
});
