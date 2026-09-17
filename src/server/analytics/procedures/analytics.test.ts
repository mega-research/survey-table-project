import { createRouterClient } from '@orpc/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ORPCContext } from '@/server/context';

// capability 관문(티켓 09) — 실물은 DB 를 읽으므로 모킹. 기본은 통과.
vi.mock('@/server/rpc-survey-access', () => ({ assertSurveyCapabilityRpc: vi.fn() }));

vi.mock('../services/analytics', () => ({
  getResponseSummary: vi.fn(),
  getQuestionStatistics: vi.fn(),
  analyzeSurveyById: vi.fn(),
}));

import * as svc from '../services/analytics';

import { ORPCError } from '@orpc/server';

import { assertSurveyCapabilityRpc } from '@/server/rpc-survey-access';
import { analytics } from './analytics';

function authedContext(): ORPCContext {
  return {
    db: {} as never,
    user: { id: 'admin-1', email: 'a@b.com', name: '관리자', status: 'active', isSuperadmin: false , userType: 'internal'},
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
      { context: { db: {} as never, user: null } },
    );
    await expect(
      client.analytics.stats.survey({ surveyId: 's1' }),
    ).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });
});

describe('analytics — capability 관문 (티켓 09)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('stats·analyze 는 analytics.view 관문을 지난다', async () => {
    vi.mocked(svc.getResponseSummary).mockResolvedValue({} as never);
    vi.mocked(svc.getQuestionStatistics).mockResolvedValue({} as never);
    vi.mocked(svc.analyzeSurveyById).mockResolvedValue({} as never);
    const context = authedContext();
    const client = createRouterClient({ analytics }, { context });

    await client.analytics.stats.survey({ surveyId: 's1' });
    expect(assertSurveyCapabilityRpc).toHaveBeenCalledWith(context.user, 's1', 'analytics.view');
    await client.analytics.stats.question({ surveyId: 's1', questionId: 'q1' });
    await client.analytics.analyze.survey({ surveyId: 's1' });
    // 원문을 싣는 두 표면은 analytics.view 에 더해 responses.view 를 한 번씩 더 묻는다.
    expect(assertSurveyCapabilityRpc).toHaveBeenCalledTimes(5);
  });

  it('응답 원문을 싣는 stats.question·analyze.survey 는 responses.view 도 요구한다', async () => {
    // 팀원 열은 analytics.view 만 있고 responses.view 가 없다 — 분석 RSC 화면이 이미 그 둘을
    // 함께 요구하는데 RPC 가 analytics.view 만 보면 직접 호출로 복호화된 원문이 샌다.
    vi.mocked(assertSurveyCapabilityRpc).mockImplementation(async (_user, _surveyId, capability) => {
      if (capability === 'responses.view') {
        throw new ORPCError('FORBIDDEN', { message: '권한이 없습니다.' });
      }
    });
    const client = createRouterClient({ analytics }, { context: authedContext() });

    await expect(
      client.analytics.stats.question({ surveyId: 's1', questionId: 'q1' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(client.analytics.analyze.survey({ surveyId: 's1' })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    expect(svc.getQuestionStatistics).not.toHaveBeenCalled();
    expect(svc.analyzeSurveyById).not.toHaveBeenCalled();

    // 응답 수만 주는 요약은 원문이 없어 analytics.view 로 충분하다.
    vi.mocked(svc.getResponseSummary).mockResolvedValue({} as never);
    await expect(client.analytics.stats.survey({ surveyId: 's1' })).resolves.toBeDefined();
  });

  it('타 팀 설문 id 로 분석을 요청하면 service 에 닿지 않는다', async () => {
    vi.mocked(assertSurveyCapabilityRpc).mockRejectedValue(
      new ORPCError('NOT_FOUND', { message: '설문을 찾을 수 없습니다.' }),
    );
    const client = createRouterClient({ analytics }, { context: authedContext() });
    await expect(client.analytics.analyze.survey({ surveyId: 's1' })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    expect(svc.analyzeSurveyById).not.toHaveBeenCalled();
  });
});
