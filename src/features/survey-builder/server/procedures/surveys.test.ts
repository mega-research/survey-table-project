import { createRouterClient } from '@orpc/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ORPCContext } from '@/server/context';

vi.mock('../services/surveys.service', () => ({
  ensureSurveyInDb: vi.fn(),
  createSurvey: vi.fn(),
  updateSurvey: vi.fn(),
  deleteSurvey: vi.fn(),
  duplicateSurvey: vi.fn(),
}));

import * as svc from '../services/surveys.service';
import { surveys } from './surveys';

function authedContext(): ORPCContext {
  return { db: {} as never, supabase: {} as never, user: { id: 'admin-1', email: 'a@b.com' } };
}

function anonContext(): ORPCContext {
  return { db: {} as never, supabase: {} as never, user: null };
}

const SURVEY_ID = '11111111-2222-4333-8444-555555555555';

const SETTINGS = {
  isPublic: true,
  allowMultipleResponses: false,
  showProgressBar: true,
  shuffleQuestions: false,
  requireLogin: false,
  thankYouMessage: '응답해주셔서 감사합니다!',
};

const SURVEY_ROW = {
  id: SURVEY_ID,
  title: '설문 제목',
  description: null,
  slug: null,
  privateToken: null,
  isPublic: true,
  createdAt: new Date('2026-06-01T00:00:00Z'),
  updatedAt: new Date('2026-06-01T00:00:00Z'),
};

describe('surveyBuilder.surveys procedures', () => {
  beforeEach(() => vi.clearAllMocks());

  it('ensure는 service.ensureSurveyInDb에 위임하고 결과를 통과시킨다', async () => {
    vi.mocked(svc.ensureSurveyInDb).mockResolvedValue({
      surveyId: SURVEY_ID,
      created: true,
    } as never);
    const client = createRouterClient({ surveys }, { context: authedContext() });
    const input = { id: SURVEY_ID, title: '설문 제목', settings: SETTINGS };
    const res = await client.surveys.ensure(input);
    expect(svc.ensureSurveyInDb).toHaveBeenCalledWith(input);
    expect(res).toEqual({ surveyId: SURVEY_ID, created: true });
  });

  it('create는 service.createSurvey에 위임하고 survey 행을 반환한다', async () => {
    vi.mocked(svc.createSurvey).mockResolvedValue(SURVEY_ROW as never);
    const client = createRouterClient({ surveys }, { context: authedContext() });
    const input = { title: '설문 제목' };
    const res = await client.surveys.create(input);
    expect(svc.createSurvey).toHaveBeenCalledWith(input);
    expect(res).toMatchObject({ id: SURVEY_ID, title: '설문 제목' });
  });

  it('update는 (surveyId, data)를 단일 input object로 묶어 service에 위임한다', async () => {
    vi.mocked(svc.updateSurvey).mockResolvedValue(SURVEY_ROW as never);
    const client = createRouterClient({ surveys }, { context: authedContext() });
    const input = { surveyId: SURVEY_ID, data: { title: '바뀐 제목' } };
    const res = await client.surveys.update(input);
    expect(svc.updateSurvey).toHaveBeenCalledWith(input);
    expect(res).toMatchObject({ id: SURVEY_ID });
  });

  it('delete는 service.deleteSurvey에 위임한다(void)', async () => {
    vi.mocked(svc.deleteSurvey).mockResolvedValue(undefined as never);
    const client = createRouterClient({ surveys }, { context: authedContext() });
    const input = { surveyId: SURVEY_ID };
    await client.surveys.delete(input);
    expect(svc.deleteSurvey).toHaveBeenCalledWith(input);
  });

  it('duplicate는 service.duplicateSurvey에 위임하고 행(또는 null)을 반환한다', async () => {
    vi.mocked(svc.duplicateSurvey).mockResolvedValue(SURVEY_ROW as never);
    const client = createRouterClient({ surveys }, { context: authedContext() });
    const input = { surveyId: SURVEY_ID };
    const res = await client.surveys.duplicate(input);
    expect(svc.duplicateSurvey).toHaveBeenCalledWith(input);
    expect(res).toMatchObject({ id: SURVEY_ID });
  });

  it('duplicate는 원본 not found 시 null을 통과시킨다', async () => {
    vi.mocked(svc.duplicateSurvey).mockResolvedValue(null as never);
    const client = createRouterClient({ surveys }, { context: authedContext() });
    const res = await client.surveys.duplicate({ surveyId: SURVEY_ID });
    expect(res).toBeNull();
  });

  it('인증 없으면 create가 UNAUTHORIZED로 막힌다', async () => {
    const client = createRouterClient({ surveys }, { context: anonContext() });
    await expect(client.surveys.create({ title: 'x' })).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
    });
  });
});
