import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// service / rate limiter 모킹. 라우트 진입부 가드와 에러 정책만 검증한다.
const { saveMock, limitMock } = vi.hoisted(() => ({
  saveMock: vi.fn(),
  limitMock: vi.fn(),
}));

vi.mock('@/features/survey-response/server/services/response.service', () => ({
  saveDraftResponseIfActive: saveMock,
}));

vi.mock('@/lib/rate-limit/rate-limiter', () => ({
  getRateLimiter: () => ({ limit: limitMock }),
}));

import { POST } from '@/app/api/response/draft/route';

const RESPONSE_ID = '11111111-2222-4333-8444-555555555555';

function draftRequest(
  headers: Record<string, string>,
  body: unknown = { responseId: RESPONSE_ID, answers: { q1: 'a' } },
): NextRequest {
  return new NextRequest('https://example.com/api/response/draft', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

const IP = { 'x-real-ip': '203.0.113.7' };

describe('POST /api/response/draft', () => {
  beforeEach(() => {
    saveMock.mockReset();
    limitMock.mockReset();
    saveMock.mockResolvedValue({ saved: true });
    limitMock.mockResolvedValue({ success: true, remaining: 59, resetMs: 0 });
    vi.spyOn(console, 'info').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => vi.restoreAllMocks());

  it('신뢰 IP 로 response-draft 그룹 키를 만들어 rate limit 한다', async () => {
    const res = await POST(draftRequest(IP));
    expect(limitMock).toHaveBeenCalledWith('response-draft:203.0.113.7');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(saveMock).toHaveBeenCalledWith({
      responseId: RESPONSE_ID,
      answers: { q1: 'a' },
    });
  });

  it('한도 초과 시 429 를 반환하고 service 를 호출하지 않는다', async () => {
    limitMock.mockResolvedValue({ success: false, remaining: 0, resetMs: 0 });
    const res = await POST(draftRequest(IP));
    expect(res.status).toBe(429);
    expect(saveMock).not.toHaveBeenCalled();
  });

  it('신뢰 IP 추출 불가면 limiter 호출 전에 429 로 fail-closed 한다', async () => {
    const res = await POST(draftRequest({}));
    expect(res.status).toBe(429);
    expect(limitMock).not.toHaveBeenCalled();
    expect(saveMock).not.toHaveBeenCalled();
  });

  it('json 파싱 실패면 400 을 반환한다', async () => {
    const res = await POST(draftRequest(IP, 'not-json'));
    expect(res.status).toBe(400);
    expect(saveMock).not.toHaveBeenCalled();
  });

  it('responseId 가 공백이면 400 을 반환한다', async () => {
    const res = await POST(draftRequest(IP, { responseId: '   ', answers: {} }));
    expect(res.status).toBe(400);
    expect(saveMock).not.toHaveBeenCalled();
  });

  it('answers 키가 200 개를 넘으면 400 을 반환한다', async () => {
    const answers = Object.fromEntries(
      Array.from({ length: 201 }, (_, i) => [`q${i}`, 'a']),
    );
    const res = await POST(draftRequest(IP, { responseId: RESPONSE_ID, answers }));
    expect(res.status).toBe(400);
    expect(saveMock).not.toHaveBeenCalled();
  });

  it('키가 정확히 200 개면 통과시킨다', async () => {
    const answers = Object.fromEntries(
      Array.from({ length: 200 }, (_, i) => [`q${i}`, 'a']),
    );
    const res = await POST(draftRequest(IP, { responseId: RESPONSE_ID, answers }));
    expect(res.status).toBe(200);
    expect(saveMock).toHaveBeenCalledTimes(1);
  });

  it('service 가 skipped 를 반환하면 200 + skipped 로 조용히 흡수한다', async () => {
    saveMock.mockResolvedValue({ saved: false, skipped: 'concluded' });
    const res = await POST(draftRequest(IP));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, skipped: 'concluded' });
  });

  it('예기치 않은 throw 는 500 으로 올린다', async () => {
    saveMock.mockRejectedValue(new Error('boom'));
    const res = await POST(draftRequest(IP));
    expect(res.status).toBe(500);
  });
});
