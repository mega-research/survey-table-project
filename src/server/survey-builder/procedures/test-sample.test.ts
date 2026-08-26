import { createRouterClient } from '@orpc/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ORPCContext } from '@/server/context';

// capability 관문(티켓 09) — 실물은 DB 를 읽으므로 모킹. 기본은 통과.
vi.mock('@/server/rpc-survey-access', () => ({ assertSurveyCapabilityRpc: vi.fn() }));

vi.mock('../services/test-sample', () => ({
  getSurveyTestSample: vi.fn(),
}));

import * as svc from '../services/test-sample';

import { ORPCError } from '@orpc/server';

import { assertSurveyCapabilityRpc } from '@/server/rpc-survey-access';
import { testSample } from './test-sample';

const SURVEY_ID = '11111111-1111-4111-8111-111111111111';

function authedContext(): ORPCContext {
  return { db: {} as never, user: { id: 'admin-1', email: 'a@b.com', name: '관리자', status: 'active', isSuperadmin: false , userType: 'internal'} };
}

describe('surveyBuilder testSample procedures', () => {
  beforeEach(() => vi.clearAllMocks());

  it('get은 샘플이 있으면 { attrs, resid }를 직접 반환한다', async () => {
    vi.mocked(svc.getSurveyTestSample).mockResolvedValue({
      attrs: { 이름: '홍길동' },
      resid: 1,
    } as never);
    const client = createRouterClient({ testSample }, { context: authedContext() });
    const res = await client.testSample.get({ surveyId: SURVEY_ID });
    expect(svc.getSurveyTestSample).toHaveBeenCalledWith(SURVEY_ID);
    expect(res).toEqual({ attrs: { 이름: '홍길동' }, resid: 1 });
  });

  it('get은 샘플이 없으면 null을 반환한다', async () => {
    vi.mocked(svc.getSurveyTestSample).mockResolvedValue(null as never);
    const client = createRouterClient({ testSample }, { context: authedContext() });
    const res = await client.testSample.get({ surveyId: SURVEY_ID });
    expect(res).toBeNull();
  });

  it('인증 없으면 get이 UNAUTHORIZED로 막힌다', async () => {
    const client = createRouterClient(
      { testSample },
      { context: { db: {} as never, user: null } },
    );
    await expect(
      client.testSample.get({ surveyId: SURVEY_ID }),
    ).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });
});

describe('surveyBuilder.testSample — capability 관문 (티켓 09)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('get 은 survey.view 관문을 지난다 — 컨택 attrs 샘플은 PII 다', async () => {
    vi.mocked(svc.getSurveyTestSample).mockResolvedValue(null as never);
    const context = authedContext();
    const client = createRouterClient({ testSample }, { context });
    await client.testSample.get({ surveyId: SURVEY_ID });
    expect(assertSurveyCapabilityRpc).toHaveBeenCalledWith(context.user, SURVEY_ID, 'survey.view');
  });

  it('타 팀 설문 id 는 service 에 닿지 않는다', async () => {
    vi.mocked(assertSurveyCapabilityRpc).mockRejectedValue(
      new ORPCError('NOT_FOUND', { message: '설문을 찾을 수 없습니다.' }),
    );
    const client = createRouterClient({ testSample }, { context: authedContext() });
    await expect(client.testSample.get({ surveyId: SURVEY_ID })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    expect(svc.getSurveyTestSample).not.toHaveBeenCalled();
  });
});
