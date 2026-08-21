import { createRouterClient } from '@orpc/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ORPCContext } from '@/server/context';

vi.mock('../services/survey-publish.service', () => ({
  publishSurvey: vi.fn(),
}));

import * as svc from '../services/survey-publish.service';
import { publish } from './publish';

function authedContext(): ORPCContext {
  return { db: {} as never, supabase: {} as never, user: { id: 'admin-1', email: 'a@b.com' } };
}

function anonContext(): ORPCContext {
  return { db: {} as never, supabase: {} as never, user: null };
}

const SURVEY_ID = '55555555-6666-4777-8888-999999999999';
const VERSION_ID = '66666666-7777-4888-8999-aaaaaaaaaaaa';

const VERSION_ROW = {
  id: VERSION_ID,
  surveyId: SURVEY_ID,
  versionNumber: 1,
  status: 'published',
  snapshot: {},
  changeNote: null,
  publishedAt: new Date('2026-06-01T00:00:00Z'),
  closedAt: null,
  deletedAt: null,
  createdAt: new Date('2026-06-01T00:00:00Z'),
};

describe('surveyBuilder.publish procedures', () => {
  beforeEach(() => vi.clearAllMocks());

  it('publish는 (surveyId, changeNote)를 단일 input object로 묶어 service에 위임한다', async () => {
    vi.mocked(svc.publishSurvey).mockResolvedValue(VERSION_ROW as never);
    const client = createRouterClient({ publish }, { context: authedContext() });
    const input = { surveyId: SURVEY_ID, changeNote: '첫 배포' };
    const res = await client.publish.publish(input);
    expect(svc.publishSurvey).toHaveBeenCalledWith(input);
    expect(res).toMatchObject({ id: VERSION_ID, versionNumber: 1, status: 'published' });
  });

  it('publish는 changeNote 없이도 service에 위임한다', async () => {
    vi.mocked(svc.publishSurvey).mockResolvedValue(VERSION_ROW as never);
    const client = createRouterClient({ publish }, { context: authedContext() });
    const input = { surveyId: SURVEY_ID };
    await client.publish.publish(input);
    expect(svc.publishSurvey).toHaveBeenCalledWith(input);
  });

  it('인증 없으면 publish가 UNAUTHORIZED로 막힌다', async () => {
    const client = createRouterClient({ publish }, { context: anonContext() });
    await expect(
      client.publish.publish({ surveyId: SURVEY_ID }),
    ).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });
});
