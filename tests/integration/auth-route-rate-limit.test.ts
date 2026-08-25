/**
 * /api/auth 라우트의 rate limit 선적용 검증 (워크스페이스 역할 v2 티켓 01).
 *
 * 민감 경로(sign-in 등)는 신뢰 IP 기준 auth-sensitive 버킷을 선통과해야 Better Auth 에
 * 위임된다. 신뢰 IP 부재·비민감 경로·limiter 예외는 fail-open (oRPC isRateLimited 와
 * 동일 정책 — 정상 트래픽을 막지 않는다).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const handlerMock = vi.fn(async (_request: Request) => new Response('delegated', { status: 200 }));
vi.mock('@/lib/auth/server', () => ({
  auth: { handler: (request: Request) => handlerMock(request) },
}));

const limitMock = vi.fn();
vi.mock('@/lib/rate-limit/rate-limiter', () => ({
  getRateLimiter: () => ({ limit: limitMock }),
}));

import { POST } from '@/app/api/auth/[...all]/route';

function makeRequest(subpath: string, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest(`http://localhost/api/auth/${subpath}`, {
    method: 'POST',
    headers,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  limitMock.mockResolvedValue({ success: true, remaining: 9, resetMs: 0 });
});

describe('/api/auth POST rate limit', () => {
  it('민감 경로는 신뢰 IP 기준 auth-sensitive 버킷을 거쳐 위임된다', async () => {
    const res = await POST(makeRequest('sign-in/email', { 'x-real-ip': '1.2.3.4' }));

    expect(limitMock).toHaveBeenCalledWith('auth-sensitive:1.2.3.4');
    expect(handlerMock).toHaveBeenCalledTimes(1);
    expect(res.status).toBe(200);
  });

  it('한도 초과면 429 를 반환하고 Better Auth 에 위임하지 않는다', async () => {
    limitMock.mockResolvedValue({ success: false, remaining: 0, resetMs: 0 });

    const res = await POST(makeRequest('sign-in/email', { 'x-real-ip': '1.2.3.4' }));

    expect(res.status).toBe(429);
    expect(handlerMock).not.toHaveBeenCalled();
  });

  it('신뢰 IP 를 못 얻으면 limiter 를 건너뛰고 위임한다 (공유 버킷 오염 방지)', async () => {
    const res = await POST(makeRequest('sign-in/email'));

    expect(limitMock).not.toHaveBeenCalled();
    expect(handlerMock).toHaveBeenCalledTimes(1);
    expect(res.status).toBe(200);
  });

  it('비민감 경로는 limiter 를 거치지 않는다', async () => {
    const res = await POST(makeRequest('sign-out', { 'x-real-ip': '1.2.3.4' }));

    expect(limitMock).not.toHaveBeenCalled();
    expect(handlerMock).toHaveBeenCalledTimes(1);
    expect(res.status).toBe(200);
  });

  it('limiter 호출 실패는 fail-open 으로 위임한다', async () => {
    limitMock.mockRejectedValue(new Error('redis down'));

    const res = await POST(makeRequest('sign-in/email', { 'x-real-ip': '1.2.3.4' }));

    expect(handlerMock).toHaveBeenCalledTimes(1);
    expect(res.status).toBe(200);
  });
});
