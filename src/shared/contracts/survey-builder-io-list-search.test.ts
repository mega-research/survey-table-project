import { describe, expect, it } from 'vitest';

import {
  INITIAL_SURVEY_LIST_PAGE_QUERY,
  SurveyListPageInputSchema,
  isSurveyListSearchWithinLimits,
  splitSurveyListSearchWords,
} from './survey-builder-io';

describe('splitSurveyListSearchWords', () => {
  it('공백으로 나누고 연속·앞뒤 공백과 빈 조각은 버린다', () => {
    expect(splitSurveyListSearchWords('  2026   실태\tA사\n')).toEqual(['2026', '실태', 'A사']);
    expect(splitSurveyListSearchWords('')).toEqual([]);
    expect(splitSurveyListSearchWords('   ')).toEqual([]);
  });

  it('% · _ · 역슬래시는 단어 안의 글자로 남는다', () => {
    expect(splitSurveyListSearchWords('100%_ C:\\자료')).toEqual(['100%_', 'C:\\자료']);
  });
});

describe('검색어 상한 — 단어 8개, 100자', () => {
  const eight = '가 나 다 라 마 바 사 아';
  const nine = `${eight} 자`;

  it('단어 8개·100자까지는 안, 넘으면 밖이다', () => {
    expect(isSurveyListSearchWithinLimits(eight)).toBe(true);
    expect(isSurveyListSearchWithinLimits(nine)).toBe(false);
    expect(isSurveyListSearchWithinLimits('가'.repeat(100))).toBe(true);
    expect(isSurveyListSearchWithinLimits('가'.repeat(101))).toBe(false);
    // 공백만 많은 것은 단어 수에 들지 않는다.
    expect(isSurveyListSearchWithinLimits(`${eight}        `)).toBe(true);
  });

  it('서버 입력 스키마가 같은 기준으로 거부한다', () => {
    const parse = (q: string) =>
      SurveyListPageInputSchema.safeParse({ ...INITIAL_SURVEY_LIST_PAGE_QUERY, scope: null, q })
        .success;
    expect(parse(eight)).toBe(true);
    expect(parse(nine)).toBe(false);
    expect(parse('가'.repeat(100))).toBe(true);
    expect(parse('가'.repeat(101))).toBe(false);
  });
});
