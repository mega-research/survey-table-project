import { beforeEach, describe, expect, it, vi } from 'vitest';

// ========================
// 모듈 모킹
// ========================
// completeResponse 의 프루닝 스냅샷 가드를 검증한다.
// (.scratch/prune-unprotected-response-wipe/issues/01)
//
// 테스트·soft delete 응답은 버전 스냅샷 프루닝을 보호하지 못한다. 스냅샷이 비워진
// 버전을 참조하는 응답이 완료를 시도하면 멤버십 필터의 유효 질문 집합이 빈 집합이
// 되어 제출 답변 전체가 걸러지고, {} 를 저장하며 성공으로 보고하는 조용한 전량
// 유실이 된다. 가드는 "스냅샷 부재"를 확인해 명시적 에러로 전환한다 — 스냅샷이
// 실존하는 정상 경로(질문 집합이 비지 않은 경우)는 기존 동작 그대로다.
//
// db 는 drizzle fluent chain 흉내(complete-response-membership-guard.test.ts 패턴).
// 스냅샷 경로의 loadValidQuestionIds 는 db.execute(sql) 를 쓰므로 execute 결과도
// 큐잉한다. 메인 UPDATE 의 .set() 인자와 replaceResponseAnswers 호출을 캡처해
// "유실 대신 에러, 저장 없음"을 검증한다.

const {
  selectTerminalQueue,
  executeQueue,
  capturedUpdateSets,
  updateReturningMock,
  replaceResponseAnswersMock,
} = vi.hoisted(() => ({
  selectTerminalQueue: [] as unknown[][],
  executeQueue: [] as unknown[][],
  capturedUpdateSets: [] as Record<string, unknown>[],
  updateReturningMock: vi.fn(),
  replaceResponseAnswersMock: vi.fn(),
}));

vi.mock('@/db', () => {
  function nextSelectTerminal(): unknown[] {
    return selectTerminalQueue.shift() ?? [];
  }

  // select 체인: .from -> .where -> (.limit | 직접 await)
  function makeSelectChain(): Record<string, unknown> {
    const chain: Record<string, unknown> = {};
    chain['from'] = vi.fn(() => chain);
    chain['where'] = vi.fn(() => {
      const whereResult: Record<string, unknown> = {
        limit: vi.fn(() => Promise.resolve(nextSelectTerminal())),
        then: (resolve: (v: unknown) => unknown) => resolve(nextSelectTerminal()),
      };
      return whereResult;
    });
    return chain;
  }

  function makeUpdateChain(): Record<string, unknown> {
    const chain: Record<string, unknown> = {};
    chain['set'] = vi.fn((arg: Record<string, unknown>) => {
      capturedUpdateSets.push(arg);
      return chain;
    });
    chain['where'] = vi.fn(() => chain);
    chain['returning'] = vi.fn(() => updateReturningMock());
    (chain as { then?: unknown })['then'] = (resolve: (v: unknown) => unknown) =>
      resolve(undefined);
    return chain;
  }

  const db: Record<string, unknown> = {
    select: vi.fn(() => makeSelectChain()),
    update: vi.fn(() => makeUpdateChain()),
    // 스냅샷 경로 loadValidQuestionIds 가 사용
    execute: vi.fn(() => Promise.resolve(executeQueue.shift() ?? [])),
    transaction: vi.fn(async (cb: (tx: unknown) => Promise<unknown>) => {
      const lockedSelectResult: Record<string, unknown> = {
        for: vi.fn(() => lockedSelectResult),
        limit: vi.fn(async () => [
          {
            id: RESPONSE_ID,
            surveyId: SURVEY_ID,
            isTest: false,
            contactTargetId: null,
          },
        ]),
      };
      const lockedSelectChain: Record<string, unknown> = {
        from: vi.fn(() => lockedSelectChain),
        where: vi.fn(() => lockedSelectResult),
      };
      const tx = {
        select: vi.fn(() => lockedSelectChain),
        update: vi.fn(() => makeUpdateChain()),
        insert: vi.fn(() => ({ values: vi.fn(() => Promise.resolve(undefined)) })),
      };
      return cb(tx);
    }),
    query: {
      surveyResponses: {
        findFirst: vi.fn(async () => ({
          surveyId: SURVEY_ID,
          versionId: VERSION_ID,
          contactTargetId: null,
          isTest: false,
        })),
      },
      surveys: {
        findFirst: vi.fn(async () => ({
          status: 'published',
          endDate: null,
          maxResponses: null,
          isPublic: true,
          requireInviteToken: false,
          currentVersionId: 'v-current',
          isPaused: false,
          testModeEnabled: false,
          testToken: null,
        })),
      },
      surveyVersions: {
        // 프루닝 시나리오: 구버전(superseded) — 설문이 published 라 완료 게이트는 통과한다
        findFirst: vi.fn(async () => ({ status: 'superseded' })),
      },
    },
  };
  return { db };
});

vi.mock('@/features/survey-response/server/services/response-answers.service', () => ({
  replaceResponseAnswers: vi.fn((...args: unknown[]) => replaceResponseAnswersMock(...args)),
}));

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}));

// ========================
// 테스트
// ========================

const RESPONSE_ID = 'resp-1';
const SURVEY_ID = 'survey-1';
const VERSION_ID = 'v-pruned';
const QID = 'q-1';

// select 호출 순서(versionId 있음, contactTargetId 없음):
//   0) 가용성 게이트 완료 카운트 (countCompletedResponses)
//   1) [빈 유효 집합일 때만] 가드의 스냅샷 존재 확인
// execute 호출 순서:
//   0) 유효 questionId 집합 (loadValidQuestionIds — 스냅샷 경로)

describe('completeResponse — 프루닝 스냅샷 가드', () => {
  beforeEach(() => {
    capturedUpdateSets.length = 0;
    selectTerminalQueue.length = 0;
    executeQueue.length = 0;
    updateReturningMock.mockReset();
    replaceResponseAnswersMock.mockReset();
    updateReturningMock.mockResolvedValue([
      {
        id: RESPONSE_ID,
        surveyId: SURVEY_ID,
        contactTargetId: null,
        pageVisits: null,
      },
    ]);
  });

  it('스냅샷이 프루닝된 버전의 완료는 {} 저장 대신 명시적 에러를 던지고 아무것도 저장하지 않는다', async () => {
    selectTerminalQueue.push(
      [{ total: 0 }], // countCompletedResponses
      [{ questionsState: 'missing' }], // 가드: snapshot IS NULL (프루닝됨)
    );
    executeQueue.push([]); // loadValidQuestionIds: 스냅샷 없음 → 빈 집합

    const { completeResponse } =
      await import('@/features/survey-response/server/services/response.service');

    await expect(
      completeResponse({
        responseId: RESPONSE_ID,
        data: { questionResponses: { [QID]: '유실되면 안 되는 답변' } },
      }),
    ).rejects.toThrow('스냅샷');

    // 저장 자체가 일어나지 않아야 한다 — questionResponses UPDATE 도, 정규화 반영도 없음
    expect(capturedUpdateSets.some((s) => s['questionResponses'] !== undefined)).toBe(false);
    expect(replaceResponseAnswersMock).not.toHaveBeenCalled();
  });

  it('버전 행 자체가 사라진 경우도 동일하게 에러로 막는다', async () => {
    selectTerminalQueue.push(
      [{ total: 0 }], // countCompletedResponses
      [], // 가드: 버전 행 미존재
    );
    executeQueue.push([]); // loadValidQuestionIds: 빈 집합

    const { completeResponse } =
      await import('@/features/survey-response/server/services/response.service');

    await expect(
      completeResponse({
        responseId: RESPONSE_ID,
        data: { questionResponses: { [QID]: '답변' } },
      }),
    ).rejects.toThrow('스냅샷');

    expect(replaceResponseAnswersMock).not.toHaveBeenCalled();
  });

  it('non-null 이지만 questions 가 훼손된 스냅샷도 에러로 막는다 (IS NOT NULL 우회 차단)', async () => {
    selectTerminalQueue.push(
      [{ total: 0 }], // countCompletedResponses
      [{ questionsState: 'malformed' }], // 가드: snapshot {} / questions 비배열
    );
    executeQueue.push([]); // loadValidQuestionIds: 비배열 → 빈 배열 폴백 → 빈 집합

    const { completeResponse } =
      await import('@/features/survey-response/server/services/response.service');

    await expect(
      completeResponse({
        responseId: RESPONSE_ID,
        data: { questionResponses: { [QID]: '답변' } },
      }),
    ).rejects.toThrow('스냅샷');

    expect(replaceResponseAnswersMock).not.toHaveBeenCalled();
  });

  it('검증된 빈 questions 배열(질문 0개 설문)은 가드를 통과한다 — 스냅샷 부재와 구분', async () => {
    selectTerminalQueue.push(
      [{ total: 0 }], // countCompletedResponses
      [{ questionsState: 'empty' }], // 가드: 정상 스냅샷의 진짜 빈 배열
      // 이후 storedRecalc 스냅샷 로드 등은 빈 큐 폴백([])으로 무해
    );
    executeQueue.push([]); // loadValidQuestionIds: 빈 배열 → 빈 집합

    const { completeResponse } =
      await import('@/features/survey-response/server/services/response.service');

    // 에러 없이 완료된다 (제출 키는 멤버십 필터가 전부 걸러 {} 저장 — 질문 0개 설문의 기존 의미론)
    await expect(
      completeResponse({
        responseId: RESPONSE_ID,
        data: { questionResponses: {} },
      }),
    ).resolves.toBeTruthy();
  });

  it('답변 없는 완료(notice-only 흐름)는 questionResponses 를 건드리지 않는다 — 프루닝 버전이어도 유실 없음', async () => {
    selectTerminalQueue.push(
      [{ total: 0 }], // countCompletedResponses
      [{ snapshot: null }], // storedRecalc 스냅샷 로드 (프루닝됨 → calc 재계산 스킵)
    );
    // 페이로드가 없으므로 loadValidQuestionIds(execute)와 가드 select 는 실행되지 않는다

    const { completeResponse } =
      await import('@/features/survey-response/server/services/response.service');

    await expect(
      completeResponse({ responseId: RESPONSE_ID }),
    ).resolves.toBeTruthy();

    // 기존 draft 저장분 보존의 핵심: questionResponses 를 담은 UPDATE 가 없어야 한다.
    // (이 조건이 깨지면 빈 complete 가 저장분을 덮어쓰는 유실이 부활한다)
    expect(capturedUpdateSets.some((s) => s['questionResponses'] !== undefined)).toBe(false);
    expect(replaceResponseAnswersMock).not.toHaveBeenCalled();
  });

  it('스냅샷이 실존하면 기존 스냅샷 멤버십 경로 그대로 완료된다 (가드 무개입)', async () => {
    selectTerminalQueue.push(
      [{ total: 0 }], // countCompletedResponses
      // 가드의 스냅샷 확인 select 없음 — 유효 집합이 비지 않으므로 실행되지 않아야 한다
    );
    executeQueue.push([{ id: QID }]); // loadValidQuestionIds: 스냅샷에 질문 존재

    const { completeResponse } =
      await import('@/features/survey-response/server/services/response.service');

    await completeResponse({
      responseId: RESPONSE_ID,
      data: { questionResponses: { [QID]: '정상 응답', 'q-rogue': '주입' } },
    });

    // 정상 저장: 유효 키 보존 + rogue 키 drop (기존 멤버십 필터 동작 불변)
    const mainSet = capturedUpdateSets.find((s) => s['questionResponses'] !== undefined);
    if (!mainSet) throw new Error('questionResponses 를 담은 UPDATE set 이 없음');
    const qr = mainSet['questionResponses'] as Record<string, unknown>;
    expect(qr[QID]).toBe('정상 응답');
    expect('q-rogue' in qr).toBe(false);
    expect(replaceResponseAnswersMock).toHaveBeenCalledOnce();
  });
});
