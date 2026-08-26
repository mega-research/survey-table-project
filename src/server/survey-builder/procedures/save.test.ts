import { createRouterClient } from '@orpc/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ORPCContext } from '@/server/context';

vi.mock('../services/survey-save', () => ({
  saveSurveyDiff: vi.fn(),
  saveSurveyWithDetails: vi.fn(),
}));

// capability 관문(티켓 09) — 실물은 DB 를 읽으므로 모킹. 기본은 통과.
vi.mock('@/server/rpc-survey-access', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  assertSurveyCapabilityRpc: vi.fn(),
}));

import { ORPCError } from '@orpc/server';

import { assertSurveyCapabilityRpc } from '@/server/rpc-survey-access';
import { SurveyAccessError } from '@/server/survey-access';

import * as svc from '../services/survey-save';
import { save } from './save';

function authedContext(): ORPCContext {
  return { db: {} as never, user: { id: 'admin-1', email: 'a@b.com', name: '관리자', status: 'active', isSuperadmin: false , userType: 'internal'} };
}

function anonContext(): ORPCContext {
  return { db: {} as never, user: null };
}

const SURVEY_ID = '33333333-4444-4555-8666-777777777777';
const QUESTION_ID = '44444444-5555-4666-8777-888888888888';

const SETTINGS = {
  isPublic: true,
  allowMultipleResponses: false,
  showProgressBar: true,
  shuffleQuestions: false,
  requireLogin: false,
  thankYouMessage: '감사합니다',
};

describe('surveyBuilder.save procedures', () => {
  beforeEach(() => vi.clearAllMocks());

  it('saveDiff는 metadata만 있는 payload를 service에 위임한다', async () => {
    vi.mocked(svc.saveSurveyDiff).mockResolvedValue({ surveyId: SURVEY_ID } as never);
    const client = createRouterClient({ save }, { context: authedContext() });
    const input = {
      surveyId: SURVEY_ID,
      metadata: { title: '제목', settings: SETTINGS },
    };
    const res = await client.save.saveDiff(input);
    expect(svc.saveSurveyDiff).toHaveBeenCalledWith(input);
    expect(res).toEqual({ surveyId: SURVEY_ID });
  });

  it('saveDiff는 questionChanges만 있는 payload를 service에 위임한다', async () => {
    vi.mocked(svc.saveSurveyDiff).mockResolvedValue({ surveyId: SURVEY_ID } as never);
    const client = createRouterClient({ save }, { context: authedContext() });
    const input = {
      surveyId: SURVEY_ID,
      questionChanges: {
        upserted: [{ id: QUESTION_ID, type: 'text', title: 'Q', order: 1 }],
        deleted: [],
      },
    };
    const res = await client.save.saveDiff(input as never);
    expect(svc.saveSurveyDiff).toHaveBeenCalledWith(input);
    expect(res).toEqual({ surveyId: SURVEY_ID });
  });

  it('saveDiff는 metadata + questionChanges 둘 다 있는 payload를 통과시킨다', async () => {
    vi.mocked(svc.saveSurveyDiff).mockResolvedValue({ surveyId: SURVEY_ID } as never);
    const client = createRouterClient({ save }, { context: authedContext() });
    const input = {
      surveyId: SURVEY_ID,
      metadata: { title: '제목', settings: SETTINGS },
      questionChanges: {
        upserted: [],
        deleted: [QUESTION_ID],
        reorderedIds: [QUESTION_ID],
      },
    };
    await client.save.saveDiff(input as never);
    expect(svc.saveSurveyDiff).toHaveBeenCalledWith(input);
  });

  it('saveWithDetails는 세션 사용자와 전체 Survey를 service에 위임한다', async () => {
    vi.mocked(svc.saveSurveyWithDetails).mockResolvedValue({ surveyId: SURVEY_ID } as never);
    const context = authedContext();
    const client = createRouterClient({ save }, { context });
    const survey = {
      id: SURVEY_ID,
      title: '제목',
      questions: [],
      settings: SETTINGS,
      createdAt: new Date('2026-06-01T00:00:00Z'),
      updatedAt: new Date('2026-06-01T00:00:00Z'),
    };
    const res = await client.save.saveWithDetails(survey as never);
    expect(svc.saveSurveyWithDetails).toHaveBeenCalledWith(context.user, survey);
    expect(res).toEqual({ surveyId: SURVEY_ID });
  });

  it('인증 없으면 saveDiff가 UNAUTHORIZED로 막힌다', async () => {
    const client = createRouterClient({ save }, { context: anonContext() });
    await expect(
      client.save.saveDiff({ surveyId: SURVEY_ID }),
    ).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });
});

describe('surveyBuilder.save — capability 관문 (티켓 09)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('saveDiff 는 survey.edit 관문을 지난다', async () => {
    vi.mocked(svc.saveSurveyDiff).mockResolvedValue({ surveyId: SURVEY_ID } as never);
    const context = authedContext();
    const client = createRouterClient({ save }, { context });
    await client.save.saveDiff({ surveyId: SURVEY_ID });
    expect(assertSurveyCapabilityRpc).toHaveBeenCalledWith(context.user, SURVEY_ID, 'survey.edit');
  });

  it('타 팀 설문 id 로 saveDiff 하면 service 에 닿지 않는다', async () => {
    vi.mocked(assertSurveyCapabilityRpc).mockRejectedValue(
      new ORPCError('NOT_FOUND', { message: '설문을 찾을 수 없습니다.' }),
    );
    const client = createRouterClient({ save }, { context: authedContext() });
    await expect(client.save.saveDiff({ surveyId: SURVEY_ID })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    expect(svc.saveSurveyDiff).not.toHaveBeenCalled();
  });

  it('saveWithDetails 의 서비스 관문 거부(SurveyAccessError)를 RPC 코드로 옮긴다', async () => {
    // 모드 분기(생성/갱신 판정)가 트랜잭션 안에 있어 관문도 서비스가 갖는다 — procedure 는
    // 사유만 옮긴다. not_found 는 삭제된 설문(tombstone)·타 팀 설문 모두를 덮는다.
    vi.mocked(svc.saveSurveyWithDetails).mockRejectedValue(new SurveyAccessError('not_found'));
    const client = createRouterClient({ save }, { context: authedContext() });
    await expect(
      client.save.saveWithDetails({ id: SURVEY_ID, title: '제목', questions: [], settings: SETTINGS } as never),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });

    vi.mocked(svc.saveSurveyWithDetails).mockRejectedValue(new SurveyAccessError('forbidden'));
    await expect(
      client.save.saveWithDetails({ id: SURVEY_ID, title: '제목', questions: [], settings: SETTINGS } as never),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});
