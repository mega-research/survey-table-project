import { createRouterClient } from '@orpc/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ORPCContext } from '@/server/context';

import * as svc from '../services/control.service';
import { control } from './control';

vi.mock('../services/control.service', () => ({
  getControlState: vi.fn(),
  setPaused: vi.fn(),
  setTestMode: vi.fn(),
  disableTestWorkspace: vi.fn(),
}));

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
      accessIdentifier: 'survey-1',
      testResponseCount: 0,
      testTargetCount: 1,
      firstTestInviteCode: 'invite-first',
    });
    const client = createRouterClient({ control }, { context: authedContext() });
    const res = await client.control.get({ surveyId: SURVEY_ID });
    expect(svc.getControlState).toHaveBeenCalledWith(SURVEY_ID);
    expect(res).toEqual({
      isPaused: false,
      pausedMessage: null,
      testModeEnabled: false,
      testToken: null,
      accessIdentifier: 'survey-1',
      testResponseCount: 0,
      testTargetCount: 1,
      firstTestInviteCode: 'invite-first',
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

  it('setTestMode 는 ON만 위임하고 전체 control state를 반환한다', async () => {
    vi.mocked(svc.setTestMode).mockResolvedValue({
      isPaused: false,
      pausedMessage: null,
      testModeEnabled: true,
      testToken: 'tok',
      accessIdentifier: 'survey-1',
      testResponseCount: 2,
      testTargetCount: 1,
      firstTestInviteCode: 'invite-first',
    });
    const client = createRouterClient({ control }, { context: authedContext() });
    const res = await client.control.setTestMode({ surveyId: SURVEY_ID, enabled: true });
    expect(svc.setTestMode).toHaveBeenCalledWith({ surveyId: SURVEY_ID, enabled: true });
    expect(res).toEqual({
      isPaused: false,
      pausedMessage: null,
      testModeEnabled: true,
      testToken: 'tok',
      accessIdentifier: 'survey-1',
      testResponseCount: 2,
      testTargetCount: 1,
      firstTestInviteCode: 'invite-first',
    });
  });

  it('setTestMode 는 arbitrary OFF 입력을 검증 단계에서 거부한다', async () => {
    const client = createRouterClient({ control }, { context: authedContext() });
    const callSetTestMode = client.control.setTestMode as unknown as (input: {
      surveyId: string;
      enabled: boolean;
    }) => Promise<unknown>;
    await expect(callSetTestMode({ surveyId: SURVEY_ID, enabled: false })).rejects.toBeDefined();
    expect(svc.setTestMode).not.toHaveBeenCalled();
  });

  it('disable은 keep/delete disposition을 유일한 OFF service에 위임한다', async () => {
    vi.mocked(svc.disableTestWorkspace).mockResolvedValue({
      testModeEnabled: false,
      deletedResponseCount: 3,
      deletedTargetCount: 2,
      remainingResponseCount: 0,
      remainingTargetCount: 0,
    });
    const client = createRouterClient({ control }, { context: authedContext() });
    const res = await client.control.disable({ surveyId: SURVEY_ID, disposition: 'delete' });
    expect(svc.disableTestWorkspace).toHaveBeenCalledWith({
      surveyId: SURVEY_ID,
      disposition: 'delete',
    });
    expect(res).toEqual({
      testModeEnabled: false,
      deletedResponseCount: 3,
      deletedTargetCount: 2,
      remainingResponseCount: 0,
      remainingTargetCount: 0,
    });
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
