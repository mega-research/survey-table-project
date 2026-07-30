import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  findFirstMock,
  selectLimitMock,
  returningMock,
  updateCalledMock,
  controlFlagsMock,
} = vi.hoisted(() => ({
  findFirstMock: vi.fn(),
  selectLimitMock: vi.fn(),
  returningMock: vi.fn(),
  updateCalledMock: vi.fn(),
  controlFlagsMock: vi.fn(),
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
});
