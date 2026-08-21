import { createRouterClient } from '@orpc/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ORPCContext } from '@/server/context';

vi.mock('../services/survey-read.service', () => ({
  getSurveyBySlug: vi.fn(),
  getSurveyByPrivateToken: vi.fn(),
  getSurveyForResponse: vi.fn(),
}));

// rate limit limiter 모킹. 기본은 통과(success=true), 한도 초과 테스트에서만 false 로 바꾼다.
// withRateLimit 은 isRateLimitedTwoTier 를 호출하는데 실제 구현은 모듈 내부의 getRateLimiter
// 참조를 쓰므로 위 override 가 닿지 않는다(env 부재 → noop fail-open). group:ip 단순 키의
// limitMock 위임으로 교체한다 — 이 파일의 관심사는 "어느 procedure 에 어느 그룹이 붙었고
// 한도 초과가 거부로 전파되는가"뿐이고, 2단 키 조합 자체는 rate-limiter.test.ts 담당이다.
const { limitMock } = vi.hoisted(() => ({ limitMock: vi.fn() }));
vi.mock('@/lib/rate-limit/rate-limiter', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/rate-limit/rate-limiter')>();
  return {
    ...actual,
    getRateLimiter: () => ({ limit: limitMock }),
    isRateLimitedTwoTier: async (group: string, ip: string, _clientId: string | null) => {
      const { success } = await limitMock(`${group}:${ip}`);
      return !success;
    },
  };
});

import * as surveySvc from '../services/survey-read.service';
import { publicRead } from './public-read';

const SURVEY_ID = '11111111-2222-4333-8444-555555555555';
const VERSION_ID = '33333333-4444-4555-8666-777777777777';

// 응답자 공개 경로 — 익명 컨텍스트(user: null)에서도 통과해야 한다.
// rate limit 미들웨어가 신뢰 IP 를 추출하도록 정상 요청 헤더를 제공한다
// (헤더가 없으면 fail-closed 로 TOO_MANY_REQUESTS 가 된다).
function anonContext(): ORPCContext {
  return {
    db: {} as never,
    supabase: {} as never,
    user: null,
    headers: new Headers({ 'x-real-ip': '203.0.113.7' }),
  };
}

describe('surveyBuilder.publicRead procedures', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // 기본: 한도 내 통과.
    limitMock.mockResolvedValue({ success: true, remaining: 299, resetMs: 0 });
  });

  it('bySlug(pub)는 익명 컨텍스트에서 slug 객체를 그대로 위임한다', async () => {
    vi.mocked(surveySvc.getSurveyBySlug).mockResolvedValue({ id: SURVEY_ID } as never);
    const client = createRouterClient({ publicRead }, { context: anonContext() });
    const res = await client.publicRead.bySlug({ slug: 'my-slug' });
    expect(surveySvc.getSurveyBySlug).toHaveBeenCalledWith({ slug: 'my-slug' });
    expect((res as { id: string }).id).toBe(SURVEY_ID);
  });

  it('byPrivateToken(pub)는 token 객체를 그대로 위임한다', async () => {
    vi.mocked(surveySvc.getSurveyByPrivateToken).mockResolvedValue(undefined as never);
    const client = createRouterClient({ publicRead }, { context: anonContext() });
    const res = await client.publicRead.byPrivateToken({ token: 'tok-1' });
    expect(surveySvc.getSurveyByPrivateToken).toHaveBeenCalledWith({ token: 'tok-1' });
    // findFirst 미스 시 undefined → 직렬화 후에도 falsy 동작 보존
    expect(res ?? null).toBeNull();
  });

  it('forResponse(pub)는 surveyId 객체를 그대로 위임하고 결과를 반환한다', async () => {
    vi.mocked(surveySvc.getSurveyForResponse).mockResolvedValue({
      survey: { id: SURVEY_ID },
      versionId: VERSION_ID,
    } as never);
    const client = createRouterClient({ publicRead }, { context: anonContext() });
    const res = await client.publicRead.forResponse({ surveyId: SURVEY_ID });
    expect(surveySvc.getSurveyForResponse).toHaveBeenCalledWith({ surveyId: SURVEY_ID });
    expect((res as { versionId: string }).versionId).toBe(VERSION_ID);
  });

  it('forResponse(pub)는 null 도 통과시킨다', async () => {
    vi.mocked(surveySvc.getSurveyForResponse).mockResolvedValue(null as never);
    const client = createRouterClient({ publicRead }, { context: anonContext() });
    const res = await client.publicRead.forResponse({ surveyId: SURVEY_ID });
    expect(res).toBeNull();
  });

  it('forResponse(pub)는 testToken 을 그대로 위임하고 control 을 반환한다', async () => {
    vi.mocked(surveySvc.getSurveyForResponse).mockResolvedValue({
      survey: { id: SURVEY_ID },
      versionId: VERSION_ID,
      control: { isPaused: false, pausedMessage: null, testSession: 'valid' },
    } as never);
    const client = createRouterClient({ publicRead }, { context: anonContext() });
    const res = await client.publicRead.forResponse({
      surveyId: SURVEY_ID,
      testToken: 'tok-1',
    });
    expect(surveySvc.getSurveyForResponse).toHaveBeenCalledWith({
      surveyId: SURVEY_ID,
      testToken: 'tok-1',
    });
    expect((res as { control: { testSession: string } }).control.testSession).toBe('valid');
  });

  // --- 회귀: 무인증 공개 조회 rate limit (P0-2) ---

  it('forResponse(pub)는 public-read 그룹 키로 rate limit 한다', async () => {
    vi.mocked(surveySvc.getSurveyForResponse).mockResolvedValue(null as never);
    const client = createRouterClient({ publicRead }, { context: anonContext() });
    await client.publicRead.forResponse({ surveyId: SURVEY_ID });
    expect(limitMock).toHaveBeenCalledWith('public-read:203.0.113.7');
  });

  it('bySlug/byPrivateToken/forResponse 는 한도 초과 시 service 를 호출하지 않고 거부한다', async () => {
    limitMock.mockResolvedValue({ success: false, remaining: 0, resetMs: 0 });
    const client = createRouterClient({ publicRead }, { context: anonContext() });

    await expect(client.publicRead.bySlug({ slug: 'my-slug' })).rejects.toThrow();
    await expect(client.publicRead.byPrivateToken({ token: 'tok-1' })).rejects.toThrow();
    await expect(client.publicRead.forResponse({ surveyId: SURVEY_ID })).rejects.toThrow();

    expect(surveySvc.getSurveyBySlug).not.toHaveBeenCalled();
    expect(surveySvc.getSurveyByPrivateToken).not.toHaveBeenCalled();
    expect(surveySvc.getSurveyForResponse).not.toHaveBeenCalled();
  });
});
