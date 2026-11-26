import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// lifecycle service / rate limiter 모킹. route 핸들러 진입부 rate limit 과 fail-closed 검증.
const { recordMock, guardMock, fineMock } = vi.hoisted(() => ({
  recordMock: vi.fn(),
  guardMock: vi.fn(),
  fineMock: vi.fn(),
}));

vi.mock('@/server/survey-response/services/lifecycle', () => ({
  recordVisibilitySegment: recordMock,
}));

vi.mock('@/lib/rate-limit/rate-limiter', () => ({
  isRateLimitedIpGuardTier: guardMock,
  isRateLimitedFineTier: fineMock,
}));

// 로거가 쓴 줄을 캡처한다 — access 로그에 무엇이 실리는지 검증하는 테스트용.
// 테스트 셋업이 LOG_LEVEL 을 silent 로 두므로 로거를 만들기 전에 수준을 올린다(hoisted).
const { logLines } = vi.hoisted(() => {
  vi.stubEnv('LOG_LEVEL', 'info');
  return { logLines: [] as string[] };
});

vi.mock('@/lib/logger/logger', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/lib/logger/logger')>();
  return {
    ...mod,
    logger: mod.createLogger({
      write(line: string) {
        logLines.push(line);
      },
    }),
  };
});

import { POST } from '@/app/api/response/segment/route';

const RESPONSE_ID = '11111111-2222-4333-8444-555555555555';

function segmentRequest(
  headers: Record<string, string>,
  responseId: string = RESPONSE_ID,
): NextRequest {
  return new NextRequest('https://example.com/api/response/segment', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify({ responseId, action: 'hide' }),
  });
}

describe('POST /api/response/segment', () => {
  beforeEach(() => {
    recordMock.mockReset();
    guardMock.mockReset();
    fineMock.mockReset();
    recordMock.mockResolvedValue(undefined);
    guardMock.mockResolvedValue(false);
    fineMock.mockResolvedValue(false);
  });

  afterEach(() => vi.clearAllMocks());

  it('UUID 모양이 아닌 responseId 는 access 로그에 적지 않는다 — 무인증 경로라 아무 문자열이나 온다', async () => {
    logLines.length = 0;
    await POST(segmentRequest({ 'x-real-ip': '203.0.113.7' }, 'person@example.com'));
    await POST(segmentRequest({ 'x-real-ip': '203.0.113.7' }));

    expect(logLines).toHaveLength(2);
    expect(logLines.join('')).not.toContain('person@example.com');
    const last = JSON.parse(logLines[1] as string) as Record<string, unknown>;
    expect(last['responseId']).toBe(RESPONSE_ID);
  });

  it('파싱 전 IP 가드 → 검증 후 responseId fine 버킷의 2단계로 판정한다', async () => {
    const res = await POST(segmentRequest({ 'x-real-ip': '203.0.113.7' }));
    expect(guardMock).toHaveBeenCalledWith('response-segment', '203.0.113.7');
    expect(fineMock).toHaveBeenCalledWith('response-segment', '203.0.113.7', RESPONSE_ID);
    expect(res.status).toBe(200);
    expect(recordMock).toHaveBeenCalledWith({ responseId: RESPONSE_ID, action: 'hide' });
  });

  it('IP 가드 초과 시 본문 검증 없이 429 를 반환한다', async () => {
    guardMock.mockResolvedValue(true);
    const res = await POST(segmentRequest({ 'x-real-ip': '203.0.113.7' }));
    expect(res.status).toBe(429);
    expect(fineMock).not.toHaveBeenCalled();
    expect(recordMock).not.toHaveBeenCalled();
  });

  it('fine 버킷 초과 시 429 를 반환하고 service 를 호출하지 않는다', async () => {
    fineMock.mockResolvedValue(true);
    const res = await POST(segmentRequest({ 'x-real-ip': '203.0.113.7' }));
    expect(res.status).toBe(429);
    expect(recordMock).not.toHaveBeenCalled();
  });

  it('신뢰 IP 추출 불가(헤더 부재)면 limiter 호출 전에 429 로 fail-closed 한다', async () => {
    const res = await POST(segmentRequest({}));
    expect(res.status).toBe(429);
    expect(guardMock).not.toHaveBeenCalled();
    expect(fineMock).not.toHaveBeenCalled();
    expect(recordMock).not.toHaveBeenCalled();
  });

  it('위조 가능한 leftmost x-forwarded-for 보다 x-real-ip 를 신뢰 키로 쓴다', async () => {
    await POST(
      segmentRequest({
        'x-forwarded-for': '1.2.3.4, 203.0.113.7',
        'x-real-ip': '203.0.113.7',
      }),
    );
    expect(guardMock).toHaveBeenCalledWith('response-segment', '203.0.113.7');
    expect(fineMock).toHaveBeenCalledWith('response-segment', '203.0.113.7', RESPONSE_ID);
  });
});
