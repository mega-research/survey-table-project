import { beforeEach, describe, expect, it, vi } from 'vitest';

import { extractRawSql } from './_helpers/result-code-mock';

const {
  findFirstMock,
  selectLimitMock,
  returningMock,
  updateCalledMock,
  controlFlagsMock,
  executeMock,
} = vi.hoisted(() => ({
  findFirstMock: vi.fn(),
  selectLimitMock: vi.fn(),
  returningMock: vi.fn(),
  updateCalledMock: vi.fn(),
  controlFlagsMock: vi.fn(),
  executeMock: vi.fn(),
}));

vi.mock('@/db', () => {
  const updateChain: Record<string, unknown> = {};
  updateChain['set'] = vi.fn(() => updateChain);
  updateChain['where'] = vi.fn(() => updateChain);
  updateChain['returning'] = vi.fn(() => returningMock());

  const selectChain: Record<string, unknown> = {};
  selectChain['from'] = vi.fn(() => selectChain);
  selectChain['where'] = vi.fn(() => selectChain);
  selectChain['limit'] = vi.fn(() => selectLimitMock());

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

vi.mock('@/lib/survey-control', () => ({
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
      '@/features/survey-response/server/services/response.service'
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
      '@/features/survey-response/server/services/response.service'
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
      '@/features/survey-response/server/services/response.service'
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
      '@/features/survey-response/server/services/response.service'
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
      '@/features/survey-response/server/services/response.service'
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
      '@/features/survey-response/server/services/response.service'
    );
    expect(await saveDraftResponseIfActive(INPUT)).toEqual({
      saved: false,
      skipped: 'concluded',
    });
  });

  it('재조회에서도 여전히 in_progress 면 원래 에러를 그대로 재throw 한다', async () => {
    arrangeActiveRow();
    returningMock.mockResolvedValueOnce([]);
    // 재조회해도 여전히 in_progress → 진짜 예외이므로 삼키지 않는다.
    findFirstMock.mockResolvedValueOnce({ id: 'r1', status: 'in_progress', deletedAt: null });
    const { saveDraftResponseIfActive } = await import(
      '@/features/survey-response/server/services/response.service'
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
      '@/features/survey-response/server/services/response.service'
    );
    expect(await saveDraftResponseIfActive(INPUT)).toEqual({ saved: true });
    expect(executeMock).not.toHaveBeenCalled();
  });

  it('더 새로운 seq 는 claim 을 통과하고 답변 쓰기가 일어난다', async () => {
    arrangeActiveRow();
    // claim UPDATE 가 1행을 반환 — 통과.
    executeMock.mockResolvedValueOnce([{ id: 'r1' }]);
    const { saveDraftResponseIfActive } = await import(
      '@/features/survey-response/server/services/response.service'
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
      '@/features/survey-response/server/services/response.service'
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
      '@/features/survey-response/server/services/response.service'
    );
    await expect(
      saveDraftResponse({ responseId: 'r1', answers: { q1: 'a' }, seq: 1 }),
    ).rejects.toThrow('응답을 찾을 수 없습니다.');
  });
});
