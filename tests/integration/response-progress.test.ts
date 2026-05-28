import { describe, expect, it, vi, beforeEach } from 'vitest';

// ========================
// 모듈 모킹
// ========================
// updateQuestionResponse / saveAdminEdit 가 db.update / db.query 를 사용.
// drizzle fluent chain 흉내 + UPDATE 의 set() 인자 캡쳐.

const {
  updateSetMock,
  updateReturningMock,
  findFirstMock,
  selectLimitMock,
  txMock,
} = vi.hoisted(() => ({
  updateSetMock: vi.fn(),
  updateReturningMock: vi.fn(),
  findFirstMock: vi.fn(),
  selectLimitMock: vi.fn(),
  txMock: vi.fn(),
}));

vi.mock('@/db', () => {
  const chainable: Record<string, unknown> = {};
  // update().set(setArg).where(...).returning() → returning resolves
  chainable.update = vi.fn(() => chainable);
  chainable.set = vi.fn((arg: unknown) => {
    updateSetMock(arg);
    return chainable;
  });
  chainable.where = vi.fn(() => chainable);
  chainable.returning = vi.fn(() => updateReturningMock());
  // select().from().where().limit()
  chainable.select = vi.fn(() => chainable);
  chainable.from = vi.fn(() => chainable);
  chainable.limit = vi.fn(() => selectLimitMock());
  // transaction(cb) → cb(tx) where tx has same chain + delete + insert
  chainable.transaction = vi.fn(async (cb: (tx: unknown) => Promise<unknown>) => {
    const tx = { ...chainable, delete: vi.fn(() => chainable), insert: vi.fn(() => chainable) };
    txMock(cb);
    return cb(tx);
  });
  chainable.query = {
    surveyResponses: {
      findFirst: (...args: unknown[]) => findFirstMock(...args),
    },
  };
  return { db: chainable };
});

vi.mock('@/lib/auth/require-survey-ownership', () => ({
  requireSurveyOwnership: vi.fn(async () => undefined),
}));

vi.mock('@/actions/response-answers-replace', () => ({
  replaceResponseAnswers: vi.fn(async () => undefined),
}));

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}));

// ========================
// 테스트
// ========================

describe('updateQuestionResponse — progress_pct SET', () => {
  beforeEach(() => {
    updateSetMock.mockReset();
    updateReturningMock.mockReset();
    updateReturningMock.mockResolvedValue([{ id: 'r1' }]);
  });

  it('set() 인자에 progressPct SQL 이 포함된다', async () => {
    const { updateQuestionResponse } = await import('@/actions/response-actions');
    await updateQuestionResponse('r1', 'q3', 'value');

    expect(updateSetMock).toHaveBeenCalledTimes(1);
    const setArg = updateSetMock.mock.calls[0][0] as Record<string, unknown>;
    expect(setArg).toHaveProperty('progressPct');
    // drizzle sql template tag 객체 (queryChunks 보유) — 정확한 SQL 비교 대신 SET 키 존재만 검증
    expect(setArg).toHaveProperty('questionResponses');
  });

  it('응답 없음 → throw', async () => {
    updateReturningMock.mockResolvedValue([]);
    const { updateQuestionResponse } = await import('@/actions/response-actions');
    await expect(updateQuestionResponse('missing', 'q1', 'v')).rejects.toThrow(
      '응답을 찾을 수 없습니다.',
    );
  });
});

describe('saveAdminEdit — progress_pct 재계산', () => {
  beforeEach(() => {
    updateSetMock.mockReset();
    findFirstMock.mockReset();
    selectLimitMock.mockReset();
    // transaction 내부에서 호출되는 update().set().where() 는 returning() 없이 끝남
    // chainable.where 는 chainable 을 반환하므로 별도 mock 불필요
    // transaction 바깥 select().from().where().limit() 는 selectLimitMock 으로 제어
  });

  it('status=completed → progressPct=100 으로 SET', async () => {
    findFirstMock.mockResolvedValue({
      id: 'r1',
      status: 'completed',
      versionId: 'v1',
      deletedAt: null,
    });
    const { saveAdminEdit } = await import('@/actions/response-edit-actions');
    await saveAdminEdit('s1', 'r1', { questionResponses: { q1: 'v' } });

    const setArg = updateSetMock.mock.calls[0][0] as Record<string, unknown>;
    expect(setArg.progressPct).toBe(100);
  });

  it('status=drop + questionResponses 비어있음 → progressPct=null', async () => {
    findFirstMock.mockResolvedValue({
      id: 'r1',
      status: 'drop',
      versionId: 'v1',
      deletedAt: null,
    });
    // snapshot 로더가 호출되면 빈 questions 배열 반환
    selectLimitMock.mockResolvedValue([{ snapshot: { questions: [] } }]);
    const { saveAdminEdit } = await import('@/actions/response-edit-actions');
    await saveAdminEdit('s1', 'r1', { questionResponses: {} });

    const setArg = updateSetMock.mock.calls[0][0] as Record<string, unknown>;
    expect(setArg.progressPct).toBeNull();
  });

  it('status=drop + 답변 있음 → snapshot position 기반 % 계산', async () => {
    findFirstMock.mockResolvedValue({
      id: 'r1',
      status: 'drop',
      versionId: 'v1',
      deletedAt: null,
    });
    selectLimitMock.mockResolvedValue([
      {
        snapshot: {
          questions: [{ id: 'q1' }, { id: 'q2' }, { id: 'q3' }, { id: 'q4' }],
        },
      },
    ]);
    const { saveAdminEdit } = await import('@/actions/response-edit-actions');
    await saveAdminEdit('s1', 'r1', {
      questionResponses: { q1: 'a', q3: 'b' },
    });

    const setArg = updateSetMock.mock.calls[0][0] as Record<string, unknown>;
    // max position q3 = 3, total = 4, → 75
    expect(setArg.progressPct).toBe(75);
  });

  it('versionId=null → progressPct=null', async () => {
    findFirstMock.mockResolvedValue({
      id: 'r1',
      status: 'drop',
      versionId: null,
      deletedAt: null,
    });
    const { saveAdminEdit } = await import('@/actions/response-edit-actions');
    await saveAdminEdit('s1', 'r1', {
      questionResponses: { q1: 'a' },
    });

    const setArg = updateSetMock.mock.calls[0][0] as Record<string, unknown>;
    expect(setArg.progressPct).toBeNull();
  });
});
