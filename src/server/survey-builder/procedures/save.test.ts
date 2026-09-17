import { createRouterClient } from '@orpc/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ORPCContext } from '@/server/context';

vi.mock('../services/survey-save', () => ({
  saveSurveyDiff: vi.fn(),
  saveSurveyWithDetails: vi.fn(),
}));

import * as svc from '../services/survey-save';
import { save } from './save';

function authedContext(): ORPCContext {
  return { db: {} as never, supabase: {} as never, user: { id: 'admin-1', email: 'a@b.com' } };
}

function anonContext(): ORPCContext {
  return { db: {} as never, supabase: {} as never, user: null };
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

  it('saveWithDetails는 전체 Survey를 service에 위임한다', async () => {
    vi.mocked(svc.saveSurveyWithDetails).mockResolvedValue({ surveyId: SURVEY_ID } as never);
    const client = createRouterClient({ save }, { context: authedContext() });
    const survey = {
      id: SURVEY_ID,
      title: '제목',
      questions: [],
      settings: SETTINGS,
      createdAt: new Date('2026-06-01T00:00:00Z'),
      updatedAt: new Date('2026-06-01T00:00:00Z'),
    };
    const res = await client.save.saveWithDetails(survey as never);
    expect(svc.saveSurveyWithDetails).toHaveBeenCalledWith(survey);
    expect(res).toEqual({ surveyId: SURVEY_ID });
  });

  it('인증 없으면 saveDiff가 UNAUTHORIZED로 막힌다', async () => {
    const client = createRouterClient({ save }, { context: anonContext() });
    await expect(
      client.save.saveDiff({ surveyId: SURVEY_ID }),
    ).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });
});
