import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// lifecycle service / rate limiter 모킹. route 핸들러 진입부 rate limit 과 fail-closed 검증.
const { recordMock, limitMock } = vi.hoisted(() => ({
  recordMock: vi.fn(),
  limitMock: vi.fn(),
}));

vi.mock('@/features/survey-response/server/services/lifecycle.service', () => ({
  recordVisibilitySegment: recordMock,
}));

vi.mock('@/lib/rate-limit/rate-limiter', () => ({
  getRateLimiter: () => ({ limit: limitMock }),
}));

import { POST } from '@/app/api/response/segment/route';

const RESPONSE_ID = '11111111-2222-4333-8444-555555555555';

function segmentRequest(headers: Record<string, string>): NextRequest {
  return new NextRequest('https://example.com/api/response/segment', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify({ responseId: RESPONSE_ID, action: 'hide' }),
  });
}

describe('POST /api/response/segment', () => {
  beforeEach(() => {
    recordMock.mockReset();
    limitMock.mockReset();
    recordMock.mockResolvedValue(undefined);
    limitMock.mockResolvedValue({ success: true, remaining: 59, resetMs: 0 });
  });

  afterEach(() => vi.clearAllMocks());

  it('신뢰 IP 로 response-segment 그룹 키를 만들어 rate limit 한다', async () => {
    const res = await POST(segmentRequest({ 'x-real-ip': '203.0.113.7' }));
    expect(limitMock).toHaveBeenCalledWith('response-segment:203.0.113.7');
    expect(res.status).toBe(200);
    expect(recordMock).toHaveBeenCalledWith({ responseId: RESPONSE_ID, action: 'hide' });
  });

  it('한도 초과 시 429 를 반환하고 service 를 호출하지 않는다', async () => {
    limitMock.mockResolvedValue({ success: false, remaining: 0, resetMs: 0 });
    const res = await POST(segmentRequest({ 'x-real-ip': '203.0.113.7' }));
    expect(res.status).toBe(429);
    expect(recordMock).not.toHaveBeenCalled();
  });

  it('신뢰 IP 추출 불가(헤더 부재)면 limiter 호출 전에 429 로 fail-closed 한다', async () => {
    const res = await POST(segmentRequest({}));
    expect(res.status).toBe(429);
    expect(limitMock).not.toHaveBeenCalled();
    expect(recordMock).not.toHaveBeenCalled();
  });

  it('위조 가능한 leftmost x-forwarded-for 보다 x-real-ip 를 신뢰 키로 쓴다', async () => {
    await POST(
      segmentRequest({
        'x-forwarded-for': '1.2.3.4, 203.0.113.7',
        'x-real-ip': '203.0.113.7',
      }),
    );
    expect(limitMock).toHaveBeenCalledWith('response-segment:203.0.113.7');
  });
});
