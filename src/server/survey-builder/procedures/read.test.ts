import { createRouterClient } from '@orpc/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ORPCContext } from '@/server/context';

vi.mock('../services/survey-read', () => ({
  getSurveyListWithCounts: vi.fn(),
  getSurveyById: vi.fn(),
  getSurveyWithDetails: vi.fn(),
  searchSurveys: vi.fn(),
  isSlugAvailable: vi.fn(),
  getQuestionGroupsBySurvey: vi.fn(),
  getQuestionsBySurvey: vi.fn(),
  getAllTags: vi.fn(),
  getVariableCatalogForSurvey: vi.fn(),
}));

vi.mock('../services/response-read', () => ({
  getResponsesBySurvey: vi.fn(),
  getCompletedResponses: vi.fn(),
  getResponseById: vi.fn(),
  getResponsesWithAnswers: vi.fn(),
  getSurveyVersions: vi.fn(),
  exportResponsesAsJson: vi.fn(),
  exportResponsesAsCsv: vi.fn(),
}));

import * as responseSvc from '../services/response-read';
import * as surveySvc from '../services/survey-read';
import { read } from './read';

// UUID 픽스처는 v4 형태로 통일.
const SURVEY_ID = '11111111-2222-4333-8444-555555555555';
const RESPONSE_ID = '22222222-3333-4444-8555-666666666666';
const VERSION_ID = '33333333-4444-4555-8666-777777777777';

function authedContext(): ORPCContext {
  return { db: {} as never, supabase: {} as never, user: { id: 'admin-1', email: 'a@b.com' } };
}

function anonContext(): ORPCContext {
  return { db: {} as never, supabase: {} as never, user: null };
}

describe('surveyBuilder.read procedures', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.unstubAllEnvs());

  it('list는 인자 없이 getSurveyListWithCounts에 위임한다', async () => {
    vi.mocked(surveySvc.getSurveyListWithCounts).mockResolvedValue([] as never);
    const client = createRouterClient({ read }, { context: authedContext() });
    const res = await client.read.list();
    expect(surveySvc.getSurveyListWithCounts).toHaveBeenCalledWith();
    expect(res).toEqual([]);
  });

  it('byId는 surveyId를 풀어 getSurveyById에 위임한다', async () => {
    vi.mocked(surveySvc.getSurveyById).mockResolvedValue({ id: SURVEY_ID } as never);
    const client = createRouterClient({ read }, { context: authedContext() });
    const res = await client.read.byId({ surveyId: SURVEY_ID });
    expect(surveySvc.getSurveyById).toHaveBeenCalledWith(SURVEY_ID);
    expect((res as { id: string }).id).toBe(SURVEY_ID);
  });

  it('withDetails는 surveyId를 풀어 getSurveyWithDetails에 위임한다', async () => {
    vi.mocked(surveySvc.getSurveyWithDetails).mockResolvedValue(null as never);
    const client = createRouterClient({ read }, { context: authedContext() });
    const res = await client.read.withDetails({ surveyId: SURVEY_ID });
    expect(surveySvc.getSurveyWithDetails).toHaveBeenCalledWith(SURVEY_ID);
    expect(res).toBeNull();
  });

  it('search는 query를 풀어 searchSurveys에 위임한다', async () => {
    vi.mocked(surveySvc.searchSurveys).mockResolvedValue([] as never);
    const client = createRouterClient({ read }, { context: authedContext() });
    await client.read.search({ query: 'foo' });
    expect(surveySvc.searchSurveys).toHaveBeenCalledWith('foo');
  });

  it('slugAvailable는 input 객체를 그대로 isSlugAvailable에 위임한다', async () => {
    vi.mocked(surveySvc.isSlugAvailable).mockResolvedValue(true as never);
    const client = createRouterClient({ read }, { context: authedContext() });
    const res = await client.read.slugAvailable({ slug: 'my-slug', excludeSurveyId: SURVEY_ID });
    expect(surveySvc.isSlugAvailable).toHaveBeenCalledWith({ slug: 'my-slug', excludeSurveyId: SURVEY_ID });
    expect(res).toBe(true);
  });

  it('questionGroups는 surveyId를 풀어 getQuestionGroupsBySurvey에 위임한다', async () => {
    vi.mocked(surveySvc.getQuestionGroupsBySurvey).mockResolvedValue([] as never);
    const client = createRouterClient({ read }, { context: authedContext() });
    await client.read.questionGroups({ surveyId: SURVEY_ID });
    expect(surveySvc.getQuestionGroupsBySurvey).toHaveBeenCalledWith(SURVEY_ID);
  });

  it('questions는 surveyId를 풀어 getQuestionsBySurvey에 위임한다', async () => {
    vi.mocked(surveySvc.getQuestionsBySurvey).mockResolvedValue([] as never);
    const client = createRouterClient({ read }, { context: authedContext() });
    await client.read.questions({ surveyId: SURVEY_ID });
    expect(surveySvc.getQuestionsBySurvey).toHaveBeenCalledWith(SURVEY_ID);
  });

  it('responsesBySurvey는 surveyId를 풀어 getResponsesBySurvey에 위임한다', async () => {
    vi.mocked(responseSvc.getResponsesBySurvey).mockResolvedValue([] as never);
    const client = createRouterClient({ read }, { context: authedContext() });
    await client.read.responsesBySurvey({ surveyId: SURVEY_ID });
    expect(responseSvc.getResponsesBySurvey).toHaveBeenCalledWith(SURVEY_ID);
  });

  it('completedResponses는 surveyId를 풀어 getCompletedResponses에 위임한다', async () => {
    vi.mocked(responseSvc.getCompletedResponses).mockResolvedValue([] as never);
    const client = createRouterClient({ read }, { context: authedContext() });
    await client.read.completedResponses({ surveyId: SURVEY_ID });
    expect(responseSvc.getCompletedResponses).toHaveBeenCalledWith(SURVEY_ID);
  });

  it('responseById는 responseId+surveyId를 풀어 getResponseById에 위임한다(설문 스코프)', async () => {
    vi.mocked(responseSvc.getResponseById).mockResolvedValue({ id: RESPONSE_ID } as never);
    const client = createRouterClient({ read }, { context: authedContext() });
    const res = await client.read.responseById({ responseId: RESPONSE_ID, surveyId: SURVEY_ID });
    expect(responseSvc.getResponseById).toHaveBeenCalledWith(RESPONSE_ID, SURVEY_ID);
    expect((res as { id: string }).id).toBe(RESPONSE_ID);
  });

  it('responsesWithAnswers는 input 객체를 그대로 위임한다', async () => {
    vi.mocked(responseSvc.getResponsesWithAnswers).mockResolvedValue([] as never);
    const client = createRouterClient({ read }, { context: authedContext() });
    await client.read.responsesWithAnswers({ surveyId: SURVEY_ID, versionId: VERSION_ID });
    expect(responseSvc.getResponsesWithAnswers).toHaveBeenCalledWith({
      surveyId: SURVEY_ID,
      versionId: VERSION_ID,
    });
  });

  it('surveyVersions는 surveyId를 풀어 getSurveyVersions에 위임한다', async () => {
    vi.mocked(responseSvc.getSurveyVersions).mockResolvedValue([] as never);
    const client = createRouterClient({ read }, { context: authedContext() });
    await client.read.surveyVersions({ surveyId: SURVEY_ID });
    expect(responseSvc.getSurveyVersions).toHaveBeenCalledWith(SURVEY_ID);
  });

  it('exportJson은 surveyId를 풀어 exportResponsesAsJson에 위임한다', async () => {
    vi.mocked(responseSvc.exportResponsesAsJson).mockResolvedValue('[]' as never);
    const client = createRouterClient({ read }, { context: authedContext() });
    const res = await client.read.exportJson({ surveyId: SURVEY_ID });
    expect(responseSvc.exportResponsesAsJson).toHaveBeenCalledWith(SURVEY_ID);
    expect(res).toBe('[]');
  });

  it('exportCsv는 surveyId를 풀어 exportResponsesAsCsv에 위임한다', async () => {
    vi.mocked(responseSvc.exportResponsesAsCsv).mockResolvedValue('' as never);
    const client = createRouterClient({ read }, { context: authedContext() });
    const res = await client.read.exportCsv({ surveyId: SURVEY_ID });
    expect(responseSvc.exportResponsesAsCsv).toHaveBeenCalledWith(SURVEY_ID);
    expect(res).toBe('');
  });

  it('allTags는 인자 없이 getAllTags에 위임한다', async () => {
    vi.mocked(surveySvc.getAllTags).mockResolvedValue(['a', 'b'] as never);
    const client = createRouterClient({ read }, { context: authedContext() });
    const res = await client.read.allTags();
    expect(surveySvc.getAllTags).toHaveBeenCalledWith();
    expect(res).toEqual(['a', 'b']);
  });

  it('variableCatalog는 surveyId를 풀어 getVariableCatalogForSurvey에 위임한다', async () => {
    vi.mocked(surveySvc.getVariableCatalogForSurvey).mockResolvedValue([] as never);
    const client = createRouterClient({ read }, { context: authedContext() });
    await client.read.variableCatalog({ surveyId: SURVEY_ID });
    expect(surveySvc.getVariableCatalogForSurvey).toHaveBeenCalledWith(SURVEY_ID);
  });

  it('인증 없으면 byId가 UNAUTHORIZED로 막힌다', async () => {
    const client = createRouterClient({ read }, { context: anonContext() });
    await expect(client.read.byId({ surveyId: SURVEY_ID })).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
    });
    expect(surveySvc.getSurveyById).not.toHaveBeenCalled();
  });

  // analytics 대시보드의 내보내기 표면. 과거에는 페이지 인라인 server action 이라
  // 본문 인증이 없었다 — 복호화 PII 를 반환하므로 인증 실패 시 service 진입 자체가
  // 없어야 한다.
  it('인증 없으면 exportJson이 UNAUTHORIZED로 막힌다', async () => {
    const client = createRouterClient({ read }, { context: anonContext() });
    await expect(client.read.exportJson({ surveyId: SURVEY_ID })).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
    });
    expect(responseSvc.exportResponsesAsJson).not.toHaveBeenCalled();
  });

  it('인증 없으면 exportCsv가 UNAUTHORIZED로 막힌다', async () => {
    const client = createRouterClient({ read }, { context: anonContext() });
    await expect(client.read.exportCsv({ surveyId: SURVEY_ID })).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
    });
    expect(responseSvc.exportResponsesAsCsv).not.toHaveBeenCalled();
  });

  it('allowlist 밖 세션은 exportJson이 FORBIDDEN으로 막힌다', async () => {
    vi.stubEnv('ADMIN_USER_IDS', 'admin-1');
    const client = createRouterClient(
      { read },
      {
        context: {
          db: {} as never,
          supabase: {} as never,
          user: { id: 'intruder-1', email: 'x@y.com' },
        },
      },
    );
    await expect(client.read.exportJson({ surveyId: SURVEY_ID })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    expect(responseSvc.exportResponsesAsJson).not.toHaveBeenCalled();
  });

  it('게스트 grant 보유자는 exportCsv가 FORBIDDEN으로 막힌다', async () => {
    vi.stubEnv('ADMIN_USER_IDS', 'admin-1');
    vi.stubEnv('GUEST_SURVEY_GRANTS', `guest-1:${SURVEY_ID}`);
    const client = createRouterClient(
      { read },
      {
        context: {
          db: {} as never,
          supabase: {} as never,
          user: { id: 'guest-1', email: 'g@b.com' },
        },
      },
    );
    await expect(client.read.exportCsv({ surveyId: SURVEY_ID })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    expect(responseSvc.exportResponsesAsCsv).not.toHaveBeenCalled();
  });
});
