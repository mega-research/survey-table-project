import { describe, expect, it } from 'vitest';

import { getSurveyAccessUrl } from '@/lib/survey-url';

describe('getSurveyAccessUrl', () => {
  it('공개 설문 한글 슬러그를 공유용 URL path segment로 인코딩한다', () => {
    const slug = '2026년-심뇌혈관질환-조기증상-인지도-및-의료-이용의향-조사';

    const url = getSurveyAccessUrl(
      {
        id: 'survey-1',
        slug,
        settings: { isPublic: true },
      },
      'https://dev.megaresearch.co.kr',
    );

    expect(url).toBe(`https://dev.megaresearch.co.kr/survey/${encodeURIComponent(slug)}`);
  });
});
