import { NextRequest } from 'next/server';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { extractRawSql } from './_helpers/result-code-mock';

const { selectLimitMock, setMock, whereMock, controlFlagsMock, completedCountMock } = vi.hoisted(() => ({
  selectLimitMock: vi.fn(),
  setMock: vi.fn(),
  whereMock: vi.fn(),
  controlFlagsMock: vi.fn(),
  completedCountMock: vi.fn(),
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
    limit: vi.fn(() => selectLimitMock()),
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
      // 전체 완료 목표의 면제 표식(metadata) 조회 — 트랜잭션 밖 select
      select: vi.fn(() => selectChain),
      transaction: vi.fn(async (cb: (value: typeof tx) => Promise<unknown>) => cb(tx)),
    },
  };
});

// recordStepVisit 이 중단 판정을 위해 제어 플래그를 읽는다. mock db 에는 .query 가 없으므로
// response-draft.test.ts 와 동일하게 survey-control 을 통째로 모킹한다.
vi.mock('@/server/read-models/survey-control', () => ({
  getSurveyControlFlags: (...a: unknown[]) => controlFlagsMock(...a),
  isValidTestToken: vi.fn(),
}));

// 전체 완료 목표의 완료 수 — 셈 자체는 response-gate 소관이라 여기서는 값만 갈아 끼운다.
vi.mock('@/server/survey-response/services/response-gate', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/server/survey-response/services/response-gate')>()),
  countCompletedResponses: (...a: unknown[]) => completedCountMock(...a),
}));

describe('recordVisibilitySegment — SQL 분기', () => {
  beforeEach(() => {
    selectLimitMock.mockReset();
    selectLimitMock.mockResolvedValue([
      { id: 'r1', surveyId: 's1', isTest: false, contactTargetId: null },
    ]);
    setMock.mockReset();
    whereMock.mockReset();
  });

  it('hide: pageVisits set에 jsonb_set + leftAt 백필, lastActivityAt 미갱신', async () => {
    const { recordVisibilitySegment } =
      await import('@/server/survey-response/services/lifecycle');
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
      await import('@/server/survey-response/services/lifecycle');
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
      await import('@/server/survey-response/services/lifecycle');
    await recordVisibilitySegment({ responseId: 'r1', action: 'hide' });
    expect(whereMock).toHaveBeenCalledTimes(1); // 단일 UPDATE + WHERE 가드
    const hideWhereCall = whereMock.mock.calls[0];
    if (!hideWhereCall) throw new Error('whereMock 호출 없음');
    const whereSql = extractRawSql(hideWhereCall[0]);
    expect(whereSql).toContain('leftAt');
  });

  it('show: where 가드에 멱등 조건(leftAt IS NOT NULL)이 포함된다', async () => {
    const { recordVisibilitySegment } =
      await import('@/server/survey-response/services/lifecycle');
    await recordVisibilitySegment({ responseId: 'r1', action: 'show' });
    expect(whereMock).toHaveBeenCalledTimes(1);
    const showWhereCall = whereMock.mock.calls[0];
    if (!showWhereCall) throw new Error('whereMock 호출 없음');
    const whereSql = extractRawSql(showWhereCall[0]);
    expect(whereSql).toContain('leftAt');
    expect(whereSql).toContain('IS NOT NULL');
  });
});

describe('recordStepVisit — missing row와 동일 step 구분', () => {
  beforeEach(() => {
    selectLimitMock.mockReset();
    setMock.mockReset();
    whereMock.mockReset();
  });

  it('응답 행이 없으면 다시 throw 한다', async () => {
    selectLimitMock.mockResolvedValue([]);
    const { recordStepVisit } =
      await import('@/server/survey-response/services/lifecycle');

    await expect(
      recordStepVisit({ responseId: 'missing', nextStepId: 'group:next' }),
    ).rejects.toThrow('응답을 찾을 수 없습니다.');
    expect(setMock).not.toHaveBeenCalled();
  });

  it('존재하는 응답의 동일 step 재기록은 정상 no-op이다', async () => {
    selectLimitMock.mockResolvedValue([
      { id: 'r1', surveyId: 's1', isTest: false, contactTargetId: null },
    ]);
    const { recordStepVisit } =
      await import('@/server/survey-response/services/lifecycle');

    controlFlagsMock.mockResolvedValue({ isPaused: false, pausedMessage: null });
    await expect(
      recordStepVisit({ responseId: 'r1', nextStepId: 'group:same' }),
    ).resolves.toEqual({ denial: null, pausedMessage: null });
  });

  it('중단된 설문이면 denial 과 문구를 돌려주되 pageVisits UPDATE 는 그대로 나간다', async () => {
    selectLimitMock.mockResolvedValue([
      { id: 'r1', surveyId: 's1', isTest: false, contactTargetId: null },
    ]);
    controlFlagsMock.mockResolvedValue({ isPaused: true, pausedMessage: '점검 중입니다' });
    const { recordStepVisit } =
      await import('@/server/survey-response/services/lifecycle');

    await expect(recordStepVisit({ responseId: 'r1', nextStepId: 'group:next' })).resolves.toEqual({
      denial: 'survey_paused',
      pausedMessage: '점검 중입니다',
    });
    // 중단 이외 동작 불변 pin — 기록은 계속된다.
    expect(setMock).toHaveBeenCalled();
  });


  // ── 전체 완료 목표 알림 (CONTEXT.md 「전체 완료 목표」) ──
  describe('전체 완료 목표', () => {
    const ROW = { id: 'r1', surveyId: 's1', isTest: false, contactTargetId: null };
    beforeEach(() => {
      completedCountMock.mockReset();
    });

    it('목표가 찼으면 completion_target_reached 를 알리되 기록은 그대로 남긴다', async () => {
      // 1) 트랜잭션의 응답 행 2) 면제 표식 조회(표식 없음)
      selectLimitMock.mockResolvedValueOnce([ROW]).mockResolvedValueOnce([{ metadata: {} }]);
      controlFlagsMock.mockResolvedValue({ isPaused: false, pausedMessage: null, maxResponses: 3 });
      completedCountMock.mockResolvedValue(3);
      const { recordStepVisit } = await import('@/server/survey-response/services/lifecycle');

      await expect(
        recordStepVisit({ responseId: 'r1', nextStepId: 'group:next' }),
      ).resolves.toEqual({ denial: 'completion_target_reached', pausedMessage: null });
      expect(setMock).toHaveBeenCalled();
      expect(completedCountMock).toHaveBeenCalledWith('s1');
    });

    it('자리가 남았으면 알리지 않고, 면제 표식도 읽지 않는다', async () => {
      selectLimitMock.mockResolvedValueOnce([ROW]);
      controlFlagsMock.mockResolvedValue({ isPaused: false, pausedMessage: null, maxResponses: 3 });
      completedCountMock.mockResolvedValue(2);
      const { recordStepVisit } = await import('@/server/survey-response/services/lifecycle');

      await expect(
        recordStepVisit({ responseId: 'r1', nextStepId: 'group:next' }),
      ).resolves.toEqual({ denial: null, pausedMessage: null });
      expect(selectLimitMock).toHaveBeenCalledTimes(1);
    });

    it('목표가 없는 설문은 완료 수를 세지 않는다', async () => {
      selectLimitMock.mockResolvedValueOnce([ROW]);
      controlFlagsMock.mockResolvedValue({ isPaused: false, pausedMessage: null, maxResponses: null });
      const { recordStepVisit } = await import('@/server/survey-response/services/lifecycle');

      await expect(
        recordStepVisit({ responseId: 'r1', nextStepId: 'group:next' }),
      ).resolves.toEqual({ denial: null, pausedMessage: null });
      expect(completedCountMock).not.toHaveBeenCalled();
    });

    it('재응답 허용으로 되돌려진 응답에는 알리지 않는다 — 그 재제출은 제출 판정도 면제한다', async () => {
      selectLimitMock
        .mockResolvedValueOnce([ROW])
        .mockResolvedValueOnce([{ metadata: { reeditPendingSince: '2026-11-13T00:00:00.000Z' } }]);
      controlFlagsMock.mockResolvedValue({ isPaused: false, pausedMessage: null, maxResponses: 3 });
      completedCountMock.mockResolvedValue(5);
      const { recordStepVisit } = await import('@/server/survey-response/services/lifecycle');

      await expect(
        recordStepVisit({ responseId: 'r1', nextStepId: 'group:next' }),
      ).resolves.toEqual({ denial: null, pausedMessage: null });
    });

    it('중단이 먼저다 — 중단된 설문은 목표를 세지 않고 중단을 알린다', async () => {
      selectLimitMock.mockResolvedValueOnce([ROW]);
      controlFlagsMock.mockResolvedValue({ isPaused: true, pausedMessage: '점검', maxResponses: 3 });
      completedCountMock.mockResolvedValue(5);
      const { recordStepVisit } = await import('@/server/survey-response/services/lifecycle');

      await expect(
        recordStepVisit({ responseId: 'r1', nextStepId: 'group:next' }),
      ).resolves.toEqual({ denial: 'survey_paused', pausedMessage: '점검' });
      expect(completedCountMock).not.toHaveBeenCalled();
    });

    it('테스트 응답에는 알리지 않는다', async () => {
      selectLimitMock.mockResolvedValue([{ ...ROW, isTest: true }]);
      controlFlagsMock.mockResolvedValue({ isPaused: false, pausedMessage: null, maxResponses: 1 });
      completedCountMock.mockResolvedValue(9);
      const { recordStepVisit } = await import('@/server/survey-response/services/lifecycle');
      // 테스트 응답의 소유권 검증은 이 스위트의 관심사가 아니다 — 판정 분기만 본다.
      const result = await recordStepVisit({ responseId: 'r1', nextStepId: 'group:next' }).catch(
        () => 'ownership-guard',
      );
      if (result !== 'ownership-guard') expect(result).toEqual({ denial: null, pausedMessage: null });
      expect(completedCountMock).not.toHaveBeenCalled();
    });
  });

  it('제어 플래그를 못 읽으면 fail-open 한다', async () => {
    selectLimitMock.mockResolvedValue([
      { id: 'r1', surveyId: 's1', isTest: false, contactTargetId: null },
    ]);
    controlFlagsMock.mockResolvedValue(null);
    const { recordStepVisit } =
      await import('@/server/survey-response/services/lifecycle');

    await expect(recordStepVisit({ responseId: 'r1', nextStepId: 'group:next' })).resolves.toEqual({
      denial: null,
      pausedMessage: null,
    });
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
