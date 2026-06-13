import { describe, expect, it, vi, beforeEach } from 'vitest';

// ========================
// 모듈 모킹
// ========================
// completeResponse 의 JSONB 오염 가드(updateQuestionResponse 와 대칭)를 검증한다.
//
// 미인증 응답자가 complete 한 번으로
//   (a) 설문에 존재하지 않는 임의 questionId 를 주입하거나
//   (b) 단일 질문에 거대 값을 주입해
// survey_responses.questionResponses JSONB SSOT 를 오염/팽창시킬 수 있었다.
// 신규 멤버십/바이트 필터는 유효 집합에 없는 키와 256KB 초과 값을 silent drop 하고,
// 통과한 키에 한해서만 prefill 강제 복원을 적용한다.
//
// db 는 drizzle fluent chain 흉내. select 종단(.limit / 직접 await 되는 .where)은
// 호출 순서대로 큐잉된 결과를 돌려주고, 트랜잭션 내부 메인 UPDATE 의 .set() 인자와
// replaceResponseAnswers 인자를 캡처해 최종 저장값을 검증한다.

const {
  selectTerminalQueue,
  capturedUpdateSets,
  updateReturningMock,
  replaceResponseAnswersMock,
} = vi.hoisted(() => ({
  selectTerminalQueue: [] as unknown[][],
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
    transaction: vi.fn(async (cb: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        update: vi.fn(() => makeUpdateChain()),
        insert: vi.fn(() => ({ values: vi.fn(() => Promise.resolve(undefined)) })),
      };
      return cb(tx);
    }),
    query: {
      surveyResponses: {
        findFirst: vi.fn(async () => ({
          surveyId: SURVEY_ID,
          versionId: null,
          contactTargetId: CONTACT_TARGET_ID,
        })),
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
const CONTACT_TARGET_ID = 'ct-1';
const VALID_QID = 'q-valid';
const PREFILL_QID = 'q-prefill';
const ROGUE_QID = 'q-rogue-not-in-survey';

// select 호출 순서(versionId=null, contactTargetId 있음):
//   0) 가용성 게이트 완료 카운트 (countCompletedResponses)
//   1) 유효 questionId 집합 (loadValidQuestionIds — questions 테이블 폴백)
//   2) contactTargets attrs (prefill 재검증)
//   3) prefillQuestions
// (prefill 의 contactTargetId/surveyId 는 gateRow 재사용으로 별도 select 없음)
function queueSelects(opts: {
  validQuestionIds: string[];
  attrs: Record<string, string>;
  prefillTemplate?: string;
  prefillQid?: string;
}) {
  selectTerminalQueue.length = 0;
  selectTerminalQueue.push(
    [{ total: 0 }],
    opts.validQuestionIds.map((id) => ({ id })),
    [{ attrs: opts.attrs }],
    opts.prefillTemplate
      ? [{ id: opts.prefillQid ?? PREFILL_QID, template: opts.prefillTemplate }]
      : [],
  );
}

function lastMainSet(): Record<string, unknown> {
  const mainSet = capturedUpdateSets.find((s) => s['questionResponses'] !== undefined);
  if (!mainSet) throw new Error('questionResponses 를 담은 UPDATE set 이 없음');
  return mainSet;
}

describe('completeResponse — JSONB 오염 가드 (멤버십/바이트 필터)', () => {
  beforeEach(() => {
    capturedUpdateSets.length = 0;
    selectTerminalQueue.length = 0;
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

  it('유효 집합에 없는 questionId 는 JSONB 와 response_answers 양쪽에서 drop 한다', async () => {
    queueSelects({ validQuestionIds: [VALID_QID], attrs: {} });

    const { completeResponse } = await import(
      '@/features/survey-response/server/services/response.service'
    );

    await completeResponse({
      responseId: RESPONSE_ID,
      data: {
        questionResponses: {
          [VALID_QID]: '정상 응답',
          [ROGUE_QID]: 'rogue 주입',
        },
      },
    });

    // JSONB 저장값: 유효 키만 보존, rogue 키 drop
    const qr = lastMainSet()['questionResponses'] as Record<string, unknown>;
    expect(qr[VALID_QID]).toBe('정상 응답');
    expect(ROGUE_QID in qr).toBe(false);

    // response_answers 인자(replaceResponseAnswers 4번째 인자)도 동일하게 필터됨
    expect(replaceResponseAnswersMock).toHaveBeenCalledOnce();
    const raCall = replaceResponseAnswersMock.mock.calls[0];
    if (!raCall) throw new Error('replaceResponseAnswers 호출 없음');
    const raResponses = raCall[3] as Record<string, unknown>;
    expect(raResponses[VALID_QID]).toBe('정상 응답');
    expect(ROGUE_QID in raResponses).toBe(false);
  });

  it('단일 키 256KB 초과 값은 그 키만 drop 하고 나머지 정상 키는 보존한다', async () => {
    queueSelects({ validQuestionIds: [VALID_QID, 'q-huge'], attrs: {} });

    const { completeResponse } = await import(
      '@/features/survey-response/server/services/response.service'
    );

    // 256KB 를 넘는 거대 문자열 (utf8 1바이트 문자 × 300KB)
    const huge = 'a'.repeat(300 * 1024);

    await completeResponse({
      responseId: RESPONSE_ID,
      data: {
        questionResponses: {
          [VALID_QID]: '정상 응답',
          'q-huge': huge,
        },
      },
    });

    const qr = lastMainSet()['questionResponses'] as Record<string, unknown>;
    expect(qr[VALID_QID]).toBe('정상 응답');
    expect('q-huge' in qr).toBe(false);
  });

  it('정상 키 + prefill 강제 복원이 공존 보존된다 (멤버십 필터가 prefill 을 깨지 않음)', async () => {
    // PREFILL_QID 와 VALID_QID 모두 유효 집합에 포함. prefill 은 숫자로 조작 제출.
    queueSelects({
      validQuestionIds: [VALID_QID, PREFILL_QID],
      attrs: { name: '홍길동' },
      prefillTemplate: '{{name}}',
      prefillQid: PREFILL_QID,
    });

    const { completeResponse } = await import(
      '@/features/survey-response/server/services/response.service'
    );

    await completeResponse({
      responseId: RESPONSE_ID,
      data: {
        questionResponses: {
          [VALID_QID]: '정상 응답',
          // 클라이언트가 prefill 을 숫자로 조작 제출 → expected 로 강제 복원되어야 함
          [PREFILL_QID]: 12345,
        },
      },
    });

    const qr = lastMainSet()['questionResponses'] as Record<string, unknown>;
    expect(qr[VALID_QID]).toBe('정상 응답');
    expect(qr[PREFILL_QID]).toBe('홍길동');
  });
});
