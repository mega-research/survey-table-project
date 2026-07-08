import { createRouterClient } from '@orpc/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ORPCContext } from '@/server/context';

vi.mock('../services/control.service', () => ({
  getControlState: vi.fn(),
  setPaused: vi.fn(),
  setTestMode: vi.fn(),
  deleteTestResponses: vi.fn(),
}));

import * as svc from '../services/control.service';
import { control } from './control';

function authedContext(): ORPCContext {
  return { db: {} as never, supabase: {} as never, user: { id: 'admin-1', email: 'a@b.com' } };
}

const SURVEY_ID = '11111111-1111-4111-8111-111111111111';

describe('operations.control procedures', () => {
  beforeEach(() => vi.clearAllMocks());

  it('get은 service.getControlState 결과를 반환한다', async () => {
    vi.mocked(svc.getControlState).mockResolvedValue({
      isPaused: false,
      pausedMessage: null,
      testModeEnabled: false,
      testToken: null,
      testResponseCount: 0,
    });
    const client = createRouterClient({ control }, { context: authedContext() });
    const res = await client.control.get({ surveyId: SURVEY_ID });
    expect(svc.getControlState).toHaveBeenCalledWith(SURVEY_ID);
    expect(res).toEqual({
      isPaused: false,
      pausedMessage: null,
      testModeEnabled: false,
      testToken: null,
      testResponseCount: 0,
    });
  });

  it('setPaused 는 서비스에 위임하고 결과를 반환한다', async () => {
    vi.mocked(svc.setPaused).mockResolvedValue({ isPaused: true, pausedMessage: '점검 중' });
    const client = createRouterClient({ control }, { context: authedContext() });
    const res = await client.control.setPaused({
      surveyId: SURVEY_ID,
      isPaused: true,
      pausedMessage: '점검 중',
    });
    expect(svc.setPaused).toHaveBeenCalledWith({
      surveyId: SURVEY_ID,
      isPaused: true,
      pausedMessage: '점검 중',
    });
    expect(res).toEqual({ isPaused: true, pausedMessage: '점검 중' });
  });

  it('setTestMode 는 enabled 를 위임한다', async () => {
    vi.mocked(svc.setTestMode).mockResolvedValue({ testModeEnabled: true, testToken: 'tok' });
    const client = createRouterClient({ control }, { context: authedContext() });
    const res = await client.control.setTestMode({ surveyId: SURVEY_ID, enabled: true });
    expect(svc.setTestMode).toHaveBeenCalledWith({ surveyId: SURVEY_ID, enabled: true });
    expect(res).toEqual({ testModeEnabled: true, testToken: 'tok' });
  });

  it('deleteTestResponses 는 서비스에 위임하고 삭제 건수를 반환한다', async () => {
    vi.mocked(svc.deleteTestResponses).mockResolvedValue({ deletedCount: 3 });
    const client = createRouterClient({ control }, { context: authedContext() });
    const res = await client.control.deleteTestResponses({ surveyId: SURVEY_ID });
    expect(svc.deleteTestResponses).toHaveBeenCalledWith(SURVEY_ID);
    expect(res).toEqual({ deletedCount: 3 });
  });

  it('인증 없으면 get이 UNAUTHORIZED로 막힌다', async () => {
    const client = createRouterClient(
      { control },
      { context: { db: {} as never, supabase: {} as never, user: null } },
    );
    await expect(client.control.get({ surveyId: SURVEY_ID })).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
    });
  });
});
