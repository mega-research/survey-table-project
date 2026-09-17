import { createRouterClient, ORPCError } from '@orpc/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ORPCContext } from '@/server/context';
import { assertSurveyCapabilityRpc } from '@/server/rpc-survey-access';

import * as svc from '../services/control';
import { control } from './control';

vi.mock('../services/control', () => ({
  getControlState: vi.fn(),
  setPaused: vi.fn(),
  setTestMode: vi.fn(),
  disableTestWorkspace: vi.fn(),
}));

vi.mock('@/server/rpc-survey-access', () => ({ assertSurveyCapabilityRpc: vi.fn() }));

function authedContext(): ORPCContext {
  return { db: {} as never, user: { id: 'admin-1', email: 'a@b.com', name: '관리자', status: 'active', isSuperadmin: false , userType: 'internal'} };
}

const SURVEY_ID = '11111111-1111-4111-8111-111111111111';

describe('operations.control procedures', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.unstubAllEnvs());

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
    const context = authedContext();
    const client = createRouterClient({ control }, { context });
    const res = await client.control.get({ surveyId: SURVEY_ID });
    expect(assertSurveyCapabilityRpc).toHaveBeenCalledWith(
      context.user,
      SURVEY_ID,
      'operations.view',
    );
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
    const context = authedContext();
    const client = createRouterClient({ control }, { context });
    const res = await client.control.setPaused({
      surveyId: SURVEY_ID,
      isPaused: true,
      pausedMessage: '점검 중',
    });
    expect(assertSurveyCapabilityRpc).toHaveBeenCalledWith(context.user, SURVEY_ID, 'survey.edit');
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
    const context = authedContext();
    const client = createRouterClient({ control }, { context });
    const res = await client.control.setTestMode({ surveyId: SURVEY_ID, enabled: true });
    expect(assertSurveyCapabilityRpc).toHaveBeenCalledWith(context.user, SURVEY_ID, 'survey.edit');
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
    const context = authedContext();
    const client = createRouterClient({ control }, { context });
    const res = await client.control.disable({ surveyId: SURVEY_ID, disposition: 'delete' });
    expect(assertSurveyCapabilityRpc).toHaveBeenCalledWith(context.user, SURVEY_ID, 'survey.edit');
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

  it('관문 NOT_FOUND 는 get 에서 null 로 접힌다 — 미저장·비가시 설문 OFF 폴백 규약', async () => {
    vi.mocked(assertSurveyCapabilityRpc).mockRejectedValueOnce(
      new ORPCError('NOT_FOUND', { message: '설문을 찾을 수 없습니다.' }),
    );
    const client = createRouterClient({ control }, { context: authedContext() });
    await expect(client.control.get({ surveyId: SURVEY_ID })).resolves.toBeNull();
    expect(svc.getControlState).not.toHaveBeenCalled();
  });

  it('관문 FORBIDDEN 은 get 에서도 그대로 던진다 — null 접기는 존재 은닉 전용', async () => {
    vi.mocked(assertSurveyCapabilityRpc).mockRejectedValueOnce(
      new ORPCError('FORBIDDEN', { message: '이 작업을 수행할 권한이 없습니다.' }),
    );
    const client = createRouterClient({ control }, { context: authedContext() });
    await expect(client.control.get({ surveyId: SURVEY_ID })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    expect(svc.getControlState).not.toHaveBeenCalled();
  });

  it.each([
    ['setPaused', () => ({ surveyId: SURVEY_ID, isPaused: true })],
    ['setTestMode', () => ({ surveyId: SURVEY_ID, enabled: true as const })],
    ['disable', () => ({ surveyId: SURVEY_ID, disposition: 'delete' as const })],
  ])('타 팀 설문 id 로 %s 하면 NOT_FOUND — 서비스에 닿지 않는다', async (name, makeInput) => {
    vi.mocked(assertSurveyCapabilityRpc).mockRejectedValueOnce(
      new ORPCError('NOT_FOUND', { message: '설문을 찾을 수 없습니다.' }),
    );
    const client = createRouterClient({ control }, { context: authedContext() });
    const call = client.control[name as 'setPaused'] as (input: unknown) => Promise<unknown>;
    await expect(call(makeInput())).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(svc.setPaused).not.toHaveBeenCalled();
    expect(svc.setTestMode).not.toHaveBeenCalled();
    expect(svc.disableTestWorkspace).not.toHaveBeenCalled();
  });

  it('인증 없으면 get이 UNAUTHORIZED로 막힌다', async () => {
    const client = createRouterClient(
      { control },
      { context: { db: {} as never, user: null } },
    );
    await expect(client.control.get({ surveyId: SURVEY_ID })).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
    });
  });

  it('게스트 계정은 get 이 FORBIDDEN (테스트 토큰 노출 차단)', async () => {
    const client = createRouterClient(
      { control },
      {
        context: {
          db: {} as never,
          user: { id: 'guest-1', email: 'g@b.com', name: '게스트', status: 'active', isSuperadmin: false, userType: 'guest' },
        },
      },
    );
    await expect(client.control.get({ surveyId: SURVEY_ID })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    expect(svc.getControlState).not.toHaveBeenCalled();
  });

  it('게스트 계정은 setTestMode 가 FORBIDDEN (authed 유지)', async () => {
    const client = createRouterClient(
      { control },
      {
        context: {
          db: {} as never,
          user: { id: 'guest-1', email: 'g@b.com', name: '게스트', status: 'active', isSuperadmin: false, userType: 'guest' },
        },
      },
    );
    await expect(
      client.control.setTestMode({ surveyId: SURVEY_ID, enabled: true }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(svc.setTestMode).not.toHaveBeenCalled();
  });

  it('게스트 계정은 disable 이 FORBIDDEN (테스트 데이터 삭제 차단)', async () => {
    const client = createRouterClient(
      { control },
      {
        context: {
          db: {} as never,
          user: { id: 'guest-1', email: 'g@b.com', name: '게스트', status: 'active', isSuperadmin: false, userType: 'guest' },
        },
      },
    );
    await expect(
      client.control.disable({ surveyId: SURVEY_ID, disposition: 'delete' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(svc.disableTestWorkspace).not.toHaveBeenCalled();
  });

  it('게스트 계정은 setPaused 가 FORBIDDEN (authed 유지)', async () => {
    const client = createRouterClient(
      { control },
      { context: { db: {} as never, user: { id: 'guest-1', email: 'g@b.com', name: '게스트', status: 'active', isSuperadmin: false, userType: 'guest' } } },
    );
    await expect(
      client.control.setPaused({ surveyId: SURVEY_ID, isPaused: true }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(svc.setPaused).not.toHaveBeenCalled();
  });
});
