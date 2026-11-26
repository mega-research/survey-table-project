import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// service / rate limiter 모킹. 라우트 진입부 가드와 에러 정책만 검증한다.
const { saveMock, guardMock, fineMock } = vi.hoisted(() => ({
  saveMock: vi.fn(),
  guardMock: vi.fn(),
  fineMock: vi.fn(),
}));

vi.mock('@/server/survey-response/services/response-draft', () => ({
  saveDraftResponseIfActive: saveMock,
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
    guardMock.mockReset();
    fineMock.mockReset();
    saveMock.mockResolvedValue({ saved: true });
    guardMock.mockResolvedValue(false);
    fineMock.mockResolvedValue(false);
    vi.spyOn(console, 'info').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => vi.restoreAllMocks());

  it('파싱 전 IP 가드 → 검증 후 responseId fine 버킷의 2단계로 판정한다', async () => {
    const res = await POST(draftRequest(IP));
    expect(guardMock).toHaveBeenCalledWith('response-draft', '203.0.113.7');
    expect(fineMock).toHaveBeenCalledWith('response-draft', '203.0.113.7', RESPONSE_ID);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(saveMock).toHaveBeenCalledWith({
      responseId: RESPONSE_ID,
      answers: { q1: 'a' },
    });
  });

  it('IP 가드 초과 시 본문 검증 없이 429 를 반환한다', async () => {
    guardMock.mockResolvedValue(true);
    const res = await POST(draftRequest(IP));
    expect(res.status).toBe(429);
    expect(fineMock).not.toHaveBeenCalled();
    expect(saveMock).not.toHaveBeenCalled();
  });

  it('fine 버킷 초과 시 429 를 반환하고 service 를 호출하지 않는다', async () => {
    fineMock.mockResolvedValue(true);
    const res = await POST(draftRequest(IP));
    expect(res.status).toBe(429);
    expect(saveMock).not.toHaveBeenCalled();
  });

  it('신뢰 IP 추출 불가면 limiter 호출 전에 429 로 fail-closed 한다', async () => {
    const res = await POST(draftRequest({}));
    expect(res.status).toBe(429);
    expect(guardMock).not.toHaveBeenCalled();
    expect(fineMock).not.toHaveBeenCalled();
    expect(saveMock).not.toHaveBeenCalled();
  });

  it('json 파싱 실패도 IP 가드 예산은 소비하고 400 을 반환한다', async () => {
    const res = await POST(draftRequest(IP, 'not-json'));
    expect(res.status).toBe(400);
    expect(guardMock).toHaveBeenCalledTimes(1);
    expect(fineMock).not.toHaveBeenCalled();
    expect(saveMock).not.toHaveBeenCalled();
  });

  it('access 로그에 responseId·건수·요청 크기를 남긴다 — 답은 싣지 않는다', async () => {
    logLines.length = 0;
    const body = JSON.stringify({ responseId: RESPONSE_ID, answers: { q1: '홍길동' } });
    await POST(draftRequest({ ...IP, 'content-length': String(Buffer.byteLength(body)) }, body));

    const line = JSON.parse(logLines[logLines.length - 1] as string) as Record<string, unknown>;
    expect(line).toMatchObject({
      route: '/api/response/draft',
      responseId: RESPONSE_ID,
      answerCount: 1,
      reqBytes: Buffer.byteLength(body),
    });
    expect(logLines.join('')).not.toContain('홍길동');
  });

  it('UUID 모양이 아닌 responseId 는 access 로그에 적지 않는다 — 무인증 경로라 아무 문자열이나 온다', async () => {
    logLines.length = 0;
    await POST(draftRequest(IP, { responseId: 'person@example.com', answers: { q1: 'a' } }));

    expect(logLines.length).toBeGreaterThan(0);
    expect(logLines.join('')).not.toContain('person@example.com');
  });

  it('responseId 가 128자를 넘으면 400 으로 거부한다', async () => {
    const res = await POST(draftRequest(IP, { responseId: 'x'.repeat(129), answers: {} }));
    expect(res.status).toBe(400);
    expect(fineMock).not.toHaveBeenCalled();
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
