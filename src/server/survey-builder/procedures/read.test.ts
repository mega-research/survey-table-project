import { createRouterClient } from '@orpc/server';
import { ORPCError } from '@orpc/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ORPCContext } from '@/server/context';
import { assertSurveyCapabilityRpc } from '@/server/rpc-survey-access';
import { INITIAL_SURVEY_LIST_PAGE_QUERY } from '@/shared/contracts/survey-builder-io';

import * as responseSvc from '../services/response-read';
import * as surveySvc from '../services/survey-read';
import { read } from './read';

vi.mock('../services/survey-read', () => ({
  getSurveyListWithCounts: vi.fn(),
  listSurveyPage: vi.fn(),
  listSurveySummaries: vi.fn(),
  suggestSurveys: vi.fn(),
  getSurveyById: vi.fn(),
  getSurveyWithDetails: vi.fn(),
  isSlugAvailable: vi.fn(),
  getQuestionGroupsBySurvey: vi.fn(),
  getQuestionsBySurvey: vi.fn(),
  getAllTags: vi.fn(),
  getVariableCatalogForSurvey: vi.fn(),
}));

// capability 관문(티켓 09) — 실물은 DB 를 읽으므로 모킹. 기본은 통과.
vi.mock('@/server/rpc-survey-access', () => ({ assertSurveyCapabilityRpc: vi.fn() }));

vi.mock('../services/response-read', () => ({
  getResponsesBySurvey: vi.fn(),
  getCompletedResponses: vi.fn(),
  getResponseById: vi.fn(),
  getSurveyVersions: vi.fn(),
  exportResponsesAsJson: vi.fn(),
  exportResponsesAsCsv: vi.fn(),
}));

// UUID 픽스처는 v4 형태로 통일.
const SURVEY_ID = '11111111-2222-4333-8444-555555555555';
const RESPONSE_ID = '22222222-3333-4444-8555-666666666666';

function authedContext(): ORPCContext {
  return {
    db: {} as never,
    user: {
      id: 'admin-1',
      email: 'a@b.com',
      name: '관리자',
      status: 'active',
      isSuperadmin: false,
      userType: 'internal',
    },
  };
}

function anonContext(): ORPCContext {
  return { db: {} as never, user: null };
}

describe('surveyBuilder.read procedures', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.unstubAllEnvs());

  it('listPage 는 세션 사용자와 조건을 그대로 넘긴다', async () => {
    const result = { scope: { kind: 'system' }, teams: [], items: [], total: 0 };
    vi.mocked(surveySvc.listSurveyPage).mockResolvedValue(result as never);
    const context = authedContext();
    const client = createRouterClient({ read }, { context });
    const input = { ...INITIAL_SURVEY_LIST_PAGE_QUERY, scope: 'team-1', q: '실태', page: 2 };
    const res = await client.read.listPage(input);
    expect(surveySvc.listSurveyPage).toHaveBeenCalledWith(context.user, input);
    expect(res).toEqual(result);
  });

  it('listPage 는 모르는 키를 거부한다 — 입력이 그대로 조건이 되므로 조용히 버리지 않는다', async () => {
    const client = createRouterClient({ read }, { context: authedContext() });
    await expect(
      client.read.listPage({
        ...INITIAL_SURVEY_LIST_PAGE_QUERY,
        scope: null,
        ownerUserId: 'x',
      } as never),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect(surveySvc.listSurveyPage).not.toHaveBeenCalled();
  });

  it('listPage 는 주소에서 온 id 가 UUID 꼴이 아니면 DB 까지 보내지 않는다', async () => {
    const client = createRouterClient({ read }, { context: authedContext() });
    await expect(
      client.read.listPage({ ...INITIAL_SURVEY_LIST_PAGE_QUERY, scope: null, groupId: 'abc' }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect(surveySvc.listSurveyPage).not.toHaveBeenCalled();
  });

  it('listSummaries 는 세션 사용자와 요청 범위를 요약 조회에 넘긴다 — 응답 수 조회를 타지 않는다', async () => {
    const rows = [
      {
        id: SURVEY_ID,
        title: '설문',
        cardTitle: null,
        teamId: 't-1',
        teamName: '1팀',
        surveyGroupId: null,
      },
    ];
    vi.mocked(surveySvc.listSurveySummaries).mockResolvedValue(rows as never);
    const context = authedContext();
    const client = createRouterClient({ read }, { context });
    const res = await client.read.listSummaries({ scope: 'team-1' });
    expect(surveySvc.listSurveySummaries).toHaveBeenCalledWith(context.user, 'team-1');
    expect(surveySvc.getSurveyListWithCounts).not.toHaveBeenCalled();
    expect(res).toEqual(rows);
  });

  it('listSummaries 는 범위 미지정을 null 로 넘긴다', async () => {
    vi.mocked(surveySvc.listSurveySummaries).mockResolvedValue([] as never);
    const context = authedContext();
    const client = createRouterClient({ read }, { context });
    await client.read.listSummaries({});
    expect(surveySvc.listSurveySummaries).toHaveBeenCalledWith(context.user, null);
  });

  it('listSummaries 는 비로그인이면 UNAUTHORIZED', async () => {
    const client = createRouterClient({ read }, { context: anonContext() });
    await expect(client.read.listSummaries({})).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    expect(surveySvc.listSurveySummaries).not.toHaveBeenCalled();
  });

  it('suggest 는 세션 사용자와 범위·검색어만 넘긴다', async () => {
    const rows = [{ id: SURVEY_ID, cardTitle: '설문', ownerName: '김', lifecycle: 'draft' }];
    vi.mocked(surveySvc.suggestSurveys).mockResolvedValue(rows as never);
    const context = authedContext();
    const client = createRouterClient({ read }, { context });
    const res = await client.read.suggest({ scope: 'team-1', q: 'a사 실' });
    expect(surveySvc.suggestSurveys).toHaveBeenCalledWith(context.user, {
      scope: 'team-1',
      q: 'a사 실',
    });
    expect(res).toEqual(rows);
  });

  it('suggest 는 목록과 같은 검색어 상한·모르는 키를 거부한다', async () => {
    const client = createRouterClient({ read }, { context: authedContext() });
    await expect(
      client.read.suggest({ scope: null, q: '1 2 3 4 5 6 7 8 9' }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    await expect(
      client.read.suggest({ scope: null, q: 'a', groupId: null } as never),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect(surveySvc.suggestSurveys).not.toHaveBeenCalled();
  });

  it('suggest 는 비로그인이면 UNAUTHORIZED', async () => {
    const client = createRouterClient({ read }, { context: anonContext() });
    await expect(client.read.suggest({ scope: null, q: 'a' })).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
    });
    expect(surveySvc.suggestSurveys).not.toHaveBeenCalled();
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

  it('slugAvailable는 input 객체를 그대로 isSlugAvailable에 위임한다', async () => {
    vi.mocked(surveySvc.isSlugAvailable).mockResolvedValue(true as never);
    const client = createRouterClient({ read }, { context: authedContext() });
    const res = await client.read.slugAvailable({ slug: 'my-slug', excludeSurveyId: SURVEY_ID });
    expect(surveySvc.isSlugAvailable).toHaveBeenCalledWith({
      slug: 'my-slug',
      excludeSurveyId: SURVEY_ID,
    });
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

  it('비활성 계정 세션은 exportJson이 FORBIDDEN으로 막힌다', async () => {
    const client = createRouterClient(
      { read },
      {
        context: {
          db: {} as never,
          user: {
            id: 'suspended-1',
            email: 'x@y.com',
            name: '정지계정',
            status: 'suspended',
            isSuperadmin: false,
            userType: 'internal',
          },
        },
      },
    );
    await expect(client.read.exportJson({ surveyId: SURVEY_ID })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    expect(responseSvc.exportResponsesAsJson).not.toHaveBeenCalled();
  });

  it('게스트 계정은 exportCsv가 FORBIDDEN으로 막힌다', async () => {
    const client = createRouterClient(
      { read },
      {
        context: {
          db: {} as never,
          user: {
            id: 'guest-1',
            email: 'g@b.com',
            name: '게스트',
            status: 'active',
            isSuperadmin: false,
            userType: 'guest',
          },
        },
      },
    );
    await expect(client.read.exportCsv({ surveyId: SURVEY_ID })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    expect(responseSvc.exportResponsesAsCsv).not.toHaveBeenCalled();
  });
});

describe('surveyBuilder.read — capability 관문 (티켓 09)', () => {
  beforeEach(() => vi.clearAllMocks());

  it.each([
    ['byId', 'survey.view', () => ({ surveyId: SURVEY_ID })],
    ['withDetails', 'survey.view', () => ({ surveyId: SURVEY_ID })],
    ['questionGroups', 'survey.view', () => ({ surveyId: SURVEY_ID })],
    ['questions', 'survey.view', () => ({ surveyId: SURVEY_ID })],
    ['surveyVersions', 'survey.view', () => ({ surveyId: SURVEY_ID })],
    ['variableCatalog', 'survey.view', () => ({ surveyId: SURVEY_ID })],
    ['responsesBySurvey', 'responses.view', () => ({ surveyId: SURVEY_ID })],
    ['completedResponses', 'responses.view', () => ({ surveyId: SURVEY_ID })],
    ['responseById', 'responses.view', () => ({ responseId: RESPONSE_ID, surveyId: SURVEY_ID })],
    ['exportJson', 'export.download', () => ({ surveyId: SURVEY_ID })],
    ['exportCsv', 'export.download', () => ({ surveyId: SURVEY_ID })],
  ] as const)('%s 는 %s 관문을 지난다', async (name, capability, makeInput) => {
    const context = authedContext();
    const client = createRouterClient({ read }, { context });
    const call = client.read[name] as (input: unknown) => Promise<unknown>;
    await call(makeInput());
    expect(assertSurveyCapabilityRpc).toHaveBeenCalledWith(context.user, SURVEY_ID, capability);
  });

  it('타 팀 설문 id 는 NOT_FOUND — 조회 service 에 닿지 않는다', async () => {
    vi.mocked(assertSurveyCapabilityRpc).mockRejectedValue(
      new ORPCError('NOT_FOUND', { message: '설문을 찾을 수 없습니다.' }),
    );
    const client = createRouterClient({ read }, { context: authedContext() });
    await expect(client.read.withDetails({ surveyId: SURVEY_ID })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    expect(surveySvc.getSurveyWithDetails).not.toHaveBeenCalled();
  });

  it('응답 열람 권한이 없으면 export 계열도 service 에 닿지 않는다', async () => {
    vi.mocked(assertSurveyCapabilityRpc).mockRejectedValue(
      new ORPCError('FORBIDDEN', { message: '이 작업을 수행할 권한이 없습니다.' }),
    );
    const client = createRouterClient({ read }, { context: authedContext() });
    await expect(client.read.exportCsv({ surveyId: SURVEY_ID })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    expect(responseSvc.exportResponsesAsCsv).not.toHaveBeenCalled();
  });
});
