import { createRouterClient } from '@orpc/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ORPCContext } from '@/server/context';

vi.mock('../services/response.service', () => ({
  startResponse: vi.fn(),
  updateQuestionResponse: vi.fn(),
  createResponseWithFirstAnswer: vi.fn(),
  createBlankResponse: vi.fn(),
  completeResponse: vi.fn(),
}));

import * as svc from '../services/response.service';
import { response } from './response';

function anonContext(): ORPCContext {
  return {
    db: {} as never,
    supabase: { tag: 'anon-supabase' } as never,
    user: null,
    // rate limit 미들웨어가 신뢰 IP 를 추출하도록 정상 요청 헤더를 제공한다.
    headers: new Headers({ 'x-real-ip': '203.0.113.7' }),
  };
}

// zod v4 .uuid() 와 무관하게 응답 도메인 input 은 z.string 이지만, 픽스처는 v4 형태로 통일한다.
const RESPONSE_ID = '11111111-2222-4333-8444-555555555555';
const SURVEY_ID = '22222222-3333-4444-8555-666666666666';
const QUESTION_ID = '33333333-4444-4555-8666-777777777777';
const VERSION_ID = '44444444-5555-4666-8777-888888888888';
const CONTACT_ID = '55555555-6666-4777-8888-999999999999';

const CLIENT_SIGNALS = {
  deviceId: 'device-abc',
  screen: '1920x1080',
  tz: 'Asia/Seoul',
  lang: 'ko-KR',
  platform: 'MacIntel',
};

describe('surveyResponse.response procedures', () => {
  beforeEach(() => vi.clearAllMocks());

  it('updateAnswer(pub)는 객체 input 을 service 에 그대로 위임한다', async () => {
    vi.mocked(svc.updateQuestionResponse).mockResolvedValue({ id: RESPONSE_ID } as never);
    const client = createRouterClient({ response }, { context: anonContext() });
    await client.response.updateAnswer({
      responseId: RESPONSE_ID,
      questionId: QUESTION_ID,
      value: { foo: 'bar' },
    });
    expect(svc.updateQuestionResponse).toHaveBeenCalledWith({
      responseId: RESPONSE_ID,
      questionId: QUESTION_ID,
      value: { foo: 'bar' },
    });
  });

  it('createWithFirstAnswer(pub)는 created 분기를 통과시킨다', async () => {
    vi.mocked(svc.createResponseWithFirstAnswer).mockResolvedValue({
      kind: 'created',
      id: RESPONSE_ID,
      contactTargetId: CONTACT_ID,
    } as never);
    const client = createRouterClient({ response }, { context: anonContext() });
    const res = await client.response.createWithFirstAnswer({
      surveyId: SURVEY_ID,
      sessionId: 'sess-1',
      versionId: VERSION_ID,
      questionId: QUESTION_ID,
      value: 'answer',
      currentStepId: 'group:abc',
      inviteToken: undefined,
      clientSignals: CLIENT_SIGNALS,
    });
    expect(res).toEqual({ kind: 'created', id: RESPONSE_ID, contactTargetId: CONTACT_ID });
    expect(svc.createResponseWithFirstAnswer).toHaveBeenCalledWith(
      expect.objectContaining({ surveyId: SURVEY_ID, sessionId: 'sess-1', questionId: QUESTION_ID }),
    );
  });

  it('createWithFirstAnswer(pub)는 blocked 분기(reason)를 통과시킨다', async () => {
    vi.mocked(svc.createResponseWithFirstAnswer).mockResolvedValue({
      kind: 'blocked',
      reason: 'token_already_used',
    } as never);
    const client = createRouterClient({ response }, { context: anonContext() });
    const res = await client.response.createWithFirstAnswer({
      surveyId: SURVEY_ID,
      sessionId: 'sess-1',
      versionId: null,
      questionId: QUESTION_ID,
      value: 'answer',
      currentStepId: 'group:abc',
      inviteToken: 'token-x',
      clientSignals: null,
    });
    expect(res).toEqual({ kind: 'blocked', reason: 'token_already_used' });
  });

  it('createBlank(pub)는 clientSignals null 도 통과시켜 service 에 위임한다', async () => {
    vi.mocked(svc.createBlankResponse).mockResolvedValue({
      kind: 'created',
      id: RESPONSE_ID,
      contactTargetId: null,
    } as never);
    const client = createRouterClient({ response }, { context: anonContext() });
    const res = await client.response.createBlank({
      surveyId: SURVEY_ID,
      sessionId: 'sess-2',
      versionId: null,
      currentStepId: 'group:abc',
      clientSignals: null,
    });
    expect(res).toEqual({ kind: 'created', id: RESPONSE_ID, contactTargetId: null });
    expect(svc.createBlankResponse).toHaveBeenCalledWith(
      expect.objectContaining({ surveyId: SURVEY_ID, clientSignals: null }),
    );
  });

  it('complete(pub)는 responseId + data 를 service 에 위임한다', async () => {
    vi.mocked(svc.completeResponse).mockResolvedValue({ id: RESPONSE_ID } as never);
    const client = createRouterClient({ response }, { context: anonContext() });
    await client.response.complete({
      responseId: RESPONSE_ID,
      data: {
        questionResponses: { [QUESTION_ID]: 'a' },
        exposedQuestionIds: [QUESTION_ID],
        exposedRowIds: ['row-1'],
      },
    });
    expect(svc.completeResponse).toHaveBeenCalledWith({
      responseId: RESPONSE_ID,
      data: {
        questionResponses: { [QUESTION_ID]: 'a' },
        exposedQuestionIds: [QUESTION_ID],
        exposedRowIds: ['row-1'],
      },
    });
  });

  it('complete(pub)는 data 없이도 호출 가능하다', async () => {
    vi.mocked(svc.completeResponse).mockResolvedValue({ id: RESPONSE_ID } as never);
    const client = createRouterClient({ response }, { context: anonContext() });
    await client.response.complete({ responseId: RESPONSE_ID });
    expect(svc.completeResponse).toHaveBeenCalledWith({ responseId: RESPONSE_ID });
  });
});
