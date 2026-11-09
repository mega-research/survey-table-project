import { describe, expect, it } from 'vitest';

import {
  compactIdListValue,
  describeIdListValue,
  expandRangesToIds,
  isIdListSource,
  normalizePastedIdList,
} from './id-list-paste';

describe('isIdListSource — 붙여넣기 ID 목록을 받는 컬럼', () => {
  it('시스템ID 와 attrs 컬럼만', () => {
    expect(isIdListSource('system.resid')).toBe(true);
    expect(isIdListSource('attrs.ID')).toBe(true);
    expect(isIdListSource('system.all')).toBe(false);
    expect(isIdListSource('pii.이메일')).toBe(false);
    expect(isIdListSource('system.web')).toBe(false);
  });
});

describe('normalizePastedIdList — 엑셀 열/행 복사를 공백 구분 한 줄로', () => {
  it('개행·탭·연속 공백을 공백 하나로 접고 양끝을 자른다', () => {
    expect(normalizePastedIdList('99\r\n292\n\n235\t234  15\n')).toBe('99 292 235 234 15');
  });
});

describe('expandRangesToIds — 저장용 정수 목록 전개', () => {
  it('단건과 범위를 펼치고 상한을 넘으면 null', () => {
    expect(
      expandRangesToIds(
        [
          { from: 3, to: 3 },
          { from: 5, to: 7 },
        ],
        10,
      ),
    ).toEqual([3, 5, 6, 7]);
    expect(expandRangesToIds([{ from: 1, to: 100 }], 10)).toBeNull();
  });
});

describe('describeIdListValue — 위젯 배지/경고 판정', () => {
  it('목록 컬럼이 아니거나 빈 값이면 none', () => {
    expect(describeIdListValue('system.all', '1 2 3')).toEqual({ kind: 'none' });
    expect(describeIdListValue('system.resid', '   ')).toEqual({ kind: 'none' });
  });

  it('숫자 2개 이상이면 list — 개수·중복·상한 초과를 알린다', () => {
    expect(describeIdListValue('attrs.ID', '99 292 99')).toEqual({
      kind: 'list',
      count: 2,
      ids: 2,
      duplicates: 1,
      overLimit: false,
    });
    const big = Array.from({ length: 2001 }, (_, i) => String(i + 1)).join(' ');
    expect(describeIdListValue('system.resid', big)).toMatchObject({
      kind: 'list',
      count: 2001,
      overLimit: true,
    });
  });

  it('숫자 하나는 배지 없음 — 단일 값 검색은 종전 그대로', () => {
    expect(describeIdListValue('attrs.ID', '99')).toEqual({ kind: 'none' });
  });

  it('구간 하나라도 번호가 둘 이상이면 list — 합친 「1-100」 도 실제 번호 수를 알린다', () => {
    expect(describeIdListValue('system.resid', '1-100')).toEqual({
      kind: 'list',
      count: 1,
      ids: 100,
      duplicates: 0,
      overLimit: false,
    });
    expect(describeIdListValue('attrs.ID', '1-10, 5, 200-201')).toMatchObject({
      kind: 'list',
      count: 3,
      ids: 12,
    });
  });

  it('시스템ID 는 숫자 아닌 토큰이 하나라도 있으면 invalid', () => {
    expect(describeIdListValue('system.resid', '99 abc')).toEqual({
      kind: 'invalid',
      count: 1,
      invalid: ['abc'],
    });
  });

  it('attrs 는 숫자가 2개 이상 섞인 경우에만 invalid — 일반 텍스트 검색("메가 리서치")은 none', () => {
    expect(describeIdListValue('attrs.회사명', '메가 리서치')).toEqual({ kind: 'none' });
    expect(describeIdListValue('attrs.ID', '99 292 A-102 미확인')).toEqual({
      kind: 'invalid',
      count: 2,
      invalid: ['A-102', '미확인'],
    });
  });

  it('attrs 는 앞에 0 이 붙은 번호("0001")를 leadingZero 로 알린다 — 서버가 숫자로 접지 않는 값', () => {
    expect(describeIdListValue('attrs.ID', '0001 0002 15')).toEqual({
      kind: 'leadingZero',
      tokens: ['0001', '0002'],
    });
    // 시스템ID 는 정수 컬럼이라 007 = 7 로 그대로 숫자 매칭된다
    expect(describeIdListValue('system.resid', '007 8')).toEqual({
      kind: 'list',
      count: 2,
      ids: 2,
      duplicates: 0,
      overLimit: false,
    });
  });

  it('attrs 의 앞자리 0 토큰 하나("010-1234")는 종전대로 none — 서버가 텍스트 검색으로 받는 값', () => {
    expect(describeIdListValue('attrs.전화', '010-1234')).toEqual({ kind: 'none' });
    expect(describeIdListValue('attrs.코드', '0001')).toEqual({ kind: 'none' });
  });

  it('저장 토큰은 token — 개수 접미사를 그대로 보여준다', () => {
    expect(
      describeIdListValue('attrs.ID', 'list:0f3a4b5c-1111-4222-8333-444455556666:5000'),
    ).toEqual({ kind: 'token', count: 5000 });
  });
});

describe('compactIdListValue — 조건 줄 값의 연속 번호 합치기', () => {
  it('시스템ID·명단 열 목록이면 구간으로 합친다', () => {
    expect(compactIdListValue('system.resid', '3 1 2 9')).toBe('1-3, 9');
    expect(compactIdListValue('attrs.ID', '5\n6\n7')).toBe('5-7');
  });

  it('목록 칸이 아니거나 여러 값 구분자 형식이면 손대지 않는다', () => {
    expect(compactIdListValue('pii.name', '1 2 3')).toBe('1 2 3');
    expect(compactIdListValue('system.web', '1 2')).toBe('1 2');
    const multi = '\u001f3\u001f1\u001f2\u001f';
    expect(compactIdListValue('attrs.기업명', multi)).toBe(multi);
  });
});
