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
  chainable['update'] = vi.fn(() => chainable);
  chainable['set'] = vi.fn((arg: unknown) => {
    updateSetMock(arg);
    return chainable;
  });
  chainable['where'] = vi.fn(() => chainable);
  chainable['returning'] = vi.fn(() => updateReturningMock());
  // select().from().where().limit()
  chainable['select'] = vi.fn(() => chainable);
  chainable['from'] = vi.fn(() => chainable);
  chainable['limit'] = vi.fn(() => selectLimitMock());
  // insert().values() — saveAdminEdit 의 response_edit_logs audit insert glue
  chainable['insert'] = vi.fn(() => chainable);
  chainable['values'] = vi.fn(async () => undefined);
  // transaction(cb) → cb(tx) where tx has same chain + delete + insert
  chainable['transaction'] = vi.fn(async (cb: (tx: unknown) => Promise<unknown>) => {
    const tx = { ...chainable, delete: vi.fn(() => chainable), insert: vi.fn(() => chainable) };
    txMock(cb);
    return cb(tx);
  });
  chainable['query'] = {
    surveyResponses: {
      findFirst: (...args: unknown[]) => findFirstMock(...args),
    },
    // saveAdminEdit service 의 소유권 검증(db.query.surveys.findFirst) — 항상 존재로 통과
    surveys: {
      findFirst: vi.fn(async () => ({ id: 's1' })),
    },
  };
  return { db: chainable };
});

vi.mock('@/features/survey-response/server/services/response-answers.service', () => ({
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
    const { updateQuestionResponse } = await import('@/features/survey-response/server/services/response.service');
    await updateQuestionResponse({ responseId: 'r1', questionId: 'q3', value: 'value' });

    expect(updateSetMock).toHaveBeenCalledTimes(1);
    const rawCall0 = updateSetMock.mock.calls[0];
    if (!rawCall0) throw new Error('updateSetMock 호출 없음');
    const setArg = rawCall0[0] as Record<string, unknown>;
    expect(setArg).toHaveProperty('progressPct');
    // drizzle sql template tag 객체 (queryChunks 보유) — 정확한 SQL 비교 대신 SET 키 존재만 검증
    expect(setArg).toHaveProperty('questionResponses');
  });

  it('응답 없음 → throw', async () => {
    updateReturningMock.mockResolvedValue([]);
    const { updateQuestionResponse } = await import('@/features/survey-response/server/services/response.service');
    await expect(
      updateQuestionResponse({ responseId: 'missing', questionId: 'q1', value: 'v' }),
    ).rejects.toThrow('응답을 찾을 수 없습니다.');
  });
});

describe('saveAdminEdit — progress_pct 재계산', () => {
  beforeEach(() => {
    updateSetMock.mockReset();
    updateReturningMock.mockReset();
    findFirstMock.mockReset();
    selectLimitMock.mockReset();
    // 기본값: 빈 결과. audit diff 의 버전 스냅샷 조회와 progress snapshot 조회가
    // 같은 limit mock 을 공유하므로, 스냅샷이 필요한 테스트만 개별 mockResolvedValue 로 덮는다.
    selectLimitMock.mockResolvedValue([]);
    // 트랜잭션 안 UPDATE 가 isNull(deletedAt) 가드와 함께 .returning() 으로 영향 행을 검사한다.
    // 기본값은 1행(정상 경합 없음) — 삭제 경합 케이스만 개별 테스트에서 []로 덮는다.
    updateReturningMock.mockResolvedValue([{ id: 'r1' }]);
    // transaction 바깥 select().from().where().limit() 는 selectLimitMock 으로 제어
  });

  it('status=completed → progressPct=100 으로 SET', async () => {
    findFirstMock.mockResolvedValue({
      id: 'r1',
      status: 'completed',
      versionId: 'v1',
      deletedAt: null,
    });
    const { saveAdminEdit } = await import('@/features/survey-response/server/services/response-edit.service');
    await saveAdminEdit(
      { surveyId: 's1', responseId: 'r1', questionResponses: { q1: 'v' } },
      { id: 'admin-1', email: 'a@b.com' },
    );

    const completedCall = updateSetMock.mock.calls[0];
    if (!completedCall) throw new Error('updateSetMock 호출 없음');
    const setArg = completedCall[0] as Record<string, unknown>;
    expect(setArg['progressPct']).toBe(100);
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
    const { saveAdminEdit } = await import('@/features/survey-response/server/services/response-edit.service');
    await saveAdminEdit(
      { surveyId: 's1', responseId: 'r1', questionResponses: {} },
      { id: 'admin-1', email: 'a@b.com' },
    );

    const dropEmptyCall = updateSetMock.mock.calls[0];
    if (!dropEmptyCall) throw new Error('updateSetMock 호출 없음');
    const setArg = dropEmptyCall[0] as Record<string, unknown>;
    expect(setArg['progressPct']).toBeNull();
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
    const { saveAdminEdit } = await import('@/features/survey-response/server/services/response-edit.service');
    await saveAdminEdit(
      {
        surveyId: 's1',
        responseId: 'r1',
        questionResponses: { q1: 'a', q3: 'b' },
      },
      { id: 'admin-1', email: 'a@b.com' },
    );

    const dropAnsweredCall = updateSetMock.mock.calls[0];
    if (!dropAnsweredCall) throw new Error('updateSetMock 호출 없음');
    const setArg = dropAnsweredCall[0] as Record<string, unknown>;
    // max position q3 = 3, total = 4, → 75
    expect(setArg['progressPct']).toBe(75);
  });

  it('versionId=null → progressPct=null', async () => {
    findFirstMock.mockResolvedValue({
      id: 'r1',
      status: 'drop',
      versionId: null,
      deletedAt: null,
    });
    const { saveAdminEdit } = await import('@/features/survey-response/server/services/response-edit.service');
    await saveAdminEdit(
      {
        surveyId: 's1',
        responseId: 'r1',
        questionResponses: { q1: 'a' },
      },
      { id: 'admin-1', email: 'a@b.com' },
    );

    const nullVersionCall = updateSetMock.mock.calls[0];
    if (!nullVersionCall) throw new Error('updateSetMock 호출 없음');
    const setArg = nullVersionCall[0] as Record<string, unknown>;
    expect(setArg['progressPct']).toBeNull();
  });

  // 회귀(M63): 사전 deletedAt 검사 이후 동시 softDeleteResponse 가 끼어드는 TOCTOU.
  // 트랜잭션 안 UPDATE 가 isNull(deletedAt) 가드로 0행을 반환하면 throw 해
  // answers 재작성/edit log 를 하지 않고 롤백해야 한다.
  it('트랜잭션 안 UPDATE 가 0행이면(동시 soft delete) throw 하고 answers 재작성을 건너뛴다', async () => {
    findFirstMock.mockResolvedValue({
      id: 'r1',
      status: 'drop',
      versionId: null,
      // 사전 검사 시점에는 아직 활성 — 검사를 통과시킨다.
      deletedAt: null,
    });
    // 트랜잭션 진입 후 동시 삭제가 이겨 isNull(deletedAt) 가드에 걸려 0행.
    updateReturningMock.mockResolvedValue([]);

    const { replaceResponseAnswers } = await import(
      '@/features/survey-response/server/services/response-answers.service'
    );
    vi.mocked(replaceResponseAnswers).mockClear();

    const { saveAdminEdit } = await import('@/features/survey-response/server/services/response-edit.service');
    await expect(
      saveAdminEdit(
        { surveyId: 's1', responseId: 'r1', questionResponses: { q1: 'a' } },
        { id: 'admin-1', email: 'a@b.com' },
      ),
    ).rejects.toThrow('Cannot edit deleted response');

    // 경합에서 졌으면 정규화 응답 재작성은 하지 않아야 한다 (롤백 의도).
    expect(replaceResponseAnswers).not.toHaveBeenCalled();
  });
});
