import { describe, expect, it, vi, beforeEach } from 'vitest';

// ========================
// 모듈 모킹
// ========================
// completeResponse 의 prefill 재검증 로직을 검증한다.
// defaultValueTemplate 이 있는 질문의 응답값은 contact_targets.attrs 로 치환한
// expected 와 일치해야 하며, 클라이언트가 우회 조작하면 서버에서 expected 로 강제 복원된다.
//
// 핵심 회귀: 조작값이 문자열이 아닌 타입(숫자/배열 등)이어도 복원되어야 한다.
// (이전 코드는 typeof submitted === 'string' 가드 때문에 비문자열 조작을 통과시켰다.)
//
// db 는 drizzle fluent chain 흉내. select 종단(.limit / 직접 await 되는 .where)은
// 호출 순서대로 큐잉된 결과를 돌려주고, 트랜잭션 내부 메인 UPDATE 의 .set() 인자를
// 캡처해 questionResponses 에 기록되는 최종값을 검증한다.

const {
  selectTerminalQueue,
  capturedUpdateSets,
  updateReturningMock,
} = vi.hoisted(() => ({
  selectTerminalQueue: [] as unknown[][],
  capturedUpdateSets: [] as Record<string, unknown>[],
  updateReturningMock: vi.fn(),
}));

vi.mock('@/db', () => {
  function nextSelectTerminal(): unknown[] {
    return selectTerminalQueue.shift() ?? [];
  }

  // select 체인: .from -> .where -> (.limit | 직접 await)
  // .where() 와 .limit() 둘 다 종단이 될 수 있으므로, 둘 다 thenable 로 만들어
  // 큐의 다음 결과를 resolve 한다. 단, .where() 뒤에 .limit() 이 또 오면
  // .limit() 종단이 우선하도록 .where() 는 큐를 소비하지 않고 chainable 을 돌려준다.
  // prefillQuestions 만 .where() 로 끝나므로, .where() 가 chainable 이면서
  // thenable 이도록 만들어 await 시 큐를 소비하게 한다.
  function makeSelectChain(): Record<string, unknown> {
    const chain: Record<string, unknown> = {};
    chain['from'] = vi.fn(() => chain);
    chain['where'] = vi.fn(() => {
      // .where() 자체를 thenable 로 — 뒤에 .limit() 이 붙으면 그쪽이 우선 소비
      const whereResult: Record<string, unknown> = {
        limit: vi.fn(() => Promise.resolve(nextSelectTerminal())),
        then: (resolve: (v: unknown) => unknown) =>
          resolve(nextSelectTerminal()),
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
    // totalSeconds 정정 UPDATE 는 .where() 로 끝나고 await 됨 → thenable
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
    // 가용성 게이트(#3): 완료 진입부에서 응답 행 + 설문 행을 조회한다.
    query: {
      surveyResponses: {
        findFirst: vi.fn(async () => ({
          surveyId: SURVEY_ID,
          versionId: null,
          contactTargetId: CONTACT_TARGET_ID,
        })),
      },
      surveys: {
        // maxResponses=null 인 published 설문 — 정원/마감 게이트 통과.
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
  replaceResponseAnswers: vi.fn(async () => undefined),
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
const PREFILL_QID = 'q-prefill';

function queueSelects(opts: {
  attrs: Record<string, string>;
  template: string;
}) {
  // 호출 순서: 0) 가용성 게이트 완료 카운트  1) 유효 questionId 집합(loadValidQuestionIds)
  //           2) contactTargets  3) prefillQuestions
  // (prefill 의 contactTargetId/surveyId 는 gateRow 재사용으로 별도 responseRow select 없음)
  // 유효 집합은 prefill 질문(PREFILL_QID)과 비-prefill 키('other')를 포함해 멤버십 필터를 통과시킨다.
  selectTerminalQueue.length = 0;
  selectTerminalQueue.push(
    [{ total: 0 }],
    [{ id: PREFILL_QID }, { id: 'other' }],
    [{ attrs: opts.attrs }],
    [{ id: PREFILL_QID, template: opts.template }],
  );
}

describe('completeResponse — prefill 재검증 (비문자열 우회 조작 방지)', () => {
  beforeEach(() => {
    capturedUpdateSets.length = 0;
    selectTerminalQueue.length = 0;
    updateReturningMock.mockReset();
    updateReturningMock.mockResolvedValue([
      {
        id: RESPONSE_ID,
        surveyId: SURVEY_ID,
        contactTargetId: null,
        pageVisits: null,
      },
    ]);
  });

  it('비문자열(숫자)로 조작된 prefill 값을 expected 문자열로 강제 복원한다', async () => {
    queueSelects({ attrs: { name: '홍길동' }, template: '{{name}}' });

    const { completeResponse } = await import(
      '@/features/survey-response/server/services/response.service'
    );

    await completeResponse({
      responseId: RESPONSE_ID,
      // 클라이언트가 문자열이 아닌 숫자로 조작 제출
      data: { questionResponses: { [PREFILL_QID]: 12345 } },
    });

    const mainSet = capturedUpdateSets.find(
      (s) => s['questionResponses'] !== undefined,
    );
    expect(mainSet).toBeDefined();
    expect(
      (mainSet!['questionResponses'] as Record<string, unknown>)[PREFILL_QID],
    ).toBe('홍길동');
  });

  it('비문자열(배열)로 조작된 prefill 값도 강제 복원한다', async () => {
    queueSelects({ attrs: { name: '홍길동' }, template: '{{name}}' });

    const { completeResponse } = await import(
      '@/features/survey-response/server/services/response.service'
    );

    await completeResponse({
      responseId: RESPONSE_ID,
      data: { questionResponses: { [PREFILL_QID]: ['tampered'] } },
    });

    const mainSet = capturedUpdateSets.find(
      (s) => s['questionResponses'] !== undefined,
    );
    expect(
      (mainSet!['questionResponses'] as Record<string, unknown>)[PREFILL_QID],
    ).toBe('홍길동');
  });

  it('expected 와 일치하는 정상 문자열 응답은 그대로 보존한다', async () => {
    queueSelects({ attrs: { name: '홍길동' }, template: '{{name}}' });

    const { completeResponse } = await import(
      '@/features/survey-response/server/services/response.service'
    );

    await completeResponse({
      responseId: RESPONSE_ID,
      data: { questionResponses: { [PREFILL_QID]: '홍길동' } },
    });

    const mainSet = capturedUpdateSets.find(
      (s) => s['questionResponses'] !== undefined,
    );
    expect(
      (mainSet!['questionResponses'] as Record<string, unknown>)[PREFILL_QID],
    ).toBe('홍길동');
  });

  it('응답에 포함되지 않은(미노출) prefill 질문에는 허위 답변을 주입하지 않는다', async () => {
    queueSelects({ attrs: { name: '홍길동' }, template: '{{name}}' });

    const { completeResponse } = await import(
      '@/features/survey-response/server/services/response.service'
    );

    await completeResponse({
      responseId: RESPONSE_ID,
      // prefill 질문 키가 제출에 아예 없음 (조건부로 숨겨진 질문)
      data: { questionResponses: { other: 'value' } },
    });

    const mainSet = capturedUpdateSets.find(
      (s) => s['questionResponses'] !== undefined,
    );
    const qr = mainSet!['questionResponses'] as Record<string, unknown>;
    expect(PREFILL_QID in qr).toBe(false);
  });
});
