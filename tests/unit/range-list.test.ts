import { describe, it, expect } from 'vitest';

import {
  hasLeadingZeroToken,
  parseIdListDetailed,
  parseIdListInput,
  SINGLE_COLUMN_ID_LIST_MAX,
} from '@/lib/operations/range-list';

describe('parseIdListInput', () => {
  it('parses a single integer', () => {
    expect(parseIdListInput('5')).toEqual([{ from: 5, to: 5 }]);
  });

  it('parses a simple range', () => {
    expect(parseIdListInput('1-30')).toEqual([{ from: 1, to: 30 }]);
  });

  it('parses mixed list of singles and ranges', () => {
    expect(parseIdListInput('1-30, 45')).toEqual([
      { from: 1, to: 30 },
      { from: 45, to: 45 },
    ]);
  });

  it('tolerates whitespace around separators', () => {
    expect(parseIdListInput('  1 - 30 ,  45  ')).toEqual([
      { from: 1, to: 30 },
      { from: 45, to: 45 },
    ]);
  });

  it('swaps reversed ranges', () => {
    expect(parseIdListInput('50-10')).toEqual([{ from: 10, to: 50 }]);
  });

  it('rejects empty input', () => {
    expect(parseIdListInput('')).toBeNull();
    expect(parseIdListInput('   ')).toBeNull();
  });

  it('연속·선행·후행 구분자를 허용한다 — 엑셀 붙여넣기 흔적("549,")', () => {
    expect(parseIdListInput('1,,2')).toEqual([
      { from: 1, to: 1 },
      { from: 2, to: 2 },
    ]);
    expect(parseIdListInput('1,')).toEqual([{ from: 1, to: 1 }]);
    expect(parseIdListInput(',1')).toEqual([{ from: 1, to: 1 }]);
  });

  it('공백·개행·탭·세미콜론도 구분자 — 엑셀 열 복사는 개행, 여러 열은 탭', () => {
    expect(parseIdListInput('99\n292\n235')).toEqual([
      { from: 99, to: 99 },
      { from: 292, to: 292 },
      { from: 235, to: 235 },
    ]);
    expect(parseIdListInput('99\t292 235;234\r\n')).toHaveLength(4);
  });

  it('중복 ID·중복 범위는 하나로 접는다', () => {
    expect(parseIdListInput('5 5 5-7 7-5')).toEqual([
      { from: 5, to: 5 },
      { from: 5, to: 7 },
    ]);
  });

  it('maxTokens 옵션으로 상한을 올릴 수 있다 — 단일 컬럼 인라인 상한 2,000', () => {
    const list = Array.from({ length: 500 }, (_, i) => String(i + 1)).join(' ');
    expect(parseIdListInput(list)).toBeNull();
    expect(parseIdListInput(list, { maxTokens: SINGLE_COLUMN_ID_LIST_MAX })).toHaveLength(500);
    expect(SINGLE_COLUMN_ID_LIST_MAX).toBe(2000);
  });

  it('rejects decimals', () => {
    expect(parseIdListInput('1.5')).toBeNull();
  });

  it('rejects values larger than int32 max', () => {
    expect(parseIdListInput('2147483648')).toBeNull();
  });

  it('rejects text', () => {
    expect(parseIdListInput('abc')).toBeNull();
    expect(parseIdListInput('1-abc')).toBeNull();
  });

  it('rejects zero (resid 는 1 부터 시작)', () => {
    expect(parseIdListInput('0')).toBeNull();
    expect(parseIdListInput('0-5')).toBeNull();
    expect(parseIdListInput('5-0')).toBeNull();
  });

  it('토큰 200개까지 허용, 초과는 null — 전체 검색 컬럼 곱연산 SQL 폭증 상한', () => {
    const ok = Array.from({ length: 200 }, (_, i) => String(i + 1)).join(',');
    expect(parseIdListInput(ok)).toHaveLength(200);
    const over = Array.from({ length: 201 }, (_, i) => String(i + 1)).join(',');
    expect(parseIdListInput(over)).toBeNull();
  });
});

describe('parseIdListDetailed — 위젯 배지/경고용 상세 결과', () => {
  it('인식 개수·중복 제거 수·숫자 아닌 토큰을 함께 돌려준다', () => {
    const r = parseIdListDetailed('99 abc 292 xyz 99');
    expect(r.ranges).toEqual([
      { from: 99, to: 99 },
      { from: 292, to: 292 },
    ]);
    expect(r.count).toBe(2);
    expect(r.duplicates).toBe(1);
    expect(r.invalid).toEqual(['abc', 'xyz']);
    expect(r.overLimit).toBe(false);
  });

  it('상한 초과는 overLimit 로 알리고 목록은 그대로 돌려준다 — 위젯이 저장 경로로 안내', () => {
    const list = Array.from({ length: 201 }, (_, i) => String(i + 1)).join(' ');
    const r = parseIdListDetailed(list);
    expect(r.overLimit).toBe(true);
    expect(r.count).toBe(201);
    expect(parseIdListInput(list)).toBeNull();
  });

  it('빈 입력은 count 0', () => {
    expect(parseIdListDetailed('  \n ')).toMatchObject({ count: 0, invalid: [], overLimit: false });
  });
});

describe('hasLeadingZeroToken — attrs 숫자 매칭에서 제외할 선행 0 토큰', () => {
  it('구분자 뒤의 0 으로 시작하는 두 자리 이상 토큰만', () => {
    expect(hasLeadingZeroToken('0001 2')).toBe(true);
    expect(hasLeadingZeroToken('1;07')).toBe(true);
    expect(hasLeadingZeroToken('10 20 0')).toBe(false);
    expect(hasLeadingZeroToken('1-30')).toBe(false);
  });
});
