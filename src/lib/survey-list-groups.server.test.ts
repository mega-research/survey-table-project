import { afterEach, describe, expect, it, vi } from 'vitest';

import { parseSurveyListGroups, withSurveyListGroup } from '@/lib/survey-list-groups.server';

afterEach(() => vi.unstubAllEnvs());

describe('parseSurveyListGroups', () => {
  it('묶음 이름=설문 id 목록을 설문 id → 묶음 이름으로 읽는다', () => {
    const map = parseSurveyListGroups('언론재단 만족도=s1, s2 ; 다른 묶음=s3');
    expect([...map]).toEqual([
      ['s1', '언론재단 만족도'],
      ['s2', '언론재단 만족도'],
      ['s3', '다른 묶음'],
    ]);
  });

  it('빈 값이면 아무것도 묶지 않는다', () => {
    expect(parseSurveyListGroups(undefined).size).toBe(0);
    expect(parseSurveyListGroups('').size).toBe(0);
  });

  it('형식이 틀린 항목은 무시하고 나머지는 읽는다', () => {
    const map = parseSurveyListGroups('이름만;=s1;  =s2;묶음=;정상=s9,,');
    expect([...map]).toEqual([['s9', '정상']]);
  });

  it('한 설문을 두 묶음에 적으면 먼저 적은 묶음이 이긴다', () => {
    expect(parseSurveyListGroups('가=s1;나=s1,s2').get('s1')).toBe('가');
  });
});

describe('withSurveyListGroup', () => {
  it('env 에 적힌 설문에만 묶음 이름을 붙이고 순서와 나머지 필드는 그대로 둔다', () => {
    vi.stubEnv('SURVEY_LIST_GROUPS', '묶음=s2');
    expect(
      withSurveyListGroup([
        { id: 's1', title: 'a' },
        { id: 's2', title: 'b' },
      ]),
    ).toEqual([
      { id: 's1', title: 'a', listGroup: null },
      { id: 's2', title: 'b', listGroup: '묶음' },
    ]);
  });

  it('env 가 없으면 모든 설문의 묶음이 null 이다', () => {
    vi.stubEnv('SURVEY_LIST_GROUPS', '');
    expect(withSurveyListGroup([{ id: 's1' }])).toEqual([{ id: 's1', listGroup: null }]);
  });
});
