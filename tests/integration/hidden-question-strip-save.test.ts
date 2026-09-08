import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * 저장 경계의 숨은 문항 strip — **호출부** 계약 검증.
 *
 * 이 파일은 순수 모듈이 아니라 실제 서비스 호출부(saveAdminEdit·completeResponse)를 태운다.
 * 두 가지를 못 박는다.
 *
 * 1. 구버전 응답(migrating)에는 strip 을 걸지 않는다 — 재배포로 생기거나 좁혀진 표시
 *    조건이 이미 수집된 답을 소급해 지우면 안 된다 (스펙 결정 "이미 수집된 응답은 소급
 *    정리하지 않는다"). edit log 는 값을 남기지 않아 복구 경로가 없다.
 * 2. 순서 계약 — 숨은 문항 strip → 게이팅 strip → calc 재계산. 세 지점이 각각 주석으로만
 *    선언하던 것을 픽스처 하나로 고정한다. 어느 한 쌍이라도 뒤바뀌면 저장 결과가 달라진다.
 */

const {
  responseFindFirstMock,
  surveyFindFirstMock,
  versionFindFirstMock,
  executeMock,
  updateSetLogMock,
  updateReturningMock,
  selectLimitMock,
  selectThenMock,
  selectForUpdateMock,
  replaceResponseAnswersMock,
} = vi.hoisted(() => ({
  responseFindFirstMock: vi.fn(),
  surveyFindFirstMock: vi.fn(),
  versionFindFirstMock: vi.fn(),
  executeMock: vi.fn(),
  updateSetLogMock: vi.fn(),
  updateReturningMock: vi.fn(),
  selectLimitMock: vi.fn(),
  selectThenMock: vi.fn(),
  selectForUpdateMock: vi.fn(),
  replaceResponseAnswersMock: vi.fn(async (..._a: unknown[]) => undefined),
}));

function makeUpdateChain() {
  return {
    set: vi.fn((v: unknown) => {
      updateSetLogMock(v);
      return { where: vi.fn(() => ({ returning: vi.fn(() => updateReturningMock()) })) };
    }),
  };
}

function makeSelectChain() {
  return {
    from: vi.fn(() => ({
      where: vi.fn(() => ({
        limit: vi.fn(() => selectLimitMock()),
        for: vi.fn(() => Promise.resolve(selectForUpdateMock())),
        then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
          Promise.resolve(selectThenMock()).then(resolve, reject),
      })),
    })),
  };
}

vi.mock('@/db', () => {
  const db: Record<string, unknown> = {
    execute: (...a: unknown[]) => executeMock(...a),
    update: vi.fn(() => makeUpdateChain()),
    insert: vi.fn(() => ({ values: vi.fn(async () => undefined) })),
    select: vi.fn(() => makeSelectChain()),
    transaction: vi.fn(async (cb: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        update: vi.fn(() => makeUpdateChain()),
        insert: vi.fn(() => ({ values: vi.fn(async () => undefined) })),
        select: vi.fn(() => makeSelectChain()),
      };
      return cb(tx);
    }),
    query: {
      surveys: { findFirst: (...a: unknown[]) => surveyFindFirstMock(...a) },
      surveyResponses: { findFirst: (...a: unknown[]) => responseFindFirstMock(...a) },
      surveyVersions: { findFirst: (...a: unknown[]) => versionFindFirstMock(...a) },
    },
  };
  return { db };
});

vi.mock('@sentry/nextjs', () => ({ captureMessage: vi.fn(), captureException: vi.fn() }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/survey-control', () => ({
  getSurveyControlFlags: vi.fn(async () => ({ isPaused: false })),
  isValidTestToken: vi.fn(() => false),
}));
vi.mock('@/lib/operations/response-progress.server', () => ({
  getProgressSnapshot: vi.fn(async () => ({ positionMap: new Map(), totalQuestions: 0 })),
}));
vi.mock('@/features/survey-response/server/services/response-answers.service', () => ({
  replaceResponseAnswers: (...a: unknown[]) => replaceResponseAnswersMock(...a),
}));

const SURVEY_ID = '00000000-0000-4000-8000-0000000000s1';
const RESPONSE_ID = '00000000-0000-4000-8000-0000000000r1';
const VERSION_ID = '00000000-0000-4000-8000-0000000000v2';
const OLD_VERSION_ID = '00000000-0000-4000-8000-0000000000v1';

/** db.execute 는 멤버십 id 조회와 PII 대상 조회가 공유한다 — SQL 텍스트로 갈라 준다. */
function stubExecute(questionIds: string[]) {
  executeMock.mockImplementation((query: unknown) => {
    const chunks = (query as { queryChunks?: unknown[] }).queryChunks ?? [];
    const text = chunks
      .map((c) =>
        typeof c === 'object' && c !== null && 'value' in c
          ? String((c as { value: unknown }).value)
          : '',
      )
      .join(' ');
    if (text.includes('pii')) return Promise.resolve([]);
    return Promise.resolve(questionIds.map((id) => ({ id })));
  });
}

// ─── 픽스처 ────────────────────────────────────────────────────────────────
//
// 순서 계약을 한 벌로 고정하는 스냅샷.
//
//   q-ctrl  : 표시 조건의 상류 라디오
//   q-gate  : 게이팅 표 — gate_ctrl 이 채워져야 gate_val 이 활성
//   q-vis   : q-gate 의 gate_val 값을 보는 표시 조건 → **숨은 문항 strip 이 게이팅보다
//             먼저** 돌아야 살아남는다 (게이팅이 먼저면 gate_val 이 사라져 q-vis 가 숨는다)
//   q-hid   : q-ctrl 로 숨는 표
//   q-calc  : q-hid·q-gate 의 셀을 더하는 계산 표 → **calc 이 두 strip 뒤**라야 0 이 된다
const ORDER_QUESTIONS = [
  { id: 'q-ctrl', type: 'radio', title: '상류', order: 0 },
  {
    id: 'q-gate',
    type: 'table',
    title: '게이팅 표',
    order: 1,
    tableRowsData: [
      {
        id: 'r1',
        label: 'r1',
        cells: [
          { id: 'gate_ctrl', content: '', type: 'input', inputType: 'number' },
          {
            id: 'gate_val',
            content: '',
            type: 'input',
            inputType: 'number',
            enabledWhen: { kind: 'filled', controllerCellId: 'gate_ctrl' },
          },
        ],
      },
    ],
  },
  {
    id: 'q-vis',
    type: 'radio',
    title: '게이팅 셀을 보는 문항',
    order: 2,
    displayCondition: {
      logicType: 'AND',
      conditions: [
        {
          id: 'vis-c1',
          enabled: true,
          logicType: 'AND',
          conditionType: 'table-cell-check',
          sourceQuestionId: 'q-gate',
          tableConditions: {
            rowIds: ['r1'],
            cellColumnIndex: 1,
            checkType: 'any',
            expectedValues: ['7'],
          },
        },
      ],
    },
  },
  {
    id: 'q-hid',
    type: 'table',
    title: '숨는 표',
    order: 3,
    displayCondition: {
      logicType: 'AND',
      conditions: [
        {
          id: 'hid-c1',
          enabled: true,
          logicType: 'AND',
          conditionType: 'value-match',
          sourceQuestionId: 'q-ctrl',
          requiredValues: ['yes'],
        },
      ],
    },
    tableRowsData: [
      {
        id: 'hr1',
        label: 'hr1',
        cells: [{ id: 'hid_val', content: '', type: 'input', inputType: 'number' }],
      },
    ],
  },
  {
    id: 'q-calc',
    type: 'table',
    title: '계산 표',
    order: 4,
    tableRowsData: [
      {
        id: 'cr1',
        label: 'cr1',
        cells: [
          {
            id: 'calc_out',
            content: '',
            type: 'calc',
            formula: {
              kind: 'agg',
              fn: 'sum',
              items: [
                { kind: 'cell', questionId: 'q-hid', cellId: 'hid_val' },
                { kind: 'cell', questionId: 'q-gate', cellId: 'gate_val' },
              ],
            },
          },
        ],
      },
    ],
  },
];

/** 운영자/응답자가 제출하는 페이로드 — 세 단계가 모두 할 일이 있는 상태. */
function orderPayload(): Record<string, unknown> {
  return {
    'q-ctrl': 'no',
    'q-gate': { gate_ctrl: '', gate_val: '7' },
    'q-vis': 'kept',
    'q-hid': { hid_val: '100' },
    'q-calc': { calc_out: '999' },
  };
}

/**
 * 순서 계약 단언.
 *
 * - q-vis 생존   : 숨은 문항 strip 이 게이팅 strip 보다 먼저다
 * - q-hid 소멸   : 숨은 문항 strip 이 실제로 돈다
 * - gate_val 소멸: 게이팅 strip 이 돈다
 * - calc_out '0' : calc 이 두 strip 뒤다 (앞이면 107 / 100 / 7 이 나온다)
 */
function expectOrderContract(stored: Record<string, unknown>) {
  expect(stored['q-vis']).toBe('kept');
  expect(stored['q-hid']).toBeUndefined();
  expect(stored['q-gate']).toEqual({ gate_ctrl: '' });
  expect((stored['q-calc'] as Record<string, unknown>)['calc_out']).toBe('0');
}

/** 조건이 나중에 붙은 문항 하나짜리 스냅샷 — 소급 삭제 회귀 픽스처. */
function laterConditionSnapshot() {
  return {
    snapshot: {
      questions: [
        { id: 'q-ctrl', type: 'radio', title: '상류', order: 0 },
        {
          id: 'q-later',
          type: 'text',
          title: '나중에 조건이 붙은 문항',
          order: 1,
          displayCondition: {
            logicType: 'AND',
            conditions: [
              {
                id: 'later-c1',
                enabled: true,
                logicType: 'AND',
                conditionType: 'value-match',
                sourceQuestionId: 'q-ctrl',
                requiredValues: ['no'],
              },
            ],
          },
        },
        { id: 'q-free', type: 'text', title: '자유 문항', order: 2 },
      ],
    },
  };
}

// ─── saveAdminEdit ─────────────────────────────────────────────────────────

describe('saveAdminEdit — 숨은 문항 strip 게이트와 순서', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    surveyFindFirstMock.mockResolvedValue({ id: SURVEY_ID, currentVersionId: VERSION_ID });
    executeMock.mockResolvedValue([]);
    updateReturningMock.mockReturnValue([{ id: RESPONSE_ID }]);
  });

  it('구버전 응답을 편집해도 새 스냅샷 조건으로 이미 수집된 답을 지우지 않는다', async () => {
    // 재배포로 q-later 에 표시 조건이 새로 생겼다. 이 응답은 조건이 없던 구버전에서
    // 수집돼 q-later 에 답이 있다 — 운영자가 다른 문항만 고쳐 저장해도 살아남아야 한다.
    responseFindFirstMock.mockResolvedValue({
      id: RESPONSE_ID,
      surveyId: SURVEY_ID,
      versionId: OLD_VERSION_ID,
      deletedAt: null,
      status: 'completed',
      contactTargetId: null,
      questionResponses: { 'q-ctrl': 'yes', 'q-later': '수집된 답', 'q-free': '이전' },
    });
    selectLimitMock.mockResolvedValue([laterConditionSnapshot()]);

    const { saveAdminEdit } = await import(
      '@/features/survey-response/server/services/response-edit.service'
    );
    await saveAdminEdit(
      {
        surveyId: SURVEY_ID,
        responseId: RESPONSE_ID,
        questionResponses: { 'q-ctrl': 'yes', 'q-later': '수집된 답', 'q-free': '고침' },
        versionId: VERSION_ID,
      },
      { id: 'admin-1', email: 'a@b.com' },
      false,
    );

    const setArg = updateSetLogMock.mock.calls[0]![0] as {
      questionResponses: Record<string, unknown>;
    };
    expect(setArg.questionResponses['q-later']).toBe('수집된 답');
    expect(setArg.questionResponses['q-free']).toBe('고침');
  });

  it('같은 버전에서 편집하면 숨은 문항 값은 그대로 지운다 — 게이트가 strip 자체를 끄지 않는다', async () => {
    responseFindFirstMock.mockResolvedValue({
      id: RESPONSE_ID,
      surveyId: SURVEY_ID,
      versionId: VERSION_ID,
      deletedAt: null,
      status: 'completed',
      contactTargetId: null,
      questionResponses: { 'q-ctrl': 'yes', 'q-later': '수집된 답', 'q-free': '이전' },
    });
    selectLimitMock.mockResolvedValue([laterConditionSnapshot()]);

    const { saveAdminEdit } = await import(
      '@/features/survey-response/server/services/response-edit.service'
    );
    await saveAdminEdit(
      {
        surveyId: SURVEY_ID,
        responseId: RESPONSE_ID,
        questionResponses: { 'q-ctrl': 'yes', 'q-later': '수집된 답', 'q-free': '고침' },
        versionId: VERSION_ID,
      },
      { id: 'admin-1', email: 'a@b.com' },
      false,
    );

    const setArg = updateSetLogMock.mock.calls[0]![0] as {
      questionResponses: Record<string, unknown>;
    };
    expect(setArg.questionResponses['q-later']).toBeUndefined();
  });

  it('숨은 문항 strip → 게이팅 strip → calc 재계산 순서로 저장한다', async () => {
    responseFindFirstMock.mockResolvedValue({
      id: RESPONSE_ID,
      surveyId: SURVEY_ID,
      versionId: VERSION_ID,
      deletedAt: null,
      status: 'completed',
      contactTargetId: null,
      // 클라 diff 를 만들어 스냅샷 조회 경로를 태우기 위한 이전 값.
      questionResponses: { 'q-ctrl': 'yes' },
    });
    selectLimitMock.mockResolvedValue([{ snapshot: { questions: ORDER_QUESTIONS } }]);

    const { saveAdminEdit } = await import(
      '@/features/survey-response/server/services/response-edit.service'
    );
    await saveAdminEdit(
      {
        surveyId: SURVEY_ID,
        responseId: RESPONSE_ID,
        questionResponses: orderPayload(),
        versionId: VERSION_ID,
      },
      { id: 'admin-1', email: 'a@b.com' },
      false,
    );

    const setArg = updateSetLogMock.mock.calls[0]![0] as {
      questionResponses: Record<string, unknown>;
    };
    expectOrderContract(setArg.questionResponses);
  });
});

// ─── completeResponse ──────────────────────────────────────────────────────

describe('completeResponse — 숨은 문항 strip 순서', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    responseFindFirstMock.mockResolvedValue({
      surveyId: SURVEY_ID,
      versionId: VERSION_ID,
      contactTargetId: null,
      isTest: false,
    });
    surveyFindFirstMock.mockResolvedValue({
      id: SURVEY_ID,
      status: 'published',
      endDate: null,
      maxResponses: null,
      isPublic: true,
      requireInviteToken: false,
      currentVersionId: VERSION_ID,
      isPaused: false,
      testModeEnabled: false,
      testToken: null,
    });
    versionFindFirstMock.mockResolvedValue({ surveyId: SURVEY_ID, status: 'published' });
    selectThenMock.mockReturnValue([{ total: 0 }]);
    selectLimitMock.mockResolvedValue([{ snapshot: { questions: ORDER_QUESTIONS } }]);
    stubExecute(ORDER_QUESTIONS.map((q) => q.id));
    updateReturningMock.mockReturnValue([
      { id: RESPONSE_ID, surveyId: SURVEY_ID, contactTargetId: null, pageVisits: null },
    ]);
  });

  it('숨은 문항 strip → 게이팅 strip → calc 재계산 순서로 저장한다', async () => {
    const { completeResponse } = await import(
      '@/features/survey-response/server/services/response.service'
    );
    await completeResponse({
      responseId: RESPONSE_ID,
      data: { questionResponses: orderPayload() },
    });

    const setArg = updateSetLogMock.mock.calls[0]![0] as {
      questionResponses: Record<string, unknown>;
    };
    expectOrderContract(setArg.questionResponses);
  });

  it('페이로드 없는 빈 complete 의 잠금 아래 재계산도 같은 순서를 지킨다', async () => {
    // 초안으로 저장돼 있던 값(유령값 포함)을 row lock 아래에서 읽어 다시 태우는 경로.
    selectForUpdateMock.mockReturnValue([{ questionResponses: orderPayload() }]);

    const { completeResponse } = await import(
      '@/features/survey-response/server/services/response.service'
    );
    await completeResponse({ responseId: RESPONSE_ID });

    const setArg = updateSetLogMock.mock.calls[0]![0] as {
      questionResponses: Record<string, unknown>;
    };
    expectOrderContract(setArg.questionResponses);
  });
});
