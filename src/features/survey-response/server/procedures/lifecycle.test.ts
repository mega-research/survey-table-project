import { createRouterClient } from '@orpc/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ORPCContext } from '@/server/context';

vi.mock('../services/lifecycle.service', () => ({
  recordStepVisit: vi.fn(),
  recordVisibilitySegment: vi.fn(),
  resumeOrCreateResponse: vi.fn(),
}));

import * as svc from '../services/lifecycle.service';
import { lifecycle } from './lifecycle';

function anonContext(): ORPCContext {
  return {
    db: {} as never,
    supabase: { tag: 'anon-supabase' } as never,
    user: null,
  };
}

// zod v4 .uuid() 와 무관하게 도메인 input 은 z.string 이지만, 픽스처는 v4 형태로 통일한다.
const RESPONSE_ID = '11111111-2222-4333-8444-555555555555';
const SURVEY_ID = '22222222-3333-4444-8555-666666666666';
const INVITE_TOKEN = '66666666-7777-4888-8999-aaaaaaaaaaaa';

describe('surveyResponse.lifecycle procedures', () => {
  beforeEach(() => vi.clearAllMocks());

  it('stepVisit(pub)는 익명 컨텍스트에서 service 에 위임하고 { ok: true } 반환', async () => {
    vi.mocked(svc.recordStepVisit).mockResolvedValue(undefined as never);
    const client = createRouterClient({ lifecycle }, { context: anonContext() });
    const res = await client.lifecycle.stepVisit({
      responseId: RESPONSE_ID,
      nextStepId: 'group:abc',
    });
    expect(res).toEqual({ ok: true });
    expect(svc.recordStepVisit).toHaveBeenCalledWith({
      responseId: RESPONSE_ID,
      nextStepId: 'group:abc',
    });
  });

  it('visibilitySegment(pub)는 hide action 을 service 에 위임한다', async () => {
    vi.mocked(svc.recordVisibilitySegment).mockResolvedValue(undefined as never);
    const client = createRouterClient({ lifecycle }, { context: anonContext() });
    const res = await client.lifecycle.visibilitySegment({
      responseId: RESPONSE_ID,
      action: 'hide',
    });
    expect(res).toEqual({ ok: true });
    expect(svc.recordVisibilitySegment).toHaveBeenCalledWith({
      responseId: RESPONSE_ID,
      action: 'hide',
    });
  });

  it('visibilitySegment(pub)는 show action 도 통과시킨다', async () => {
    vi.mocked(svc.recordVisibilitySegment).mockResolvedValue(undefined as never);
    const client = createRouterClient({ lifecycle }, { context: anonContext() });
    await client.lifecycle.visibilitySegment({ responseId: RESPONSE_ID, action: 'show' });
    expect(svc.recordVisibilitySegment).toHaveBeenCalledWith({
      responseId: RESPONSE_ID,
      action: 'show',
    });
  });

  it('resume(pub)는 회복 결과(in_progress)를 그대로 통과시킨다', async () => {
    vi.mocked(svc.resumeOrCreateResponse).mockResolvedValue({
      id: RESPONSE_ID,
      status: 'in_progress',
      resumed: true,
    } as never);
    const client = createRouterClient({ lifecycle }, { context: anonContext() });
    const res = await client.lifecycle.resume({
      surveyId: SURVEY_ID,
      sessionId: 'sess-1',
      inviteToken: INVITE_TOKEN,
    });
    expect(res).toEqual({ id: RESPONSE_ID, status: 'in_progress', resumed: true });
    expect(svc.resumeOrCreateResponse).toHaveBeenCalledWith({
      surveyId: SURVEY_ID,
      sessionId: 'sess-1',
      inviteToken: INVITE_TOKEN,
    });
  });

  it('resume(pub)는 매칭 행이 없으면 service 가 반환한 null 을 통과시킨다', async () => {
    vi.mocked(svc.resumeOrCreateResponse).mockResolvedValue(null as never);
    const client = createRouterClient({ lifecycle }, { context: anonContext() });
    const res = await client.lifecycle.resume({ surveyId: SURVEY_ID, sessionId: 'sess-2' });
    expect(res).toBeNull();
  });

  it('resume(pub)는 종결 상태(completed)도 통과시킨다', async () => {
    vi.mocked(svc.resumeOrCreateResponse).mockResolvedValue({
      id: RESPONSE_ID,
      status: 'completed',
      resumed: false,
    } as never);
    const client = createRouterClient({ lifecycle }, { context: anonContext() });
    const res = await client.lifecycle.resume({ surveyId: SURVEY_ID, sessionId: 'sess-3' });
    expect(res).toEqual({ id: RESPONSE_ID, status: 'completed', resumed: false });
  });
});
