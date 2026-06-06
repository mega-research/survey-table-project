import { createRouterClient } from '@orpc/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ORPCContext } from '@/server/context';

vi.mock('../services/questions.service', async () => {
  const actual = await vi.importActual<
    typeof import('../services/questions.service')
  >('../services/questions.service');
  return {
    ...actual,
    createQuestion: vi.fn(),
    updateQuestion: vi.fn(),
    deleteQuestion: vi.fn(),
    reorderQuestions: vi.fn(),
  };
});

import * as svc from '../services/questions.service';
import { questions } from './questions';

function authedContext(): ORPCContext {
  return { db: {} as never, supabase: {} as never, user: { id: 'admin-1', email: 'a@b.com' } };
}

const SURVEY_ID = '11111111-1111-4111-8111-111111111111';
const QUESTION_ID = '22222222-2222-4222-8222-222222222222';
const GROUP_ID = '33333333-3333-4333-8333-333333333333';

describe('surveyBuilder.questions procedures', () => {
  beforeEach(() => vi.clearAllMocks());

  it('create는 service.createQuestion에 위임하고 행을 반환한다', async () => {
    const row = { id: QUESTION_ID, surveyId: SURVEY_ID, type: 'text', title: 'Q1' };
    vi.mocked(svc.createQuestion).mockResolvedValue(row as never);
    const client = createRouterClient({ questions }, { context: authedContext() });
    const input = { surveyId: SURVEY_ID, type: 'text', title: 'Q1' };
    const res = await client.questions.create(input);
    expect(svc.createQuestion).toHaveBeenCalledWith(input);
    expect(res).toEqual(row);
  });

  it('update는 service.updateQuestion에 (questionId, data)로 위임한다', async () => {
    const row = { id: QUESTION_ID, surveyId: SURVEY_ID, type: 'text', title: 'Q1-edit' };
    vi.mocked(svc.updateQuestion).mockResolvedValue(row as never);
    const client = createRouterClient({ questions }, { context: authedContext() });
    const res = await client.questions.update({
      questionId: QUESTION_ID,
      data: { title: 'Q1-edit', groupId: GROUP_ID },
    });
    expect(svc.updateQuestion).toHaveBeenCalledWith(QUESTION_ID, {
      title: 'Q1-edit',
      groupId: GROUP_ID,
    });
    expect(res).toEqual(row);
  });

  it('remove는 service.deleteQuestion에 위임하고 {ok:true}를 반환한다', async () => {
    vi.mocked(svc.deleteQuestion).mockResolvedValue({ ok: true } as never);
    const client = createRouterClient({ questions }, { context: authedContext() });
    const res = await client.questions.remove({ questionId: QUESTION_ID });
    expect(svc.deleteQuestion).toHaveBeenCalledWith(QUESTION_ID);
    expect(res).toEqual({ ok: true });
  });

  it('reorder는 service.reorderQuestions에 questionIds로 위임한다', async () => {
    vi.mocked(svc.reorderQuestions).mockResolvedValue({ ok: true } as never);
    const client = createRouterClient({ questions }, { context: authedContext() });
    const ids = [QUESTION_ID, GROUP_ID];
    const res = await client.questions.reorder({ questionIds: ids });
    expect(svc.reorderQuestions).toHaveBeenCalledWith(ids);
    expect(res).toEqual({ ok: true });
  });

  it('인증 없으면 create가 UNAUTHORIZED로 막힌다', async () => {
    const client = createRouterClient(
      { questions },
      { context: { db: {} as never, supabase: {} as never, user: null } },
    );
    await expect(
      client.questions.create({ surveyId: SURVEY_ID, type: 'text', title: 'Q1' }),
    ).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });
});
