import { describe, expect, it, vi, beforeEach } from 'vitest';

// ========================
// 모듈 모킹
// ========================
// completeResponse 의 트랜잭션 내부 UPDATE ... returning() 이 빈 배열을 돌려줄 때
// (= responseId 행이 존재하지 않음: admin hardReset/동시 삭제 등) 의 동작을 검증한다.
//
// drizzle fluent chain 흉내 — response-progress.test.ts 의 패턴을 따른다.
// transaction(cb) 는 cb(tx) 를 호출하고 tx 는 동일 chainable 을 공유하므로
// tx.update(...).returning() 도 updateReturningMock 을 통해 [] 를 반환할 수 있다.

const { updateReturningMock, selectLimitMock } = vi.hoisted(() => ({
  updateReturningMock: vi.fn(),
  selectLimitMock: vi.fn(),
}));

vi.mock('@/db', () => {
  const chainable: Record<string, unknown> = {};
  chainable['update'] = vi.fn(() => chainable);
  chainable['set'] = vi.fn(() => chainable);
  // .where() 는 chainable(.limit/.returning) 이면서 thenable. 직접 await 되는 쿼리
  // (가용성 게이트 count, totalSeconds 정정 UPDATE)는 빈 배열로 resolve 한다.
  chainable['where'] = vi.fn(() => {
    const whereResult: Record<string, unknown> = {
      limit: vi.fn(() => selectLimitMock()),
      returning: vi.fn(() => updateReturningMock()),
      then: (resolve: (v: unknown) => unknown) => resolve([]),
    };
    return whereResult;
  });
  chainable['returning'] = vi.fn(() => updateReturningMock());
  chainable['select'] = vi.fn(() => chainable);
  chainable['from'] = vi.fn(() => chainable);
  chainable['limit'] = vi.fn(() => selectLimitMock());
  chainable['transaction'] = vi.fn(async (cb: (tx: unknown) => Promise<unknown>) => {
    const tx = { ...chainable, delete: vi.fn(() => chainable), insert: vi.fn(() => chainable) };
    return cb(tx);
  });
  // 가용성 게이트(#3): 완료 진입부에서 응답 행 + 설문 행을 조회한다. 게이트 자체를 통과시켜
  // 기존 회귀(빈 returning 후 폴백 SELECT) 검증을 그대로 유지한다.
  chainable['query'] = {
    surveyResponses: {
      findFirst: vi.fn(async () => ({ surveyId: 's1', versionId: null, contactTargetId: null })),
    },
    surveys: {
      findFirst: vi.fn(async () => ({
        status: 'published',
        endDate: null,
        maxResponses: null,
        isPublic: true,
        requireInviteToken: false,
      })),
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

describe('completeResponse — 대상 행 없음 / 가드 차단 (빈 returning)', () => {
  beforeEach(() => {
    updateReturningMock.mockReset();
    selectLimitMock.mockReset();
  });

  it('UPDATE 가 0행이고 행 자체가 없으면 명시적 에러로 throw 한다 (undefined 접근 크래시 아님)', async () => {
    // 가드(deletedAt/status) 또는 존재하지 않는 responseId 로 UPDATE 가 0행 → returning() = []
    updateReturningMock.mockResolvedValue([]);
    // 0행 이후 폴백 SELECT 도 행 없음
    selectLimitMock.mockResolvedValue([]);

    const { completeResponse } = await import('@/features/survey-response/server/services/response.service');

    // data 없이 호출 → prefill SELECT 분기 skip, 곧장 트랜잭션 UPDATE 로 진입
    await expect(completeResponse({ responseId: 'does-not-exist' })).rejects.toThrow(
      /완료 처리 불가 행/,
    );
  });

  it('정상 in_progress 행이면 갱신된 행을 반환한다', async () => {
    updateReturningMock.mockResolvedValue([
      { id: 'r1', surveyId: 's1', contactTargetId: null, pageVisits: null },
    ]);

    const { completeResponse } = await import('@/features/survey-response/server/services/response.service');
    const result = await completeResponse({ responseId: 'r1' });

    expect(result).toMatchObject({ id: 'r1', surveyId: 's1' });
  });

  it('가드에 막혀 0행이지만 이미 완료된 같은 행이면 멱등 재시도로 기존 행을 반환한다', async () => {
    // 지연/리플레이 complete 호출: status=completed 라 UPDATE 가드가 0행으로 막음
    updateReturningMock.mockResolvedValue([]);
    // 폴백 SELECT 는 이미 완료(soft-delete 아님)된 행을 돌려줌
    selectLimitMock.mockResolvedValue([
      { id: 'r1', surveyId: 's1', isCompleted: true, status: 'completed', deletedAt: null, contactTargetId: null, pageVisits: null },
    ]);

    const { completeResponse } = await import('@/features/survey-response/server/services/response.service');
    const result = await completeResponse({ responseId: 'r1' });

    expect(result).toMatchObject({ id: 'r1', isCompleted: true });
  });

  it('가드에 막혀 0행이고 종결 status(screened_out)면 완료 처리를 거부한다 (덮어쓰기 방지)', async () => {
    updateReturningMock.mockResolvedValue([]);
    // 폴백 SELECT: 이미 자격미달 종결 — isCompleted=false
    selectLimitMock.mockResolvedValue([
      { id: 'r1', surveyId: 's1', isCompleted: false, status: 'screened_out', deletedAt: null, contactTargetId: null, pageVisits: null },
    ]);

    const { completeResponse } = await import('@/features/survey-response/server/services/response.service');

    await expect(completeResponse({ responseId: 'r1' })).rejects.toThrow(/완료 처리 불가 행/);
  });

  it('가드에 막혀 0행이고 soft-delete 된 행이면 (완료여부 무관) 완료 처리를 거부한다 (부활 방지)', async () => {
    updateReturningMock.mockResolvedValue([]);
    // 폴백 SELECT: 완료였으나 이후 soft-delete 됨 → 멱등 반환 대상 아님
    selectLimitMock.mockResolvedValue([
      { id: 'r1', surveyId: 's1', isCompleted: true, status: 'completed', deletedAt: new Date(), contactTargetId: null, pageVisits: null },
    ]);

    const { completeResponse } = await import('@/features/survey-response/server/services/response.service');

    await expect(completeResponse({ responseId: 'r1' })).rejects.toThrow(/완료 처리 불가 행/);
  });
});
