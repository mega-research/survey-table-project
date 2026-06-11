import { describe, expect, it } from 'vitest';

import { parseCsvLine } from '@/components/survey-builder/lookup-csv-import';

describe('parseCsvLine', () => {
  it('단순 콤마 구분 필드를 분리한다', () => {
    expect(parseCsvLine('City,Country,Code')).toEqual(['City', 'Country', 'Code']);
  });

  it('필드 앞뒤 공백을 trim 한다', () => {
    expect(parseCsvLine(' City , Country , Code ')).toEqual([
      'City',
      'Country',
      'Code',
    ]);
  });

  it('따옴표로 감싼 필드 안의 콤마는 분리하지 않는다', () => {
    // "Seoul, Korea" 가 한 칸으로 밀려 컬럼이 어긋나던 버그 회귀 방지
    expect(parseCsvLine('City,"Seoul, Korea",KR')).toEqual([
      'City',
      'Seoul, Korea',
      'KR',
    ]);
  });

  it('따옴표로 감싼 마지막 필드도 올바르게 처리한다', () => {
    expect(parseCsvLine('KR,"Seoul, Korea"')).toEqual(['KR', 'Seoul, Korea']);
  });

  it('이스케이프된 따옴표("")를 단일 따옴표로 복원한다', () => {
    expect(parseCsvLine('A,"say ""hi""",B')).toEqual(['A', 'say "hi"', 'B']);
  });

  it('빈 필드를 보존한다', () => {
    expect(parseCsvLine('A,,C')).toEqual(['A', '', 'C']);
  });

  it('인용된 빈 필드를 보존한다', () => {
    expect(parseCsvLine('A,"",C')).toEqual(['A', '', 'C']);
  });

  it('따옴표가 없는 단일 필드를 반환한다', () => {
    expect(parseCsvLine('OnlyOne')).toEqual(['OnlyOne']);
  });
});
