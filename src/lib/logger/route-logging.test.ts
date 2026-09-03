import { NextRequest, NextResponse } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { lines, captureExceptionMock } = vi.hoisted(() => ({
  lines: [] as string[],
  captureExceptionMock: vi.fn(),
}));

// 싱글턴 logger 를 캡처 스트림으로 교체 — 나머지 export 는 원본 유지 (spread 보강 관례).
vi.mock('@/lib/logger/logger', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/lib/logger/logger')>();
  return {
    ...mod,
    logger: mod.createLogger({
      write(line: string) {
        lines.push(line);
      },
    }),
  };
});

vi.mock('@sentry/nextjs', () => ({ captureException: captureExceptionMock }));

import { withRouteLogging } from '@/lib/logger/route-logging';

function request(headers: Record<string, string> = {}): NextRequest {
  return new NextRequest('https://example.com/api/test', {
    method: 'POST',
    headers,
  });
}

function lastLog(): Record<string, unknown> {
  const last = lines[lines.length - 1];
  expect(last).toBeDefined();
  return JSON.parse(last as string) as Record<string, unknown>;
}

describe('withRouteLogging', () => {
  beforeEach(() => {
    lines.length = 0;
    captureExceptionMock.mockReset();
  });

  it('정상 응답이면 method·route·status·durationMs·ip 가 붙은 info access 로그를 남긴다', async () => {
    const wrapped = withRouteLogging('/api/test', async () =>
      NextResponse.json({ ok: true }),
    );
    const res = await wrapped(request({ 'x-real-ip': '203.0.113.7' }));

    expect(res.status).toBe(200);
    const log = lastLog();
    expect(log['level']).toBe(30);
    expect(log['method']).toBe('POST');
    expect(log['route']).toBe('/api/test');
    expect(log['status']).toBe(200);
    expect(log['ip']).toBe('203.0.113.7');
    expect(typeof log['durationMs']).toBe('number');
  });

  it('bind 로 주입한 필드가 access 로그에 합쳐진다', async () => {
    const wrapped = withRouteLogging('/api/test', async (_req, ctx) => {
      ctx.bind({ userId: 'user-1', role: 'admin', surveyId: 'sv-1' });
      return NextResponse.json({ ok: true });
    });
    await wrapped(request());

    const log = lastLog();
    expect(log['userId']).toBe('user-1');
    expect(log['role']).toBe('admin');
    expect(log['surveyId']).toBe('sv-1');
  });

  it('ctx.log 는 현재까지 바인딩된 컨텍스트를 포함한 child logger 다', async () => {
    const wrapped = withRouteLogging('/api/test', async (_req, ctx) => {
      ctx.bind({ responseId: 'resp-1' });
      ctx.log.info({ skipped: 'concluded' }, '내부 로그');
      return NextResponse.json({ ok: true });
    });
    await wrapped(request());

    const inner = JSON.parse(lines[0] as string) as Record<string, unknown>;
    expect(inner['route']).toBe('/api/test');
    expect(inner['responseId']).toBe('resp-1');
    expect(inner['skipped']).toBe('concluded');
  });

  it('핸들러가 5xx 응답을 반환하면 error 레벨로 남긴다', async () => {
    const wrapped = withRouteLogging('/api/test', async () =>
      NextResponse.json({ error: 'x' }, { status: 500 }),
    );
    await wrapped(request());

    const log = lastLog();
    expect(log['level']).toBe(50);
    expect(log['status']).toBe(500);
  });

  it('핸들러 throw 시 err 로그 + Sentry 캡처 + errorMessage 500 응답으로 처리한다', async () => {
    const boom = new Error('boom');
    const wrapped = withRouteLogging(
      '/api/test',
      async () => {
        throw boom;
      },
      { errorMessage: 'internal' },
    );
    const res = await wrapped(request());

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'internal' });
    expect(captureExceptionMock).toHaveBeenCalledWith(boom);
    const log = lastLog();
    expect(log['level']).toBe(50);
    expect(log['status']).toBe(500);
    expect((log['err'] as Record<string, unknown>)['message']).toBe('boom');
  });

  it('source 옵션은 비인증 라우트의 주체 표기로 로그에 붙는다', async () => {
    const wrapped = withRouteLogging(
      '/api/webhooks/test',
      async () => NextResponse.json({ ok: true }),
      { source: 'resend-webhook' },
    );
    await wrapped(request());

    expect(lastLog()['source']).toBe('resend-webhook');
  });

  it('redact 안전망: bind 에 실린 PII 컨테이너 키는 검열된다', async () => {
    const wrapped = withRouteLogging('/api/test', async (_req, ctx) => {
      ctx.bind({ answers: { q1: '주민번호' } });
      return NextResponse.json({ ok: true });
    });
    await wrapped(request());

    expect(lastLog()['answers']).toBe('[Redacted]');
  });
});
