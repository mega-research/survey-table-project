import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Param } from 'drizzle-orm';

// ========================
// 모듈 모킹
// ========================
// 쿼터 「진행 중 마감」 — 제출 시점 하드 차단(ADR 0025).
//
// 옵션이 켜진 집행 중 플랜에서는 제출 트랜잭션 안에서 셀 완료 수를 다시 세어, 목표를 채운 뒤에
// 도착한 제출을 완료로 만들지 않고 답변은 저장한 채 quotaful_out 으로 돌린다. 옵션이 꺼진
// 설문은 종전(complete-response-quota-overflow.test.ts — 완료 수용 + 표식) 그대로다.
//
// 좋은 테스트는 "누가 완료되고 누가 쿼터마감되는가"만 본다 — 잠금 SQL 자체는 단언하지 않는다.
// db 모킹은 complete-response-quota-overflow.test.ts 하네스를 복제하고 tx.execute 를 더했다.

const {
  selectTerminalQueue,
  capturedUpdateSets,
  updateReturningMock,
  surveysRowHolder,
  gateRowHolder,
  txExecuteMock,
  outerUpdateMock,
} = vi.hoisted(() => ({
  selectTerminalQueue: [] as unknown[][],
  capturedUpdateSets: [] as Record<string, unknown>[],
  updateReturningMock: vi.fn(),
  surveysRowHolder: { row: {} as Record<string, unknown> },
  gateRowHolder: { row: {} as Record<string, unknown> },
  txExecuteMock: vi.fn(async () => []),
  outerUpdateMock: vi.fn(),
}));

vi.mock('@/db', () => {
  function nextSelectTerminal(): unknown[] {
    return selectTerminalQueue.shift() ?? [];
  }

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
    update: vi.fn(() => {
      outerUpdateMock();
      return makeUpdateChain();
    }),
    transaction: vi.fn(async (cb: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        select: vi.fn(() => makeSelectChain()),
        update: vi.fn(() => makeUpdateChain()),
        insert: vi.fn(() => ({ values: vi.fn(() => Promise.resolve(undefined)) })),
        execute: txExecuteMock,
      };
      return cb(tx);
    }),
    query: {
      surveyResponses: {
        findFirst: vi.fn(async () => gateRowHolder.row),
      },
      surveys: {
        findFirst: vi.fn(async () => surveysRowHolder.row),
      },
    },
  };
  return { db };
});

vi.mock('@/server/survey-response/services/response-answers', () => ({
  replaceResponseAnswers: vi.fn(() => Promise.resolve(undefined)),
}));

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}));

// ========================
// 테스트
// ========================

const RESPONSE_ID = 'resp-1';
const SURVEY_ID = 'survey-1';
const GATE_QID = 'q-gender';

const OPEN_SURVEY_ROW = {
  status: 'published',
  endDate: null,
  maxResponses: null,
  isPublic: true,
  requireInviteToken: false,
};

const BASE_GATE_ROW = {
  surveyId: SURVEY_ID,
  versionId: null,
  contactTargetId: null,
  isTest: false,
  metadata: null,
};

// 단일 차원(성별 choice) × 단일 셀(남 target 2). 옵션 켜짐.
const HARD_CLOSE_PLAN = {
  enabled: true,
  dimensions: [
    {
      id: 'dim-gender',
      questionId: GATE_QID,
      kind: 'choice',
      categories: [{ id: 'cat-male', values: ['남'] }],
    },
  ],
  cells: [{ categoryIds: ['cat-male'], target: 2 }],
  closedMessage: '마감되었습니다.',
  midSurveyClose: true,
  midSurveyClosedMessage: '죄송합니다. 응답 중 마감되었습니다.',
};

// select 호출 순서(versionId=null, contactTargetId=null):
//   0) 가용성 게이트 완료 카운트 (countCompletedResponses)
//   1) 유효 questionId 집합 (loadValidQuestionIds)
//   2·3) loadPiiTargets — 질문 단위·셀 단위 (레거시 폴백, 둘 다 빈 결과)
//   4) 하드 차단: 트랜잭션 안 셀 완료 수 재집계 / 표식 경로: 트랜잭션 밖 detectQuotaOverflow
//      (둘 다 완료 응답 로드 한 번이라 자리가 같다)
function queueSelects(completedAnswersRows: Record<string, unknown>[], hardClose: boolean) {
  selectTerminalQueue.length = 0;
  const completedRows = completedAnswersRows.map((answers) => ({ questionResponses: answers }));
  if (hardClose) {
    selectTerminalQueue.push([{ total: 0 }], [{ id: GATE_QID }], [], [], completedRows);
  } else {
    selectTerminalQueue.push([{ total: 0 }], [{ id: GATE_QID }], completedRows);
  }
}

function mainSet(): Record<string, unknown> {
  const found = capturedUpdateSets.find((s) => s['questionResponses'] !== undefined);
  if (!found) throw new Error('questionResponses 를 담은 UPDATE set 이 없음');
  return found;
}

function collectStrings(node: unknown, out: string[] = [], seen = new Set<unknown>()): string[] {
  if (node == null) return out;
  if (typeof node === 'string') {
    out.push(node);
    return out;
  }
  if (typeof node !== 'object') return out;
  if (seen.has(node)) return out;
  seen.add(node);
  if (node instanceof Param) {
    const value = (node as unknown as { value: unknown }).value;
    if (typeof value === 'string') out.push(value);
    return out;
  }
  if (Array.isArray(node)) {
    for (const item of node) collectStrings(item, out, seen);
    return out;
  }
  const chunkValue = (node as { value?: unknown }).value;
  if (Array.isArray(chunkValue)) {
    for (const v of chunkValue) collectStrings(v, out, seen);
  }
  const chunks = (node as { queryChunks?: unknown[] }).queryChunks;
  if (Array.isArray(chunks)) {
    for (const chunk of chunks) collectStrings(chunk, out, seen);
  }
  return out;
}

async function submit(answers: Record<string, unknown> = { [GATE_QID]: '남' }) {
  const { completeResponse } =
    await import('@/server/survey-response/services/response-completion');
  return completeResponse({ responseId: RESPONSE_ID, data: { questionResponses: answers } });
}

describe('completeResponse — 쿼터 진행 중 마감 하드 차단', () => {
  beforeEach(() => {
    capturedUpdateSets.length = 0;
    selectTerminalQueue.length = 0;
    updateReturningMock.mockReset();
    txExecuteMock.mockClear();
    outerUpdateMock.mockClear();
    updateReturningMock.mockResolvedValue([
      { id: RESPONSE_ID, surveyId: SURVEY_ID, contactTargetId: null, pageVisits: null, isTest: false },
    ]);
    surveysRowHolder.row = { ...OPEN_SURVEY_ROW, quotaConfig: HARD_CLOSE_PLAN };
    gateRowHolder.row = { ...BASE_GATE_ROW };
  });

  it('셀이 목표를 채웠으면 완료로 만들지 않고 답변을 저장한 채 quotaful_out 으로 쓴다', async () => {
    queueSelects([{ [GATE_QID]: '남' }, { [GATE_QID]: '남' }], true);

    const result = await submit();

    const set = mainSet();
    expect(set['status']).toBe('quotaful_out');
    expect(set['isCompleted']).toBe(false);
    expect(set['completedAt']).toBeUndefined();
    expect(set['questionResponses']).toEqual({ [GATE_QID]: '남' });
    // 초과 표식이 아니라 상태로 갈린다.
    expect(collectStrings(set['metadata']).join('')).not.toContain('quotaOverflow');
    // 제출 결과는 쿼터마감 + 진행 중 마감 문구.
    expect(result).toEqual({
      kind: 'quota_closed',
      closedMessage: '죄송합니다. 응답 중 마감되었습니다.',
    });
    // 완료 후처리(컨택 완료 링크)는 타지 않는다.
    expect(outerUpdateMock).not.toHaveBeenCalled();
  });

  it('진행 중 마감 문구가 비면 기존 마감 문구로 폴백한다', async () => {
    surveysRowHolder.row = {
      ...OPEN_SURVEY_ROW,
      quotaConfig: { ...HARD_CLOSE_PLAN, midSurveyClosedMessage: null },
    };
    queueSelects([{ [GATE_QID]: '남' }, { [GATE_QID]: '남' }], true);

    const result = await submit();

    expect(result).toEqual({ kind: 'quota_closed', closedMessage: '마감되었습니다.' });
  });

  it('셀에 여유가 있으면 종전대로 완료된다', async () => {
    queueSelects([{ [GATE_QID]: '남' }], true);

    const result = await submit();

    const set = mainSet();
    expect(set['status']).toBe('completed');
    expect(set['isCompleted']).toBe(true);
    expect(set['completedAt']).toBeInstanceOf(Date);
    expect(set['metadata']).toBeUndefined();
    expect(result).not.toHaveProperty('kind');
  });

  it('옵션이 꺼진 설문은 종전대로 완료를 수용하고 초과 표식만 남긴다 — 잠금도 잡지 않는다', async () => {
    surveysRowHolder.row = {
      ...OPEN_SURVEY_ROW,
      quotaConfig: { ...HARD_CLOSE_PLAN, midSurveyClose: false },
    };
    queueSelects([{ [GATE_QID]: '남' }, { [GATE_QID]: '남' }], false);

    const result = await submit();

    const set = mainSet();
    expect(set['status']).toBe('completed');
    expect(collectStrings(set['metadata']).join('')).toContain('"quotaOverflow":true');
    expect(txExecuteMock).not.toHaveBeenCalled();
    expect(result).not.toHaveProperty('kind');
  });

  it('미분류 응답은 차단하지 않는다', async () => {
    queueSelects([{ [GATE_QID]: '남' }, { [GATE_QID]: '남' }], true);

    const result = await submit({ [GATE_QID]: '기타' });

    expect(mainSet()['status']).toBe('completed');
    expect(txExecuteMock).not.toHaveBeenCalled();
    expect(result).not.toHaveProperty('kind');
  });

  it('목표 없는 셀의 응답은 차단하지 않는다', async () => {
    surveysRowHolder.row = {
      ...OPEN_SURVEY_ROW,
      quotaConfig: {
        ...HARD_CLOSE_PLAN,
        dimensions: [
          {
            id: 'dim-gender',
            questionId: GATE_QID,
            kind: 'choice',
            categories: [
              { id: 'cat-male', values: ['남'] },
              { id: 'cat-female', values: ['여'] },
            ],
          },
        ],
      },
    };
    queueSelects([], true);

    const result = await submit({ [GATE_QID]: '여' });

    expect(mainSet()['status']).toBe('completed');
    expect(txExecuteMock).not.toHaveBeenCalled();
    expect(result).not.toHaveProperty('kind');
  });

  it('테스트 응답은 막히지도 쿼터를 소비하지도 않는다', async () => {
    gateRowHolder.row = { ...BASE_GATE_ROW, isTest: true };
    updateReturningMock.mockResolvedValue([
      { id: RESPONSE_ID, surveyId: SURVEY_ID, contactTargetId: null, pageVisits: null, isTest: true },
    ]);
    queueSelects([{ [GATE_QID]: '남' }, { [GATE_QID]: '남' }], true);

    const result = await submit();

    expect(mainSet()['status']).toBe('completed');
    expect(txExecuteMock).not.toHaveBeenCalled();
    expect(result).not.toHaveProperty('kind');
  });

  it('재응답 허용으로 되돌려진 응답의 재제출은 면제하고 초과 표식만 남긴다', async () => {
    gateRowHolder.row = {
      ...BASE_GATE_ROW,
      metadata: { reeditPendingSince: '2026-09-23T00:00:00.000Z' },
    };
    queueSelects([{ [GATE_QID]: '남' }, { [GATE_QID]: '남' }], false);

    const result = await submit();

    const set = mainSet();
    expect(set['status']).toBe('completed');
    expect(collectStrings(set['metadata']).join('')).toContain('"quotaOverflow":true');
    expect(txExecuteMock).not.toHaveBeenCalled();
    expect(result).not.toHaveProperty('kind');
  });

  it('이미 쿼터마감된 행에 늦게 도착한 complete 는 쿼터마감 결과를 돌려준다', async () => {
    // 페이지 재확인이 먼저 quotaful_out 으로 마킹한 뒤 제출이 도착한 경우 — 가짜 감사 화면도
    // "이미 완료" 안내도 아니라 마감 화면이어야 한다.
    queueSelects([{ [GATE_QID]: '남' }], true);
    updateReturningMock.mockResolvedValue([]);
    // UPDATE 0행 뒤 기존 행 재조회(tx.select ... limit 1)
    selectTerminalQueue.push([
      { id: RESPONSE_ID, surveyId: SURVEY_ID, status: 'quotaful_out', deletedAt: null },
    ]);

    const result = await submit();

    expect(result).toEqual({
      kind: 'quota_closed',
      closedMessage: '죄송합니다. 응답 중 마감되었습니다.',
    });
  });
});
