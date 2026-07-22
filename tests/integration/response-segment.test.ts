import { NextRequest } from 'next/server';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { extractRawSql } from './_helpers/result-code-mock';

const { setMock, whereMock } = vi.hoisted(() => ({
  setMock: vi.fn(),
  whereMock: vi.fn(),
}));

vi.mock('@/db', () => {
  const chainable: Record<string, unknown> = {};
  chainable['update'] = vi.fn(() => chainable);
  chainable['set'] = vi.fn((arg: unknown) => {
    setMock(arg);
    return chainable;
  });
  chainable['where'] = vi.fn((arg: unknown) => {
    whereMock(arg);
    return chainable; // await 시 chainable 자신으로 resolve (no-op)
  });
  const selectResult: Record<string, unknown> = {
    for: vi.fn(() => selectResult),
    limit: vi.fn(async () => [{ id: 'r1', surveyId: 's1', isTest: false, contactTargetId: null }]),
  };
  const selectChain: Record<string, unknown> = {
    from: vi.fn(() => selectChain),
    where: vi.fn(() => selectResult),
  };
  const tx = {
    select: vi.fn(() => selectChain),
    update: chainable['update'],
  };
  return {
    db: {
      ...chainable,
      transaction: vi.fn(async (cb: (value: typeof tx) => Promise<unknown>) => cb(tx)),
    },
  };
});

describe('recordVisibilitySegment — SQL 분기', () => {
  beforeEach(() => {
    setMock.mockReset();
    whereMock.mockReset();
  });

  it('hide: pageVisits set에 jsonb_set + leftAt 백필, lastActivityAt 미갱신', async () => {
    const { recordVisibilitySegment } =
      await import('@/features/survey-response/server/services/lifecycle.service');
    await recordVisibilitySegment({ responseId: 'r1', action: 'hide' });

    const hideSetCall = setMock.mock.calls[0];
    if (!hideSetCall) throw new Error('setMock 호출 없음');
    const setArg = hideSetCall[0] as Record<string, unknown>;
    const pvSql = extractRawSql(setArg['pageVisits']);
    expect(pvSql).toContain('jsonb_set');
    expect(pvSql).toContain("'leftAt'");
    expect('lastActivityAt' in setArg).toBe(false); // hide는 떠남 → 미갱신
  });

  it('show: pageVisits set에 append(||), lastActivityAt 갱신', async () => {
    const { recordVisibilitySegment } =
      await import('@/features/survey-response/server/services/lifecycle.service');
    await recordVisibilitySegment({ responseId: 'r1', action: 'show' });

    const showSetCall = setMock.mock.calls[0];
    if (!showSetCall) throw new Error('setMock 호출 없음');
    const setArg = showSetCall[0] as Record<string, unknown>;
    const pvSql = extractRawSql(setArg['pageVisits']);
    expect(pvSql).toContain('jsonb_build_array');
    expect(pvSql).toContain('||');
    expect('lastActivityAt' in setArg).toBe(true); // show는 복귀 → 갱신
  });

  it('hide: where 가드에 status in_progress + leftAt NULL 조건이 포함된다', async () => {
    const { recordVisibilitySegment } =
      await import('@/features/survey-response/server/services/lifecycle.service');
    await recordVisibilitySegment({ responseId: 'r1', action: 'hide' });
    expect(whereMock).toHaveBeenCalledTimes(1); // 단일 UPDATE + WHERE 가드
    const hideWhereCall = whereMock.mock.calls[0];
    if (!hideWhereCall) throw new Error('whereMock 호출 없음');
    const whereSql = extractRawSql(hideWhereCall[0]);
    expect(whereSql).toContain('leftAt');
  });

  it('show: where 가드에 멱등 조건(leftAt IS NOT NULL)이 포함된다', async () => {
    const { recordVisibilitySegment } =
      await import('@/features/survey-response/server/services/lifecycle.service');
    await recordVisibilitySegment({ responseId: 'r1', action: 'show' });
    expect(whereMock).toHaveBeenCalledTimes(1);
    const showWhereCall = whereMock.mock.calls[0];
    if (!showWhereCall) throw new Error('whereMock 호출 없음');
    const whereSql = extractRawSql(showWhereCall[0]);
    expect(whereSql).toContain('leftAt');
    expect(whereSql).toContain('IS NOT NULL');
  });
});

describe('POST /api/response/segment — attempt payload', () => {
  it('유효한 attemptId와 sessionId를 받는다', async () => {
    const { POST } = await import('@/app/api/response/segment/route');
    const request = new NextRequest('http://localhost/api/response/segment', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-real-ip': '203.0.113.9',
      },
      body: JSON.stringify({
        responseId: 'r1',
        action: 'hide',
        attemptId: '77777777-8888-4999-8aaa-bbbbbbbbbbbb',
        sessionId: 'target-test-session',
      }),
    });

    const response = await POST(request);
    expect(response.status).toBe(200);
  });

  it('UUID 형식이 아닌 attemptId는 저장 전에 거부한다', async () => {
    const { POST } = await import('@/app/api/response/segment/route');
    const request = new NextRequest('http://localhost/api/response/segment', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-real-ip': '203.0.113.9',
      },
      body: JSON.stringify({
        responseId: 'r1',
        action: 'hide',
        attemptId: 'not-a-uuid',
        sessionId: 'target-test-session',
      }),
    });

    const response = await POST(request);
    expect(response.status).toBe(400);
  });
});
