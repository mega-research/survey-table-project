import { describe, expect, it } from 'vitest';

import {
  buildInviteUrl,
  generateInviteCode,
  getSurveyAccessIdentifier,
  getSurveyAccessUrl,
} from '@/lib/survey-url';

describe('getSurveyAccessUrl', () => {
  it('공개 설문 한글 슬러그를 인코딩 없이 원문 그대로 URL에 사용한다', () => {
    const slug = '2026년-심뇌혈관질환-조기증상-인지도-및-의료-이용의향-조사';

    const url = getSurveyAccessUrl(
      {
        id: 'survey-1',
        slug,
        settings: { isPublic: true },
      },
      'https://dev.megaresearch.co.kr',
    );

    expect(url).toBe(`https://dev.megaresearch.co.kr/survey/${slug}`);
  });
});

describe('getSurveyAccessIdentifier', () => {
  it('공개 설문은 slug 를 식별자로 쓴다', () => {
    expect(
      getSurveyAccessIdentifier({
        id: 'survey-1',
        slug: '게임-장르-기초조사',
        privateToken: 'tok-1',
        isPublic: true,
      }),
    ).toBe('게임-장르-기초조사');
  });

  it('공개 설문이지만 slug 가 없으면 id 로 폴백한다', () => {
    expect(
      getSurveyAccessIdentifier({ id: 'survey-1', slug: null, privateToken: 'tok-1', isPublic: true }),
    ).toBe('survey-1');
  });

  it('비공개 설문은 privateToken 을 식별자로 쓴다', () => {
    expect(
      getSurveyAccessIdentifier({
        id: 'survey-1',
        slug: '게임-장르-기초조사',
        privateToken: 'tok-1',
        isPublic: false,
      }),
    ).toBe('tok-1');
  });

  it('비공개 설문이지만 privateToken 이 없으면 id 로 폴백한다', () => {
    expect(
      getSurveyAccessIdentifier({ id: 'survey-1', slug: null, privateToken: null, isPublic: false }),
    ).toBe('survey-1');
  });
});

describe('buildInviteUrl', () => {
  it('baseUrl 과 코드로 /i/ 경로를 만든다', () => {
    expect(buildInviteUrl('aB3xY7Kw12', 'https://dev.megaresearch.co.kr')).toBe(
      'https://dev.megaresearch.co.kr/i/aB3xY7Kw12',
    );
  });

  it('빈 baseUrl 이면 상대 경로로 폴백한다', () => {
    expect(buildInviteUrl('code123', '')).toBe('/i/code123');
  });
});

describe('generateInviteCode', () => {
  it('10자 코드를 만든다', () => {
    expect(generateInviteCode()).toHaveLength(10);
  });

  it('호출마다 다른 값을 만든다', () => {
    expect(generateInviteCode()).not.toBe(generateInviteCode());
  });
});
