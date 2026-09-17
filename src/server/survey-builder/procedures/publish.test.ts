import { createRouterClient } from '@orpc/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ORPCContext } from '@/server/context';

// capability 관문(티켓 09) — 실물은 DB 를 읽으므로 모킹. 기본은 통과.
vi.mock('@/server/rpc-survey-access', () => ({ assertSurveyCapabilityRpc: vi.fn() }));

vi.mock('../services/survey-publish', () => ({
  publishSurvey: vi.fn(),
  countMigratableResponses: vi.fn(),
}));

import * as svc from '../services/survey-publish';

import { ORPCError } from '@orpc/server';

import { assertSurveyCapabilityRpc } from '@/server/rpc-survey-access';
import { publish } from './publish';

function authedContext(): ORPCContext {
  return { db: {} as never, user: { id: 'admin-1', email: 'a@b.com', name: '관리자', status: 'active', isSuperadmin: false , userType: 'internal'} };
}

function anonContext(): ORPCContext {
  return { db: {} as never, user: null };
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

describe('surveyBuilder.publish — capability 관문 (티켓 09)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('publish·migratableCount 는 survey.publish 관문을 지난다', async () => {
    vi.mocked(svc.publishSurvey).mockResolvedValue(VERSION_ROW as never);
    vi.mocked(svc.countMigratableResponses).mockResolvedValue({ count: 0 } as never);
    const context = authedContext();
    const client = createRouterClient({ publish }, { context });

    await client.publish.publish({ surveyId: SURVEY_ID });
    expect(assertSurveyCapabilityRpc).toHaveBeenCalledWith(
      context.user,
      SURVEY_ID,
      'survey.publish',
    );

    await client.publish.migratableCount({ surveyId: SURVEY_ID });
    expect(assertSurveyCapabilityRpc).toHaveBeenCalledTimes(2);
  });

  it('발행 권한이 없으면(참여자 등) service 에 닿지 않는다', async () => {
    vi.mocked(assertSurveyCapabilityRpc).mockRejectedValue(
      new ORPCError('FORBIDDEN', { message: '이 작업을 수행할 권한이 없습니다.' }),
    );
    const client = createRouterClient({ publish }, { context: authedContext() });
    await expect(client.publish.publish({ surveyId: SURVEY_ID })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    expect(svc.publishSurvey).not.toHaveBeenCalled();
  });
});
