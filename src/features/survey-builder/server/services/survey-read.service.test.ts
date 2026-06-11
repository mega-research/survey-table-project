import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Survey as SurveyType } from '@/types/survey';

// data/surveys.ts 의 단일 구현(매핑 SoT)에 위임하는지 검증한다.
// publish/analytics 와 빌더 read 가 동일 매핑을 공유하도록 강제하여
// "신규 질문 컬럼이 한쪽 사본에만 추가돼 publish 스냅샷/분석에서 누락"되는 divergence 를 차단한다.
vi.mock('@/data/surveys', () => ({
  getSurveyWithDetails: vi.fn(),
}));

import { getSurveyWithDetails as getSurveyWithDetailsData } from '@/data/surveys';

import { getSurveyWithDetails } from './survey-read.service';

const SURVEY_ID = 'survey-1';

describe('survey-read.service getSurveyWithDetails', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('data/surveys 의 단일 구현에 위임한다', async () => {
    const fake = { id: SURVEY_ID, title: 'T' } as unknown as SurveyType;
    vi.mocked(getSurveyWithDetailsData).mockResolvedValue(fake);

    const result = await getSurveyWithDetails(SURVEY_ID);

    expect(getSurveyWithDetailsData).toHaveBeenCalledWith(SURVEY_ID);
    expect(result).toBe(fake);
  });

  it('null 반환을 그대로 전달한다', async () => {
    vi.mocked(getSurveyWithDetailsData).mockResolvedValue(null);

    const result = await getSurveyWithDetails(SURVEY_ID);

    expect(result).toBeNull();
  });
});
