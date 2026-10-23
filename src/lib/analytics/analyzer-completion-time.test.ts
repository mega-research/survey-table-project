import { describe, expect, it } from 'vitest';

import { analyzeSurvey } from '@/lib/analytics/analyzer';
import type { SurveyResponse } from '@/db/schema';

// analyzeSurvey 가 읽는 필드만 채운 최소 응답 fixture. 그 외 컬럼은 집계에 무관.
function makeResponse(opts: {
  id: string;
  startedAt: string;
  completedAt: string;
  totalSeconds: number | null;
}): SurveyResponse {
  return {
    id: opts.id,
    startedAt: new Date(opts.startedAt),
    completedAt: new Date(opts.completedAt),
    isCompleted: true,
    totalSeconds: opts.totalSeconds,
    questionResponses: {},
  } as unknown as SurveyResponse;
}

const survey = { id: 'survey-1', title: '제목', questions: [] as never[] };

describe('analyzeSurvey 평균 완료 시간', () => {
  it('실제 응답한 시간(totalSeconds)으로 잰다 — 이탈·쿼터마감 뒤 며칠 만에 이어 낸 응답이 평균을 부풀리지 않게', () => {
    const result = analyzeSurvey(survey, [
      // 10분 걸려 바로 낸 응답
      makeResponse({
        id: 'r1',
        startedAt: '2026-10-22T01:00:00Z',
        completedAt: '2026-10-22T01:10:00Z',
        totalSeconds: 600,
      }),
      // 10/19 에 시작해 10/22 에 이어 낸 응답 — 실제로 응답한 시간은 20분
      makeResponse({
        id: 'r2',
        startedAt: '2026-10-19T05:59:43Z',
        completedAt: '2026-10-22T08:30:00Z',
        totalSeconds: 1200,
      }),
    ]);

    expect(result.summary.avgCompletionTime).toBe(15);
  });

  it('totalSeconds 가 없는 옛 응답은 시작~완료 시각 차이로 잰다', () => {
    const result = analyzeSurvey(survey, [
      makeResponse({
        id: 'r1',
        startedAt: '2026-10-22T01:00:00Z',
        completedAt: '2026-10-22T01:06:00Z',
        totalSeconds: null,
      }),
    ]);

    expect(result.summary.avgCompletionTime).toBe(6);
  });
});
