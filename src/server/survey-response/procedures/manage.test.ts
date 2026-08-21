import { createRouterClient } from '@orpc/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ORPCContext } from '@/server/context';

vi.mock('../services/response-manage.service', async () => {
  const actual = await vi.importActual<
    typeof import('../services/response-manage.service')
  >('../services/response-manage.service');
  return {
    ...actual,
    softDeleteResponse: vi.fn(),
    restoreResponse: vi.fn(),
    hardResetResponse: vi.fn(),
    allowReeditResponse: vi.fn(),
  };
});

import * as svc from '../services/response-manage.service';
import { manage } from './manage';

function authedContext(): ORPCContext {
  return { db: {} as never, supabase: {} as never, user: { id: 'admin-1', email: 'a@b.com' } };
}

const SURVEY_ID = '11111111-1111-4111-8111-111111111111';
const RESPONSE_ID = '22222222-2222-4222-8222-222222222222';

describe('surveyResponse.manage procedures', () => {
  beforeEach(() => vi.clearAllMocks());

  it('softDelete는 service.softDeleteResponse에 위임하고 {ok:true}를 반환한다', async () => {
    vi.mocked(svc.softDeleteResponse).mockResolvedValue({ ok: true } as never);
    const client = createRouterClient({ manage }, { context: authedContext() });
    const input = { surveyId: SURVEY_ID, responseId: RESPONSE_ID };
    const res = await client.manage.softDelete(input);
    expect(svc.softDeleteResponse).toHaveBeenCalledWith(input);
    expect(res).toEqual({ ok: true });
  });

  it('restore는 service.restoreResponse에 위임하고 {ok:true}를 반환한다', async () => {
    vi.mocked(svc.restoreResponse).mockResolvedValue({ ok: true } as never);
    const client = createRouterClient({ manage }, { context: authedContext() });
    const input = { surveyId: SURVEY_ID, responseId: RESPONSE_ID };
    const res = await client.manage.restore(input);
    expect(svc.restoreResponse).toHaveBeenCalledWith(input);
    expect(res).toEqual({ ok: true });
  });

  it('hardReset는 service.hardResetResponse에 편집자 스냅샷과 함께 위임하고 {ok:true}를 반환한다', async () => {
    vi.mocked(svc.hardResetResponse).mockResolvedValue({ ok: true } as never);
    const client = createRouterClient({ manage }, { context: authedContext() });
    const input = { surveyId: SURVEY_ID, responseId: RESPONSE_ID };
    const res = await client.manage.hardReset(input);
    expect(svc.hardResetResponse).toHaveBeenCalledWith(input, {
      id: 'admin-1',
      email: 'a@b.com',
    });
    expect(res).toEqual({ ok: true });
  });

  it('allowReedit는 service.allowReeditResponse에 편집자 스냅샷과 함께 위임하고 {ok:true}를 반환한다', async () => {
    vi.mocked(svc.allowReeditResponse).mockResolvedValue({ ok: true } as never);
    const client = createRouterClient({ manage }, { context: authedContext() });
    const input = { surveyId: SURVEY_ID, responseId: RESPONSE_ID };
    const res = await client.manage.allowReedit(input);
    expect(svc.allowReeditResponse).toHaveBeenCalledWith(input, {
      id: 'admin-1',
      email: 'a@b.com',
    });
    expect(res).toEqual({ ok: true });
  });

  it('allowReedit는 ReeditUnavailableError를 사유별 안내가 담긴 BAD_REQUEST로 매핑한다', async () => {
    vi.mocked(svc.allowReeditResponse).mockRejectedValue(
      new svc.ReeditUnavailableError('survey_paused') as never,
    );
    const client = createRouterClient({ manage }, { context: authedContext() });
    await expect(
      client.manage.allowReedit({ surveyId: SURVEY_ID, responseId: RESPONSE_ID }),
    ).rejects.toMatchObject({
      code: 'BAD_REQUEST',
      message: expect.stringContaining('중단 상태'),
    });
  });

  it('SurveyOwnershipError는 NOT_FOUND로 매핑된다', async () => {
    vi.mocked(svc.softDeleteResponse).mockRejectedValue(
      new svc.SurveyOwnershipError('not_found') as never,
    );
    const client = createRouterClient({ manage }, { context: authedContext() });
    await expect(
      client.manage.softDelete({ surveyId: SURVEY_ID, responseId: RESPONSE_ID }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('인증 없으면 softDelete가 UNAUTHORIZED로 막힌다', async () => {
    const client = createRouterClient(
      { manage },
      { context: { db: {} as never, supabase: {} as never, user: null } },
    );
    await expect(
      client.manage.softDelete({ surveyId: SURVEY_ID, responseId: RESPONSE_ID }),
    ).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });
});
