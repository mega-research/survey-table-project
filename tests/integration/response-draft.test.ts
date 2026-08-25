import { beforeEach, describe, expect, it, vi } from 'vitest';

import { extractRawSql } from './_helpers/result-code-mock';

const {
  findFirstMock,
  selectLimitMock,
  returningMock,
  updateCalledMock,
  controlFlagsMock,
  executeMock,
  setSpy,
} = vi.hoisted(() => ({
  findFirstMock: vi.fn(),
  selectLimitMock: vi.fn(),
  returningMock: vi.fn(),
  updateCalledMock: vi.fn(),
  controlFlagsMock: vi.fn(),
  executeMock: vi.fn(),
  setSpy: vi.fn(),
}));

vi.mock('@/db', () => {
  const updateChain: Record<string, unknown> = {};
  updateChain['set'] = vi.fn((arg: unknown) => {
    setSpy(arg);
    return updateChain;
  });
  updateChain['where'] = vi.fn(() => updateChain);
  updateChain['returning'] = vi.fn(() => returningMock());

  const selectChain: Record<string, unknown> = {};
  selectChain['from'] = vi.fn(() => selectChain);
  selectChain['where'] = vi.fn(() => selectChain);
  selectChain['limit'] = vi.fn(() => selectLimitMock());
  // 배치 조회는 limit 없이 await 한다 — thenable 로 만들어 두 형태를 모두 지원.
  selectChain['then'] = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
    Promise.resolve(selectLimitMock()).then(resolve, reject);

  return {
    db: {
      query: { surveyResponses: { findFirst: (...a: unknown[]) => findFirstMock(...a) } },
      update: vi.fn(() => {
        updateCalledMock();
        return updateChain;
      }),
      select: vi.fn(() => selectChain),
      // claimDraftSeq 전용. seq 없는 입력은 이 mock 을 전혀 호출하지 않아야 한다.
      execute: (...a: unknown[]) => executeMock(...a),
    },
  };
});

vi.mock('@/server/read-models/survey-control', () => ({
  getSurveyControlFlags: (...a: unknown[]) => controlFlagsMock(...a),
  isValidTestToken: vi.fn(),
}));

const INPUT = { responseId: 'r1', answers: { q1: 'a' } };

/** in_progress 행 + 소속 검증 통과 + 저장 성공까지 가는 기본 경로를 깔아둔다. */
function arrangeActiveRow() {
  findFirstMock
    // saveDraftResponseIfActive 의 상태 조회
    .mockResolvedValueOnce({ id: 'r1', status: 'in_progress', deletedAt: null })
    // updateQuestionResponse 내부의 응답 행 조회 (versionId null → questions 테이블 폴백)
    .mockResolvedValueOnce({
      id: 'r1',
      surveyId: 's1',
      versionId: null,
      isTest: false,
      contactTargetId: null,
    });
  selectLimitMock.mockResolvedValue([{ id: 'q1', piiEncrypted: false }]);
  returningMock.mockResolvedValue([{ id: 'r1' }]);
  controlFlagsMock.mockResolvedValue({ isPaused: false });
}

describe('saveDraftResponseIfActive', () => {
  beforeEach(() => {
    findFirstMock.mockReset();
    selectLimitMock.mockReset();
    returningMock.mockReset();
    updateCalledMock.mockReset();
    controlFlagsMock.mockReset();
    executeMock.mockReset();
  });

  it('응답 행이 없으면 not_found 로 skip 하고 저장을 시도하지 않는다', async () => {
    findFirstMock.mockResolvedValueOnce(undefined);
    const { saveDraftResponseIfActive } = await import(
      '@/server/survey-response/services/response-draft'
    );
    expect(await saveDraftResponseIfActive(INPUT)).toEqual({
      saved: false,
      skipped: 'not_found',
    });
    expect(updateCalledMock).not.toHaveBeenCalled();
  });

  it('삭제된 행이면 deleted 로 skip 한다', async () => {
    findFirstMock.mockResolvedValueOnce({
      id: 'r1',
      status: 'in_progress',
      deletedAt: new Date('2026-07-30T00:00:00Z'),
    });
    const { saveDraftResponseIfActive } = await import(
      '@/server/survey-response/services/response-draft'
    );
    expect(await saveDraftResponseIfActive(INPUT)).toEqual({
      saved: false,
      skipped: 'deleted',
    });
    expect(updateCalledMock).not.toHaveBeenCalled();
  });

  it('종결 상태면 concluded 로 skip 한다', async () => {
    findFirstMock.mockResolvedValueOnce({ id: 'r1', status: 'completed', deletedAt: null });
    const { saveDraftResponseIfActive } = await import(
      '@/server/survey-response/services/response-draft'
    );
    expect(await saveDraftResponseIfActive(INPUT)).toEqual({
      saved: false,
      skipped: 'concluded',
    });
    expect(updateCalledMock).not.toHaveBeenCalled();
  });

  it('중단된 설문이면 survey_paused 로 skip 한다', async () => {
    arrangeActiveRow();
    controlFlagsMock.mockResolvedValue({ isPaused: true });
    const { saveDraftResponseIfActive } = await import(
      '@/server/survey-response/services/response-draft'
    );
    expect(await saveDraftResponseIfActive(INPUT)).toEqual({
      saved: false,
      skipped: 'survey_paused',
    });
    expect(updateCalledMock).not.toHaveBeenCalled();
  });

  it('in_progress 행이면 저장하고 saved 를 반환한다', async () => {
    arrangeActiveRow();
    const { saveDraftResponseIfActive } = await import(
      '@/server/survey-response/services/response-draft'
    );
    expect(await saveDraftResponseIfActive(INPUT)).toEqual({ saved: true });
    expect(updateCalledMock).toHaveBeenCalledTimes(1);
  });

  it('게이트 통과 후 저장 직전 종결되면(0행 매치) 재조회로 concluded skip 을 반환한다', async () => {
    arrangeActiveRow();
    // applyQuestionResponseUpdate 의 WHERE status='in_progress' 가 0행 매치 → 평범한 Error throw.
    returningMock.mockResolvedValueOnce([]);
    // 저장 실패 후 재조회: 그 사이 응답이 종결됐다.
    findFirstMock.mockResolvedValueOnce({ id: 'r1', status: 'completed', deletedAt: null });
    const { saveDraftResponseIfActive } = await import(
      '@/server/survey-response/services/response-draft'
    );
    expect(await saveDraftResponseIfActive(INPUT)).toEqual({
      saved: false,
      skipped: 'concluded',
    });
  });

  it('재조회에서도 여전히 in_progress 면 원래 에러를 그대로 재throw 한다', async () => {
    arrangeActiveRow();
    returningMock.mockResolvedValueOnce([]);
    // 0행 사유 판별(judgeDraftZeroRow)의 행 재조회 — in_progress 그대로면 stale/concluded
    // 어느 쪽도 아니므로 원래 에러를 던진다.
    executeMock.mockResolvedValueOnce([{ draft_seq: null, status: 'in_progress', deleted: false }]);
    // 재조회해도 여전히 in_progress → 진짜 예외이므로 삼키지 않는다.
    findFirstMock.mockResolvedValueOnce({ id: 'r1', status: 'in_progress', deletedAt: null });
    const { saveDraftResponseIfActive } = await import(
      '@/server/survey-response/services/response-draft'
    );
    await expect(saveDraftResponseIfActive(INPUT)).rejects.toThrow(
      '응답을 수정할 수 없습니다.',
    );
  });
});

describe('saveDraftResponse — seq 가드(배치 claim)', () => {
  beforeEach(() => {
    findFirstMock.mockReset();
    selectLimitMock.mockReset();
    returningMock.mockReset();
    updateCalledMock.mockReset();
    controlFlagsMock.mockReset();
    executeMock.mockReset();
  });

  it('seq 없는 요청은 claim 을 건너뛰고 기존대로 저장한다', async () => {
    arrangeActiveRow();
    const { saveDraftResponseIfActive } = await import(
      '@/server/survey-response/services/response-draft'
    );
    expect(await saveDraftResponseIfActive(INPUT)).toEqual({ saved: true });
    expect(executeMock).not.toHaveBeenCalled();
  });

  it('더 새로운 seq 는 claim 을 통과하고 답변 쓰기가 일어난다', async () => {
    arrangeActiveRow();
    // claim UPDATE 가 1행을 반환 — 통과.
    executeMock.mockResolvedValueOnce([{ id: 'r1' }]);
    const { saveDraftResponseIfActive } = await import(
      '@/server/survey-response/services/response-draft'
    );
    expect(await saveDraftResponseIfActive({ ...INPUT, seq: 5 })).toEqual({ saved: true });
    expect(updateCalledMock).toHaveBeenCalledTimes(1);

    const claimSql = executeMock.mock.calls[0]?.[0];
    const raw = extractRawSql(claimSql);
    expect(raw).toContain('draftSeq');
    expect(raw).toContain('<');
  });

  it('오래된 seq 는 stale 로 skip 되고 답변 쓰기가 일어나지 않는다', async () => {
    // 게이트 통과용 활성 행만 준비 — claim 이 stale 이면 updateQuestionResponse 에 도달하지 않는다.
    findFirstMock.mockResolvedValueOnce({ id: 'r1', status: 'in_progress', deletedAt: null });
    // claim UPDATE 0행 → 존재 확인 SELECT 1행 → stale.
    executeMock.mockResolvedValueOnce([]).mockResolvedValueOnce([{ id: 'r1' }]);
    const { saveDraftResponseIfActive } = await import(
      '@/server/survey-response/services/response-draft'
    );
    expect(await saveDraftResponseIfActive({ ...INPUT, seq: 1 })).toEqual({
      saved: false,
      skipped: 'stale',
    });
    expect(updateCalledMock).not.toHaveBeenCalled();
  });

  it('claim 0행 + 존재 확인 0행이면 not_found 로 판단해 기존 에러 경로를 탄다', async () => {
    // 게이트가 먼저 not_found 를 잡으므로 saveDraftResponse 를 직접 호출해 claim 내부 판단을 검증한다.
    executeMock.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    // updateQuestionResponse 내부 응답 행 조회 — 행 없음 → 기존 에러 경로.
    findFirstMock.mockResolvedValueOnce(undefined);
    const { saveDraftResponse } = await import(
      '@/server/survey-response/services/response-draft'
    );
    await expect(
      saveDraftResponse({ responseId: 'r1', answers: { q1: 'a' }, seq: 1 }),
    ).rejects.toThrow('응답을 찾을 수 없습니다.');
  });
});

// 페이지 이동 체크포인트는 답변 수만큼 서버 왕복을 반복하면 안 된다.
// 문항 10개 페이지에서 왕복 60회 → 2.3초가 관측되어 배치로 전환했다(2026-08-04).
describe('saveDraftResponse — 배치 저장', () => {
  beforeEach(() => {
    findFirstMock.mockReset();
    selectLimitMock.mockReset();
    returningMock.mockReset();
    updateCalledMock.mockReset();
    controlFlagsMock.mockReset();
    executeMock.mockReset();
    setSpy.mockReset();
  });

  /** 답변 3개짜리 배치가 통과하는 기본 경로. */
  function arrangeBatch() {
    findFirstMock.mockResolvedValue({
      id: 'r1',
      surveyId: 's1',
      versionId: null,
      isTest: false,
      contactTargetId: null,
    });
    selectLimitMock.mockResolvedValue([
      { id: 'q1', piiEncrypted: false },
      { id: 'q2', piiEncrypted: false },
      { id: 'q3', piiEncrypted: false },
    ]);
    returningMock.mockResolvedValue([{ id: 'r1' }]);
    controlFlagsMock.mockResolvedValue({ isPaused: false });
  }

  const THREE = { responseId: 'r1', answers: { q1: 'a', q2: 'b', q3: 'c' } };

  it('답변이 여러 개여도 응답 행 조회는 1회다', async () => {
    arrangeBatch();
    const { saveDraftResponse } = await import(
      '@/server/survey-response/services/response-draft'
    );
    await saveDraftResponse(THREE);
    expect(findFirstMock).toHaveBeenCalledTimes(1);
  });

  it('답변이 여러 개여도 UPDATE 는 1회다', async () => {
    arrangeBatch();
    const { saveDraftResponse } = await import(
      '@/server/survey-response/services/response-draft'
    );
    await saveDraftResponse(THREE);
    expect(updateCalledMock).toHaveBeenCalledTimes(1);
  });

  it('답변이 여러 개여도 중단 플래그 조회는 1회다', async () => {
    arrangeBatch();
    const { saveDraftResponse } = await import(
      '@/server/survey-response/services/response-draft'
    );
    await saveDraftResponse(THREE);
    expect(controlFlagsMock).toHaveBeenCalledTimes(1);
  });

  it('배치의 모든 답변이 하나의 UPDATE 에 담긴다', async () => {
    arrangeBatch();
    const { saveDraftResponse } = await import(
      '@/server/survey-response/services/response-draft'
    );
    expect(await saveDraftResponse(THREE)).toEqual({ applied: true });
    const setArg = setSpy.mock.calls.at(-1)?.[0] as { questionResponses?: unknown };
    const raw = extractRawSql(setArg?.questionResponses);
    // 세 답이 모두 같은 payload 에 들어가야 한다 — 문항별 UPDATE 였다면 하나씩만 보인다.
    expect(raw).toContain('q1');
    expect(raw).toContain('q2');
    expect(raw).toContain('q3');
  });

  it('소속되지 않은 questionId 가 섞이면 거부하고 아무것도 쓰지 않는다', async () => {
    findFirstMock.mockResolvedValue({
      id: 'r1',
      surveyId: 's1',
      versionId: null,
      isTest: false,
      contactTargetId: null,
    });
    // q2 만 실재 — q1/q3 는 이 설문 소속이 아니다.
    selectLimitMock.mockResolvedValue([{ id: 'q2', piiEncrypted: false }]);
    controlFlagsMock.mockResolvedValue({ isPaused: false });
    const { saveDraftResponse } = await import(
      '@/server/survey-response/services/response-draft'
    );
    await expect(saveDraftResponse(THREE)).rejects.toThrow(
      '해당 설문에 존재하지 않는 질문입니다.',
    );
    expect(updateCalledMock).not.toHaveBeenCalled();
  });

  it('중단된 설문이면 거부하고 아무것도 쓰지 않는다', async () => {
    arrangeBatch();
    controlFlagsMock.mockResolvedValue({ isPaused: true });
    const { saveDraftResponse } = await import(
      '@/server/survey-response/services/response-draft'
    );
    await expect(saveDraftResponse(THREE)).rejects.toThrow('응답을 받을 수 없는 설문입니다.');
    expect(updateCalledMock).not.toHaveBeenCalled();
  });
});
