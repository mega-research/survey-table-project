import { ORPCError, createRouterClient } from '@orpc/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ORPCContext } from '@/server/context';
import { assertSurveyCapabilityRpc } from '@/server/rpc-survey-access';

import * as svc from '../services/scale-mean';
import { scaleMean } from './scale-mean';

vi.mock('../services/scale-mean', () => ({
  setScaleMeanQuestions: vi.fn(),
}));
vi.mock('@/server/rpc-survey-access', () => ({ assertSurveyCapabilityRpc: vi.fn() }));

function ctx(userType: 'internal' | 'guest' | 'fieldwork' = 'internal'): ORPCContext {
  return {
    db: {} as never,
    user: {
      id: 'user-1',
      email: 'a@b.com',
      name: '사용자',
      status: 'active',
      isSuperadmin: false,
      userType,
    },
  };
}

const SURVEY_ID = '11111111-1111-4111-8111-111111111111';

describe('operations.scaleMean procedures', () => {
  beforeEach(() => vi.clearAllMocks());

  it('setQuestions 는 survey.edit 관문을 지난 뒤 입력을 service 에 위임한다', async () => {
    vi.mocked(svc.setScaleMeanQuestions).mockResolvedValue({ ok: true });
    const context = ctx();
    const client = createRouterClient({ scaleMean }, { context });
    const input = { surveyId: SURVEY_ID, questionIds: ['q1', 'q2'] };
    await expect(client.scaleMean.setQuestions(input)).resolves.toEqual({ ok: true });
    expect(assertSurveyCapabilityRpc).toHaveBeenCalledWith(context.user, SURVEY_ID, 'survey.edit');
    expect(svc.setScaleMeanQuestions).toHaveBeenCalledWith(input);
  });

  it('설문 편집 권한이 없으면 관문에서 막히고 service 에 닿지 않는다 — 다른 팀 설문을 못 바꾼다', async () => {
    vi.mocked(assertSurveyCapabilityRpc).mockRejectedValueOnce(
      new ORPCError('NOT_FOUND', { message: '설문을 찾을 수 없습니다.' }),
    );
    const client = createRouterClient({ scaleMean }, { context: ctx() });
    await expect(
      client.scaleMean.setQuestions({ surveyId: SURVEY_ID, questionIds: ['q1'] }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(svc.setScaleMeanQuestions).not.toHaveBeenCalled();
  });

  it('거부 결과 {ok:false,error} 는 throw 없이 그대로 통과한다', async () => {
    vi.mocked(svc.setScaleMeanQuestions).mockResolvedValue({ ok: false, error: '안 됨' });
    const client = createRouterClient({ scaleMean }, { context: ctx() });
    await expect(
      client.scaleMean.setQuestions({ surveyId: SURVEY_ID, questionIds: ['x'] }),
    ).resolves.toEqual({ ok: false, error: '안 됨' });
  });

  it('인증 없으면 UNAUTHORIZED 로 막히고 service 를 부르지 않는다', async () => {
    const client = createRouterClient({ scaleMean }, { context: { db: {} as never, user: null } });
    await expect(
      client.scaleMean.setQuestions({ surveyId: SURVEY_ID, questionIds: [] }),
    ).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    expect(svc.setScaleMeanQuestions).not.toHaveBeenCalled();
  });

  it('외부 계정은 FORBIDDEN — 척도 평균은 내부 담당자 화면이다', async () => {
    const client = createRouterClient({ scaleMean }, { context: ctx('guest') });
    await expect(
      client.scaleMean.setQuestions({ surveyId: SURVEY_ID, questionIds: [] }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(svc.setScaleMeanQuestions).not.toHaveBeenCalled();
  });

  it('surveyId 가 UUID 가 아니면 입력 검증에서 막힌다', async () => {
    const client = createRouterClient({ scaleMean }, { context: ctx() });
    await expect(
      client.scaleMean.setQuestions({ surveyId: 'not-a-uuid', questionIds: [] }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect(svc.setScaleMeanQuestions).not.toHaveBeenCalled();
  });
});
