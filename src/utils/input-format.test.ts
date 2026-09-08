import { describe, expect, it } from 'vitest';

import { INPUT_FORMATS, type InputFormat } from '@/types/input-type';

import { parseInputFormat } from './input-format';

/** 통과 케이스 — 넣은 값과 나와야 할 정규형. */
const PASS: Array<[InputFormat, string, string]> = [
  // 휴대전화 — 식별번호 6종 + 7·8자리 가입자번호
  ['mobile', '01012345678', '010-1234-5678'],
  ['mobile', '010 1234 5678', '010-1234-5678'],
  ['mobile', '010-1234-5678', '010-1234-5678'],
  ['mobile', ' 010.1234.5678 ', '010-1234-5678'],
  ['mobile', '(010) 1234-5678', '010-1234-5678'],
  ['mobile', '0112345678', '011-234-5678'],
  ['mobile', '01123456789', '011-2345-6789'],
  ['mobile', '0161234567', '016-123-4567'],
  ['mobile', '0171234567', '017-123-4567'],
  ['mobile', '0181234567', '018-123-4567'],
  ['mobile', '0191234567', '019-123-4567'],
  // 전화 — 유선 + 휴대 모두
  ['phone', '021234567', '02-123-4567'],
  ['phone', '0212345678', '02-1234-5678'],
  ['phone', '02-1234-5678', '02-1234-5678'],
  ['phone', '0311234567', '031-123-4567'],
  ['phone', '03112345678', '031-1234-5678'],
  ['phone', '0641234567', '064-123-4567'],
  ['phone', '0701234567', '070-123-4567'],
  ['phone', '07012345678', '070-1234-5678'],
  ['phone', '01012345678', '010-1234-5678'],
  ['phone', '010 1234 5678', '010-1234-5678'],
  // 사업자번호 — 실제 유효 번호(체크섬 통과)
  ['biz_number', '1248100998', '124-81-00998'],
  ['biz_number', '124-81-00998', '124-81-00998'],
  ['biz_number', '124 81 00998', '124-81-00998'],
  ['biz_number', '2208162517', '220-81-62517'],
  // 법인번호 — 실제 유효 번호(체크섬 통과)
  ['corp_number', '1301110006246', '130111-0006246'],
  ['corp_number', '130111-0006246', '130111-0006246'],
  ['corp_number', '130111 0006246', '130111-0006246'],
  // 이메일 — 소문자 정규화
  ['email', 'a@b.co.kr', 'a@b.co.kr'],
  ['email', ' Hong.Gil-Dong@Example.CO.KR ', 'hong.gil-dong@example.co.kr'],
  ['email', 'user+tag@sub.example.com', 'user+tag@sub.example.com'],
];

/** 실패 케이스 — 넣은 값과 나와야 할 사유. */
const FAIL: Array<[InputFormat, string, string]> = [
  // 식별번호가 아님
  ['mobile', '0212345678', 'unknown_prefix'],
  ['mobile', '0311234567', 'unknown_prefix'],
  ['mobile', '1111111111', 'unknown_prefix'],
  ['mobile', '0101234567890', 'wrong_length'],
  ['mobile', '0101234', 'wrong_length'],
  ['mobile', '010-1234-567a', 'not_a_number'],
  ['mobile', '010일이삼사', 'not_a_number'],
  // 전화 — 지역번호·식별번호 어디에도 없음
  ['phone', '1544-1234', 'unknown_prefix'],
  ['phone', '0091234567', 'unknown_prefix'],
  ['phone', '021234', 'wrong_length'],
  ['phone', '02123456789', 'wrong_length'],
  ['phone', '031-123-456a', 'not_a_number'],
  // 사업자번호
  ['biz_number', '124810099', 'wrong_length'],
  ['biz_number', '12481009988', 'wrong_length'],
  ['biz_number', '1111111111', 'checksum_mismatch'],
  ['biz_number', '1248100997', 'checksum_mismatch'],
  ['biz_number', '0000000000', 'checksum_mismatch'],
  ['biz_number', '124-81-0099a', 'not_a_number'],
  // 법인번호
  ['corp_number', '130111000624', 'wrong_length'],
  ['corp_number', '13011100062466', 'wrong_length'],
  ['corp_number', '1301110006245', 'checksum_mismatch'],
  ['corp_number', '1111111111111', 'checksum_mismatch'],
  ['corp_number', '130111-000624a', 'not_a_number'],
  // 이메일
  ['email', 'a@b', 'malformed'],
  ['email', 'a@b.', 'malformed'],
  ['email', '@example.com', 'malformed'],
  ['email', 'user@', 'malformed'],
  ['email', 'user example@a.com', 'malformed'],
  ['email', 'user@@example.com', 'malformed'],
  ['email', 'user@exam ple.com', 'malformed'],
  ['email', 'user@.example.com', 'malformed'],
  ['email', 'user@example..com', 'malformed'],
];

describe('parseInputFormat', () => {
  it.each(PASS)('%s "%s" → %s', (format, raw, normalized) => {
    expect(parseInputFormat(format, raw)).toEqual({ ok: true, normalized });
  });

  it.each(FAIL)('%s "%s" → %s', (format, raw, reason) => {
    expect(parseInputFormat(format, raw)).toEqual({ ok: false, reason });
  });

  it('빈 값은 형식 검사 대상이 아니다 — 필수 판정은 호출부 소관', () => {
    for (const format of INPUT_FORMATS) {
      expect(parseInputFormat(format, '')).toEqual({ ok: true, normalized: '' });
      expect(parseInputFormat(format, '   ')).toEqual({ ok: true, normalized: '' });
    }
  });

  it('phone 은 휴대 번호를 통과시키고 mobile 은 유선 번호를 거부한다', () => {
    expect(parseInputFormat('phone', '010-1234-5678')).toEqual({
      ok: true,
      normalized: '010-1234-5678',
    });
    expect(parseInputFormat('mobile', '02-1234-5678')).toEqual({
      ok: false,
      reason: 'unknown_prefix',
    });
  });

  it('표기가 달라도 같은 정규형으로 수렴한다', () => {
    const variants = ['01012345678', '010-1234-5678', '010 1234 5678', '(010)1234.5678'];
    const normalized = variants.map((v) => {
      const r = parseInputFormat('mobile', v);
      return r.ok ? r.normalized : `실패:${r.reason}`;
    });
    expect(new Set(normalized)).toEqual(new Set(['010-1234-5678']));
  });

  it('이미 정규형인 값을 다시 넣어도 같은 값이 나온다 (멱등)', () => {
    for (const [format, , normalized] of PASS) {
      expect(parseInputFormat(format, normalized)).toEqual({ ok: true, normalized });
    }
  });
});
