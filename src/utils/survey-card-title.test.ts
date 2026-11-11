import { describe, expect, it } from 'vitest';

import {
  SURVEY_LIST_TITLE_MAX_LENGTH,
  compareSurveyCardTitle,
  hasOwnCardTitle,
  matchesSurveyListSearch,
  normalizeSurveyListTitle,
  surveyCardTitle,
} from './survey-card-title';

describe('surveyCardTitle', () => {
  it('카드 제목이 없으면 설문 제목을 그대로 보인다', () => {
    expect(surveyCardTitle({ title: '유가공업 실태조사', listTitle: null })).toBe('유가공업 실태조사');
    expect(surveyCardTitle({ title: '유가공업 실태조사' })).toBe('유가공업 실태조사');
  });

  it('카드 제목이 있으면 그것을 보인다', () => {
    expect(
      surveyCardTitle({ title: '부산지사 교육 수요자 만족도 조사', listTitle: '5-1. 부산지사 — 언론인 연수' }),
    ).toBe('5-1. 부산지사 — 언론인 연수');
  });

  it('공백뿐인 카드 제목은 없는 것으로 본다', () => {
    expect(surveyCardTitle({ title: '설문', listTitle: '   ' })).toBe('설문');
  });
});

describe('hasOwnCardTitle', () => {
  it('카드 제목이 설문 제목과 다를 때만 참이다', () => {
    expect(hasOwnCardTitle({ title: '설문', listTitle: '카드' })).toBe(true);
    expect(hasOwnCardTitle({ title: '설문', listTitle: null })).toBe(false);
    expect(hasOwnCardTitle({ title: '설문', listTitle: ' 설문 ' })).toBe(false);
    expect(hasOwnCardTitle({ title: '설문', listTitle: '' })).toBe(false);
  });
});

describe('normalizeSurveyListTitle', () => {
  it('비었거나 공백뿐이면 null — 설문 제목을 따라간다', () => {
    expect(normalizeSurveyListTitle('', '설문')).toBeNull();
    expect(normalizeSurveyListTitle('   ', '설문')).toBeNull();
    expect(normalizeSurveyListTitle(null, '설문')).toBeNull();
    expect(normalizeSurveyListTitle(undefined, '설문')).toBeNull();
  });

  it('설문 제목과 같으면 null — 따로 지은 것이 아니다', () => {
    expect(normalizeSurveyListTitle('유가공업 실태조사', '유가공업 실태조사')).toBeNull();
    expect(normalizeSurveyListTitle(' 유가공업  실태조사 ', '유가공업 실태조사')).toBeNull();
  });

  it('앞뒤 공백을 걷고 줄바꿈·연속 공백을 한 칸으로 접는다', () => {
    expect(normalizeSurveyListTitle('  1-1.  계약체결\n만족도 ', '설문')).toBe('1-1. 계약체결 만족도');
  });

  it('상한은 200자다', () => {
    expect(SURVEY_LIST_TITLE_MAX_LENGTH).toBe(200);
  });
});

describe('matchesSurveyListSearch', () => {
  const survey = { title: '지역신문발전기금 우선지원대상사 만족도 조사', listTitle: '5-3. 부산지사 — 우선지원대상사' };

  it('카드 제목으로 찾는다', () => {
    expect(matchesSurveyListSearch(survey, '부산지사')).toBe(true);
  });

  it('카드 제목을 따로 지었어도 설문 제목으로 찾는다', () => {
    expect(matchesSurveyListSearch(survey, '지역신문')).toBe(true);
  });

  it('대소문자를 가리지 않고 빈 검색어는 전부 맞는다', () => {
    expect(matchesSurveyListSearch({ title: 'AI 실태조사' }, 'ai')).toBe(true);
    expect(matchesSurveyListSearch(survey, '  ')).toBe(true);
  });

  it('어느 쪽에도 없으면 맞지 않는다', () => {
    expect(matchesSurveyListSearch(survey, '대구')).toBe(false);
  });
});

describe('compareSurveyCardTitle', () => {
  it('번호를 수로 읽어 2 가 10 앞에 온다', () => {
    const titles = ['10. 광고기획팀', '2. 미디어지원팀', '1-2. 경영지원팀', '1-1. 경영지원팀'].map(
      (listTitle) => ({ title: '설문', listTitle }),
    );
    expect(titles.sort(compareSurveyCardTitle).map((s) => s.listTitle)).toEqual([
      '1-1. 경영지원팀',
      '1-2. 경영지원팀',
      '2. 미디어지원팀',
      '10. 광고기획팀',
    ]);
  });

  it('카드 제목이 없는 설문은 설문 제목으로 견준다', () => {
    const list = [{ title: '나 설문' }, { title: '설문', listTitle: '가 카드' }];
    expect(list.sort(compareSurveyCardTitle).map(surveyCardTitle)).toEqual(['가 카드', '나 설문']);
  });
});
