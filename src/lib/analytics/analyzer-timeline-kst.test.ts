import { describe, it, expect, afterEach, vi } from 'vitest';

import { analyzeSurvey } from '@/lib/analytics/analyzer';
import type { SurveyResponse } from '@/db/schema';

// analyzeSurvey 가 읽는 필드만 채운 최소 응답 fixture. 그 외 컬럼은 집계에 무관.
function makeResponse(opts: {
  id: string;
  startedAt: Date;
  completedAt: Date | null;
  isCompleted: boolean;
}): SurveyResponse {
  return {
    id: opts.id,
    startedAt: opts.startedAt,
    completedAt: opts.completedAt,
    isCompleted: opts.isCompleted,
    questionResponses: {},
  } as unknown as SurveyResponse;
}

const survey = { id: 'survey-1', title: '제목', questions: [] as never[] };

describe('analyzeSurvey 타임라인/오늘·주 KST 일자 통일', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('심야(KST 익일 새벽) 응답을 KST 일자로 버킷한다 (UTC 일자로 어긋나지 않음)', () => {
    // 2026-06-11 01:30 KST == 2026-06-10 16:30 UTC.
    // UTC 일자 기준이면 "2026-06-10" 으로 잘못 묶이고, KST 기준이면 "2026-06-11".
    const startedAt = new Date('2026-06-10T16:30:00.000Z');
    const result = analyzeSurvey(survey, [
      makeResponse({ id: 'r1', startedAt, completedAt: startedAt, isCompleted: true }),
    ]);

    expect(result.timeline).toHaveLength(1);
    expect(result.timeline[0]?.date).toBe('2026-06-11');
  });

  it('KST 자정 직전(전일 늦은 밤) 응답은 전일로 버킷한다', () => {
    // 2026-06-10 23:30 KST == 2026-06-10 14:30 UTC → KST 일자 "2026-06-10".
    const startedAt = new Date('2026-06-10T14:30:00.000Z');
    const result = analyzeSurvey(survey, [
      makeResponse({ id: 'r1', startedAt, completedAt: startedAt, isCompleted: true }),
    ]);

    expect(result.timeline[0]?.date).toBe('2026-06-10');
  });

  it('todayResponses 는 KST 자정 경계로 센다 (서버 UTC 런타임에서도 동일)', () => {
    // 기준 현재 시각: 2026-06-11 09:00 KST == 2026-06-11 00:00 UTC.
    // KST 자정 = 2026-06-11 00:00 KST == 2026-06-10 15:00 UTC.
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-11T00:00:00.000Z'));

    // 응답 A: 2026-06-11 02:00 KST (KST 오늘) == 2026-06-10 17:00 UTC → today 포함
    const todayResp = new Date('2026-06-10T17:00:00.000Z');
    // 응답 B: 2026-06-10 22:00 KST (KST 어제) == 2026-06-10 13:00 UTC → today 제외
    const yesterdayResp = new Date('2026-06-10T13:00:00.000Z');

    const result = analyzeSurvey(survey, [
      makeResponse({ id: 'a', startedAt: todayResp, completedAt: todayResp, isCompleted: true }),
      makeResponse({
        id: 'b',
        startedAt: yesterdayResp,
        completedAt: yesterdayResp,
        isCompleted: true,
      }),
    ]);

    expect(result.summary.todayResponses).toBe(1);
    expect(result.summary.weekResponses).toBe(2);
  });
});
