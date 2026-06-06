import { createRouterClient } from '@orpc/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ORPCContext } from '@/server/context';

vi.mock('../services/analytics.service', () => ({
  getResponseSummary: vi.fn(),
  getQuestionStatistics: vi.fn(),
  analyzeSurveyById: vi.fn(),
}));

import * as svc from '../services/analytics.service';
import { analytics } from './analytics';

function authedContext(): ORPCContext {
  return {
    db: {} as never,
    supabase: {} as never,
    user: { id: 'admin-1', email: 'a@b.com' },
  };
}

describe('analytics procedures', () => {
  beforeEach(() => vi.clearAllMocks());

  it('stats.survey 는 service.getResponseSummary 에 surveyId 를 위임한다', async () => {
    vi.mocked(svc.getResponseSummary).mockResolvedValue({
      surveyId: 's1',
      totalResponses: 3,
      completedResponses: 2,
      averageCompletionTime: 1.5,
      responseRate: 66.6,
    } as never);
    const client = createRouterClient({ analytics }, { context: authedContext() });
    const res = await client.analytics.stats.survey({ surveyId: 's1' });
    expect(svc.getResponseSummary).toHaveBeenCalledWith('s1');
    expect(res.surveyId).toBe('s1');
    expect(res.completedResponses).toBe(2);
  });

  it('stats.question 은 service.getQuestionStatistics 에 surveyId+questionId 를 위임한다', async () => {
    vi.mocked(svc.getQuestionStatistics).mockResolvedValue({
      totalResponses: 5,
      responseRate: 100,
      type: 'single',
      responseCounts: { a: 3, b: 2 },
      responses: ['a', 'a', 'a', 'b', 'b'],
    } as never);
    const client = createRouterClient({ analytics }, { context: authedContext() });
    const res = await client.analytics.stats.question({ surveyId: 's1', questionId: 'q1' });
    expect(svc.getQuestionStatistics).toHaveBeenCalledWith('s1', 'q1');
    expect(res.totalResponses).toBe(5);
  });

  it('analyze.survey 는 service.analyzeSurveyById 에 위임한다', async () => {
    vi.mocked(svc.analyzeSurveyById).mockResolvedValue({
      surveyId: 's1',
      surveyTitle: '설문',
      summary: {},
      timeline: [],
      questions: [],
    } as never);
    const client = createRouterClient({ analytics }, { context: authedContext() });
    const res = await client.analytics.analyze.survey({ surveyId: 's1' });
    expect(svc.analyzeSurveyById).toHaveBeenCalledWith('s1');
    expect(res.surveyId).toBe('s1');
  });

  it('인증 없으면 stats.survey 가 UNAUTHORIZED 로 막힌다', async () => {
    const client = createRouterClient(
      { analytics },
      { context: { db: {} as never, supabase: {} as never, user: null } },
    );
    await expect(
      client.analytics.stats.survey({ surveyId: 's1' }),
    ).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });
});
