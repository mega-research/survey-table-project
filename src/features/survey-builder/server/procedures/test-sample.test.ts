import { createRouterClient } from '@orpc/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ORPCContext } from '@/server/context';

vi.mock('../services/test-sample.service', () => ({
  getSurveyTestSample: vi.fn(),
}));

import * as svc from '../services/test-sample.service';
import { testSample } from './test-sample';

const SURVEY_ID = '11111111-1111-4111-8111-111111111111';

function authedContext(): ORPCContext {
  return { db: {} as never, supabase: {} as never, user: { id: 'admin-1', email: 'a@b.com' } };
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
      { context: { db: {} as never, supabase: {} as never, user: null } },
    );
    await expect(
      client.testSample.get({ surveyId: SURVEY_ID }),
    ).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });
});
