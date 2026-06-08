import { createRouterClient } from '@orpc/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ORPCContext } from '@/server/context';

vi.mock('../services/response-edit.service', async () => {
  const actual = await vi.importActual<
    typeof import('../services/response-edit.service')
  >('../services/response-edit.service');
  return {
    ...actual,
    saveAdminEdit: vi.fn(),
  };
});

import * as svc from '../services/response-edit.service';
import { edit } from './edit';

function authedContext(): ORPCContext {
  return { db: {} as never, supabase: {} as never, user: { id: 'admin-1', email: 'a@b.com' } };
}

// 픽스처 UUID 는 v4 형태(...-4xxx-8xxx-...). input 이 z.string() 이라 엄격 강제는 아님.
const SURVEY_ID = '11111111-1111-4111-8111-111111111111';
const RESPONSE_ID = '22222222-2222-4222-8222-222222222222';

describe('surveyResponse.edit procedures', () => {
  beforeEach(() => vi.clearAllMocks());

  it('saveAdminEdit는 입력을 service에 위임하고 {ok:true}를 반환한다', async () => {
    vi.mocked(svc.saveAdminEdit).mockResolvedValue({ ok: true } as never);
    const client = createRouterClient({ edit }, { context: authedContext() });
    const input = {
      surveyId: SURVEY_ID,
      responseId: RESPONSE_ID,
      questionResponses: { q1: 'a' },
    };
    const res = await client.edit.saveAdminEdit(input);
    expect(svc.saveAdminEdit).toHaveBeenCalledWith(input, {
      id: 'admin-1',
      email: 'a@b.com',
    });
    expect(res).toEqual({ ok: true });
  });

  it('SurveyOwnershipError는 NOT_FOUND로 매핑된다', async () => {
    vi.mocked(svc.saveAdminEdit).mockRejectedValue(
      new svc.SurveyOwnershipError('not_found') as never,
    );
    const client = createRouterClient({ edit }, { context: authedContext() });
    await expect(
      client.edit.saveAdminEdit({
        surveyId: SURVEY_ID,
        responseId: RESPONSE_ID,
        questionResponses: {},
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it("'Response not found' throw는 NOT_FOUND로 매핑된다", async () => {
    vi.mocked(svc.saveAdminEdit).mockRejectedValue(new Error('Response not found') as never);
    const client = createRouterClient({ edit }, { context: authedContext() });
    await expect(
      client.edit.saveAdminEdit({
        surveyId: SURVEY_ID,
        responseId: RESPONSE_ID,
        questionResponses: {},
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it("'Cannot edit deleted response' throw는 BAD_REQUEST로 매핑된다", async () => {
    vi.mocked(svc.saveAdminEdit).mockRejectedValue(
      new Error('Cannot edit deleted response') as never,
    );
    const client = createRouterClient({ edit }, { context: authedContext() });
    await expect(
      client.edit.saveAdminEdit({
        surveyId: SURVEY_ID,
        responseId: RESPONSE_ID,
        questionResponses: {},
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });

  it('인증 없으면 saveAdminEdit가 UNAUTHORIZED로 막힌다', async () => {
    const client = createRouterClient(
      { edit },
      { context: { db: {} as never, supabase: {} as never, user: null } },
    );
    await expect(
      client.edit.saveAdminEdit({
        surveyId: SURVEY_ID,
        responseId: RESPONSE_ID,
        questionResponses: {},
      }),
    ).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });
});
