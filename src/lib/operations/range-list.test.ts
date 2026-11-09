import { describe, expect, it } from 'vitest';

import {
  SINGLE_COLUMN_ID_LIST_MAX,
  compactIdList,
  countDistinctIds,
  hasLeadingZeroToken,
  parseIdListDetailed,
  parseIdListInput,
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

describe('compactIdList — 연속 번호를 구간으로 합치기', () => {
  it('엑셀에서 붙여넣은 연속 번호를 구간 하나로', () => {
    const pasted = Array.from({ length: 100 }, (_, i) => String(i + 1)).join(' ');
    expect(compactIdList(pasted)).toBe('1-100');
  });

  it('끊긴 곳마다 구간을 나눈다 — 1-100, 200-300', () => {
    const a = Array.from({ length: 100 }, (_, i) => i + 1);
    const b = Array.from({ length: 101 }, (_, i) => i + 200);
    expect(compactIdList([...a, ...b].join('\n'))).toBe('1-100, 200-300');
  });

  it('오름차순으로 세우고 외톨이 번호는 그대로 둔다', () => {
    expect(compactIdList('9 3 1 2 7')).toBe('1-3, 7, 9');
  });

  it('겹치거나 맞닿은 구간·중복도 합친다', () => {
    expect(compactIdList('1-10, 5, 11 12-15 3 3')).toBe('1-15');
    expect(compactIdList('20-30 10-19')).toBe('10-30');
  });

  it('합친 결과는 같은 번호 집합을 고른다', () => {
    const input = '5 1 2 3 40-42 43 100 101 7';
    const expand = (s: string) =>
      new Set(
        (parseIdListInput(s, { maxTokens: 10_000 }) ?? []).flatMap((r) =>
          Array.from({ length: r.to - r.from + 1 }, (_, i) => r.from + i),
        ),
      );
    expect(expand(compactIdList(input))).toEqual(expand(input));
  });

  it('토큰 수를 늘리지 않는다 — 인라인 상한 판정이 나빠지지 않는다', () => {
    expect(compactIdList('1 3 5')).toBe('1, 3, 5');
  });

  it('숫자·범위가 아닌 토큰이 섞이거나 앞자리 0 이면 손대지 않는다', () => {
    expect(compactIdList('1 2 abc')).toBe('1 2 abc');
    expect(compactIdList('짝수')).toBe('짝수');
    expect(compactIdList('list:0f3a4b5c-1111-4222-8333-444455556666:5000')).toBe(
      'list:0f3a4b5c-1111-4222-8333-444455556666:5000',
    );
    expect(compactIdList('0001 0002 3')).toBe('0001 0002 3');
    expect(compactIdList('  ')).toBe('  ');
  });

  it('토큰 상한(200)과 무관하게 합친다', () => {
    const many = Array.from({ length: 5000 }, (_, i) => String(i + 1)).join(' ');
    expect(compactIdList(many)).toBe('1-5000');
  });
});

describe('countDistinctIds — 겹침을 뺀 실제 번호 수', () => {
  it('구간을 펼친 고유 번호 수', () => {
    expect(
      countDistinctIds([
        { from: 1, to: 10 },
        { from: 5, to: 12 },
        { from: 20, to: 20 },
      ]),
    ).toBe(13);
    expect(countDistinctIds([])).toBe(0);
  });
});
