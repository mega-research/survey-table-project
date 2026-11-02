import { describe, expect, it } from 'vitest';

import {
  INITIAL_ADVANCED_FILTERS,
  INITIAL_SURVEY_LIST_PAGE_QUERY,
  SurveyListPageInputSchema,
  isSurveyListDate,
} from './survey-builder-io';

describe('상세 검색 기간 날짜 — YYYY-MM-DD 꼴이고 달력에 있는 날짜만', () => {
  it('평범한 날짜·월말·윤년 2월 29일은 통과한다', () => {
    expect(isSurveyListDate('2026-11-02')).toBe(true);
    expect(isSurveyListDate('2026-01-31')).toBe(true);
    expect(isSurveyListDate('2026-04-30')).toBe(true);
    expect(isSurveyListDate('2028-02-29')).toBe(true);
    expect(isSurveyListDate('2000-02-29')).toBe(true);
  });

  it('달력에 없는 날짜는 꼴이 맞아도 거부한다', () => {
    expect(isSurveyListDate('2026-02-29')).toBe(false);
    expect(isSurveyListDate('1900-02-29')).toBe(false);
    expect(isSurveyListDate('2026-13-01')).toBe(false);
    expect(isSurveyListDate('2026-00-10')).toBe(false);
    expect(isSurveyListDate('2026-04-31')).toBe(false);
    expect(isSurveyListDate('2026-05-00')).toBe(false);
    expect(isSurveyListDate('2026-99-99')).toBe(false);
  });

  it('꼴이 다르면 거부한다', () => {
    expect(isSurveyListDate('2026-1-1')).toBe(false);
    expect(isSurveyListDate('20261102')).toBe(false);
    expect(isSurveyListDate('2026-11-02T00:00')).toBe(false);
    expect(isSurveyListDate(' 2026-11-02')).toBe(false);
    expect(isSurveyListDate('')).toBe(false);
  });

  it('서버 입력 스키마가 같은 기준으로 시작일·종료일을 거부한다', () => {
    const parse = (dateFrom: string | null, dateTo: string | null) =>
      SurveyListPageInputSchema.safeParse({
        ...INITIAL_SURVEY_LIST_PAGE_QUERY,
        scope: null,
        advanced: { ...INITIAL_ADVANCED_FILTERS, dateFrom, dateTo },
      }).success;
    expect(parse('2028-02-29', '2028-03-01')).toBe(true);
    expect(parse(null, null)).toBe(true);
    expect(parse('2026-02-29', null)).toBe(false);
    expect(parse(null, '2026-99-99')).toBe(false);
    expect(parse('2026-04-31', '2026-05-01')).toBe(false);
  });
});
