import { createRouterClient } from '@orpc/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ORPCContext } from '@/server/context';

vi.mock('../services/lifecycle.service', () => ({
  recordStepVisit: vi.fn(),
  recordVisibilitySegment: vi.fn(),
  resumeOrCreateResponse: vi.fn(),
}));

// rate limit limiter 모킹. 기본은 통과(success=true), 한도 초과 테스트에서만 false 로 바꾼다.
const { limitMock } = vi.hoisted(() => ({ limitMock: vi.fn() }));
vi.mock('@/lib/rate-limit/rate-limiter', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/rate-limit/rate-limiter')>();
  return {
    ...actual,
    getRateLimiter: () => ({ limit: limitMock }),
  };
});

import * as svc from '../services/lifecycle.service';
import { lifecycle } from './lifecycle';

// 신뢰 IP 가 추출되는 정상 요청 헤더. rate limit 미들웨어가 이 헤더로 키를 만든다.
const TRUSTED_HEADERS = new Headers({ 'x-real-ip': '203.0.113.7' });

function anonContext(headers: Headers = TRUSTED_HEADERS): ORPCContext {
  return {
    db: {} as never,
    supabase: { tag: 'anon-supabase' } as never,
    user: null,
    headers,
  };
}

// zod v4 .uuid() 와 무관하게 도메인 input 은 z.string 이지만, 픽스처는 v4 형태로 통일한다.
const RESPONSE_ID = '11111111-2222-4333-8444-555555555555';
const SURVEY_ID = '22222222-3333-4444-8555-666666666666';
const INVITE_TOKEN = '66666666-7777-4888-8999-aaaaaaaaaaaa';

describe('surveyResponse.lifecycle procedures', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // 기본: 한도 내 통과.
    limitMock.mockResolvedValue({ success: true, remaining: 59, resetMs: 0 });
  });

  afterEach(() => vi.clearAllMocks());

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

  // --- 회귀: RPC 경로 rate limit 우회 차단 (적대 리뷰 high) ---

  it('visibilitySegment(pub)는 response-segment 그룹 키로 rate limit 한다', async () => {
    vi.mocked(svc.recordVisibilitySegment).mockResolvedValue(undefined as never);
    const client = createRouterClient({ lifecycle }, { context: anonContext() });
    await client.lifecycle.visibilitySegment({ responseId: RESPONSE_ID, action: 'hide' });
    expect(limitMock).toHaveBeenCalledWith('response-segment:203.0.113.7');
  });

  it('visibilitySegment(pub)는 한도 초과 시 service 를 호출하지 않고 거부한다', async () => {
    limitMock.mockResolvedValue({ success: false, remaining: 0, resetMs: 0 });
    const client = createRouterClient({ lifecycle }, { context: anonContext() });
    await expect(
      client.lifecycle.visibilitySegment({ responseId: RESPONSE_ID, action: 'hide' }),
    ).rejects.toThrow();
    expect(svc.recordVisibilitySegment).not.toHaveBeenCalled();
  });

  it('stepVisit(pub)도 response-segment 그룹으로 한도 초과 시 거부한다', async () => {
    limitMock.mockResolvedValue({ success: false, remaining: 0, resetMs: 0 });
    const client = createRouterClient({ lifecycle }, { context: anonContext() });
    await expect(
      client.lifecycle.stepVisit({ responseId: RESPONSE_ID, nextStepId: 'group:abc' }),
    ).rejects.toThrow();
    expect(svc.recordStepVisit).not.toHaveBeenCalled();
  });

  it('resume(pub)은 lookup 그룹 키로 rate limit 한다', async () => {
    vi.mocked(svc.resumeOrCreateResponse).mockResolvedValue(null as never);
    const client = createRouterClient({ lifecycle }, { context: anonContext() });
    await client.lifecycle.resume({ surveyId: SURVEY_ID, sessionId: 'sess-4' });
    expect(limitMock).toHaveBeenCalledWith('lookup:203.0.113.7');
  });

  it('신뢰 IP 추출 불가(헤더 부재)면 fail-closed 로 거부하고 service 를 호출하지 않는다', async () => {
    const client = createRouterClient(
      { lifecycle },
      { context: anonContext(new Headers()) },
    );
    await expect(
      client.lifecycle.visibilitySegment({ responseId: RESPONSE_ID, action: 'hide' }),
    ).rejects.toThrow();
    expect(svc.recordVisibilitySegment).not.toHaveBeenCalled();
    // 식별 불가면 limiter 호출 전에 차단되므로 limit 도 호출되지 않는다.
    expect(limitMock).not.toHaveBeenCalled();
  });
});
