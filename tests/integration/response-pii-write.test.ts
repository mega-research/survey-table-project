import { beforeEach, describe, expect, it, vi } from 'vitest';

process.env['CONTACT_PII_AES_KEY'] = Buffer.alloc(32, 7).toString('base64');

vi.mock('@sentry/nextjs', () => ({ captureMessage: vi.fn() }));

const {
  responseFindFirstMock,
  surveyFindFirstMock,
  versionFindFirstMock,
  executeMock,
  updateSetLogMock,
  updateReturningMock,
  insertValuesLogMock,
  insertReturningMock,
  editLogValuesMock,
  selectLimitMock,
  selectThenMock,
  flagsMock,
  headersMock,
  computeSignalsMock,
  checkTrackAMock,
  checkTrackBMock,
  replaceResponseAnswersMock,
} = vi.hoisted(() => ({
  responseFindFirstMock: vi.fn(),
  surveyFindFirstMock: vi.fn(),
  versionFindFirstMock: vi.fn(),
  executeMock: vi.fn(),
  updateSetLogMock: vi.fn(),
  updateReturningMock: vi.fn(),
  // createResponseWithFirstAnswer 의 db.insert(...).values(v) 인자 캡쳐 — INSERT 자체에
  // 평문이 닿지 않는지 검증하는 데 사용한다.
  insertValuesLogMock: vi.fn(),
  insertReturningMock: vi.fn(),
  // saveAdminEdit 트랜잭션 안 responseEditLogs insert 의 values 인자 캡쳐.
  editLogValuesMock: vi.fn(),
  // select().from().where().limit() 종단 (버전 스냅샷 조회 등)
  selectLimitMock: vi.fn(),
  // select().from().where() 직접 await 종단 (countCompletedResponses 등 thenable)
  selectThenMock: vi.fn(),
  flagsMock: vi.fn(),
  headersMock: vi.fn(),
  computeSignalsMock: vi.fn(),
  checkTrackAMock: vi.fn(),
  checkTrackBMock: vi.fn(),
  replaceResponseAnswersMock: vi.fn(async (..._a: unknown[]) => undefined),
}));

function makeUpdateChain() {
  return {
    set: vi.fn((v: unknown) => {
      updateSetLogMock(v);
      return {
        where: vi.fn(() => ({ returning: vi.fn(() => updateReturningMock()) })),
      };
    }),
  };
}

function makeInsertChain() {
  return {
    values: vi.fn((v: unknown) => {
      insertValuesLogMock(v);
      return {
        onConflictDoNothing: vi.fn(() => ({
          returning: vi.fn(() => insertReturningMock()),
        })),
      };
    }),
  };
}

function makeSelectChain() {
  return {
    from: vi.fn(() => ({
      where: vi.fn(() => ({
        limit: vi.fn(() => selectLimitMock()),
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
    insert: vi.fn(() => makeInsertChain()),
    select: vi.fn(() => makeSelectChain()),
    transaction: vi.fn(async (cb: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        update: vi.fn(() => makeUpdateChain()),
        // saveAdminEdit 의 유일한 트랜잭션 insert 는 responseEditLogs — values 인자를 기록해
        // "변경 0건이면 edit log 미생성" 을 검증한다.
        insert: vi.fn(() => ({
          values: vi.fn(async (v: unknown) => {
            editLogValuesMock(v);
          }),
        })),
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

// updateQuestionResponse 가 참조하는 제어 플래그 조회 목 (실제 import 경로: @/lib/survey-control)
vi.mock('@/lib/survey-control', () => ({
  getSurveyControlFlags: (...a: unknown[]) => flagsMock(...a),
  isValidTestToken: vi.fn(() => false),
}));

// createResponseWithFirstAnswer 의 UA 파싱(next/headers) + 중복 감지 신호/검사 목.
vi.mock('next/headers', () => ({ headers: (...a: unknown[]) => headersMock(...a) }));
vi.mock('@/lib/duplicate-detection/signals', () => ({
  computeSignals: (...a: unknown[]) => computeSignalsMock(...a),
}));
vi.mock('@/lib/duplicate-detection/check', () => ({
  checkTrackA: (...a: unknown[]) => checkTrackAMock(...a),
  checkTrackB: (...a: unknown[]) => checkTrackBMock(...a),
}));

// completeResponse / saveAdminEdit 이 공유하는 정규화 저장 — 전달된 맵의 암호화 여부를 검증한다.
vi.mock('@/features/survey-response/server/services/response-answers.service', () => ({
  replaceResponseAnswers: (...a: unknown[]) => replaceResponseAnswersMock(...a),
}));

/**
 * db.update(...).set(v) 에 전달되는 v 는 drizzle sql`` 청크(SQL/StringChunk/Param/Column)를
 * 값으로 갖는 객체다. Column/Table 인스턴스는 서로를 순환 참조하므로 JSON.stringify 가
 * 그대로는 불가능(circular structure) — queryChunks/StringChunk.value/Param.value 만
 * 재귀적으로 따라가 원시값(string/number/boolean)을 모아 하나의 문자열로 합친다.
 * Column/Table 등 인식하지 못하는 객체는 순회하지 않고 건너뛴다(순환 회피).
 */
function collectSqlChunkStrings(node: unknown, out: string[], seen: Set<unknown>): void {
  if (node === null || node === undefined) return;
  if (typeof node === 'string') {
    out.push(node);
    return;
  }
  if (typeof node === 'number' || typeof node === 'boolean') {
    out.push(String(node));
    return;
  }
  if (typeof node !== 'object') return;
  if (seen.has(node)) return;
  seen.add(node);

  if (Array.isArray(node)) {
    for (const item of node) collectSqlChunkStrings(item, out, seen);
    return;
  }

  const obj = node as Record<string, unknown>;
  if (Array.isArray(obj['queryChunks'])) {
    collectSqlChunkStrings(obj['queryChunks'], out, seen);
    return;
  }
  if ('value' in obj && (Array.isArray(obj['value']) || typeof obj['value'] === 'string')) {
    collectSqlChunkStrings(obj['value'], out, seen);
    return;
  }
  // 순수 객체 리터럴({} 프로토타입)은 set() 인자 최상위 객체(questionResponses/progressPct 키)
  // 이므로 값들을 재귀 순회한다. Column/Table 등 drizzle 내부 클래스 인스턴스는 순환 참조
  // 가능성이 있어(프로토타입이 Object.prototype 이 아님) 여기서 걸러 건너뛴다.
  const proto = Object.getPrototypeOf(obj);
  if (proto === Object.prototype || proto === null) {
    for (const v of Object.values(obj)) collectSqlChunkStrings(v, out, seen);
  }
}

function extractSqlSetParams(setArg: Record<string, unknown>): string {
  const out: string[] = [];
  collectSqlChunkStrings(setArg, out, new Set());
  return out.join('\n');
}

/** db.execute 에 전달된 drizzle sql 객체의 텍스트+파라미터를 한 문자열로 평탄화. */
function sqlText(query: unknown): string {
  const out: string[] = [];
  collectSqlChunkStrings(query, out, new Set());
  return out.join('\n');
}

const RESPONSE_ID = '00000000-0000-4000-8000-00000000r001';
const VERSION_ID = '00000000-0000-4000-8000-00000000v001';
const SURVEY_ID = '00000000-0000-4000-8000-00000000s001';
const QUESTION_ID = 'q-pii-1';
const PLAIN_QUESTION_ID = 'q-plain-1';
const PII_PLAINTEXT = '010-1234-5678';

/** 가용성 게이트를 통과하는 published 설문 행 (loadSurveyGateRow 형태). */
function publishedSurveyRow() {
  return {
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
  };
}

describe('updateQuestionResponse — PII 문항 암호화', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    responseFindFirstMock.mockResolvedValue({
      id: RESPONSE_ID,
      surveyId: SURVEY_ID,
      versionId: VERSION_ID,
      isTest: false,
    });
    flagsMock.mockResolvedValue({ isPaused: false });
    updateReturningMock.mockReturnValue([{ id: RESPONSE_ID }]);
  });

  it('스냅샷에서 piiEncrypted=true 면 jsonb_set 값이 v1: 암호문이다', async () => {
    executeMock.mockResolvedValue([{ pii: true }]);
    const { updateQuestionResponse } = await import(
      '@/features/survey-response/server/services/response.service'
    );
    await updateQuestionResponse({
      responseId: RESPONSE_ID,
      questionId: QUESTION_ID,
      value: PII_PLAINTEXT,
    });
    // set() 에 전달된 questionResponses sql 청크에서 원시 파라미터 문자열을 수집한다
    // (JSON.stringify 는 Column/Table 순환 참조로 불가 — collectSqlChunkStrings 사용).
    const setArg = updateSetLogMock.mock.calls[0]![0] as Record<string, unknown>;
    const serialized = extractSqlSetParams(setArg);
    expect(serialized).not.toContain(PII_PLAINTEXT);
    expect(serialized).toMatch(/v\d+:/);
  });

  it('piiEncrypted=false 면 평문 그대로 저장한다', async () => {
    executeMock.mockResolvedValue([{ pii: false }]);
    const { updateQuestionResponse } = await import(
      '@/features/survey-response/server/services/response.service'
    );
    await updateQuestionResponse({
      responseId: RESPONSE_ID,
      questionId: QUESTION_ID,
      value: '평문 답변',
    });
    const setArg = updateSetLogMock.mock.calls[0]![0] as Record<string, unknown>;
    expect(extractSqlSetParams(setArg)).toContain('평문 답변');
  });
});

describe('createResponseWithFirstAnswer — 첫 답변 INSERT 전 암호화', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    headersMock.mockResolvedValue({ get: vi.fn(() => 'test-agent') });
    computeSignalsMock.mockReturnValue({ ipHash: 'ip-h', fpHash: 'fp-h', deviceId: 'dev-1' });
    checkTrackBMock.mockResolvedValue({ blocked: false });
    surveyFindFirstMock.mockResolvedValue(publishedSurveyRow());
    // loadValidatedVersionGateRow: 동일 surveyId + published 여야 통과.
    versionFindFirstMock.mockResolvedValue({ surveyId: SURVEY_ID, status: 'published' });
    // assertQuestionBelongsToResponse (create 진입부 + 후속 updateQuestionResponse) — PII 문항.
    executeMock.mockResolvedValue([{ pii: true }]);
    insertReturningMock.mockResolvedValue([{ id: RESPONSE_ID, contactTargetId: null }]);
    // 후속 updateQuestionResponse 내부 경로
    responseFindFirstMock.mockResolvedValue({
      id: RESPONSE_ID,
      surveyId: SURVEY_ID,
      versionId: VERSION_ID,
      isTest: false,
    });
    flagsMock.mockResolvedValue({ isPaused: false });
    updateReturningMock.mockReturnValue([{ id: RESPONSE_ID }]);
  });

  it('INSERT values 의 questionResponses 값이 평문이 아닌 v1: 암호문이다', async () => {
    const { createResponseWithFirstAnswer } = await import(
      '@/features/survey-response/server/services/response.service'
    );
    const result = await createResponseWithFirstAnswer({
      surveyId: SURVEY_ID,
      sessionId: 'sess-1',
      versionId: VERSION_ID,
      questionId: QUESTION_ID,
      value: PII_PLAINTEXT,
      currentStepId: 'step-1',
      clientSignals: {
        deviceId: 'dev-1',
        screen: '1440x900',
        tz: 'Asia/Seoul',
        lang: 'ko',
        platform: 'MacIntel',
      },
    });
    expect(result.kind).toBe('created');

    // 핵심: 후속 updateQuestionResponse 전달값이 아니라 INSERT 자체의 values 를 검증한다 —
    // 평문이 순간이라도 DB(WAL 포함)에 닿지 않아야 한다.
    expect(insertValuesLogMock).toHaveBeenCalledTimes(1);
    const inserted = insertValuesLogMock.mock.calls[0]![0] as {
      questionResponses: Record<string, unknown>;
    };
    const storedValue = inserted.questionResponses[QUESTION_ID];
    expect(String(storedValue)).toMatch(/^v\d+:/);
    expect(JSON.stringify(inserted.questionResponses)).not.toContain(PII_PLAINTEXT);

    // 후속 updateQuestionResponse(첫 답변 머지)도 동일 암호문을 받아 이중 암호화 없이 통과한다.
    const setArg = updateSetLogMock.mock.calls[0]![0] as Record<string, unknown>;
    const serialized = extractSqlSetParams(setArg);
    expect(serialized).not.toContain(PII_PLAINTEXT);
    expect(serialized).toContain(String(storedValue));
  });
});

describe('completeResponse — PII 문항만 선별 암호화', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // gateRow 조회 (contactTargetId null → prefill 재검증 내부 skip)
    responseFindFirstMock.mockResolvedValue({
      surveyId: SURVEY_ID,
      versionId: VERSION_ID,
      contactTargetId: null,
      isTest: false,
    });
    surveyFindFirstMock.mockResolvedValue(publishedSurveyRow());
    versionFindFirstMock.mockResolvedValue({ surveyId: SURVEY_ID, status: 'published' });
    // countCompletedResponses — select().from().where() 직접 await.
    selectThenMock.mockReturnValue([{ total: 0 }]);
    // 같은 db.execute 를 loadValidQuestionIds(전체 id)와 loadPiiQuestionIds(PII id)가
    // 순서대로 호출한다 — SQL 텍스트의 piiEncrypted IS TRUE 필터 유무로 분기해
    // 호출 순서 변화에도 깨지지 않게 한다.
    executeMock.mockImplementation((query: unknown) => {
      if (sqlText(query).includes('IS TRUE')) {
        return Promise.resolve([{ id: QUESTION_ID }]);
      }
      return Promise.resolve([{ id: QUESTION_ID }, { id: PLAIN_QUESTION_ID }]);
    });
    // 트랜잭션 UPDATE 1 — sumActiveSeconds(null)=null 로 totalSeconds 정정 UPDATE 는 skip,
    // contactTargetId null 로 후처리 UPDATE 도 skip.
    updateReturningMock.mockReturnValue([
      { id: RESPONSE_ID, surveyId: SURVEY_ID, contactTargetId: null, pageVisits: null },
    ]);
  });

  it('트랜잭션 set 의 questionResponses 에서 PII 값만 암호문이고 비PII 는 평문이다', async () => {
    const { completeResponse } = await import(
      '@/features/survey-response/server/services/response.service'
    );
    await completeResponse({
      responseId: RESPONSE_ID,
      data: {
        questionResponses: {
          [QUESTION_ID]: PII_PLAINTEXT,
          [PLAIN_QUESTION_ID]: '평문 답변',
        },
      },
    });

    const setArg = updateSetLogMock.mock.calls[0]![0] as {
      questionResponses?: Record<string, unknown>;
    };
    const storedMap = setArg.questionResponses as Record<string, unknown>;
    expect(String(storedMap[QUESTION_ID])).toMatch(/^v\d+:/);
    expect(storedMap[PLAIN_QUESTION_ID]).toBe('평문 답변');
    expect(JSON.stringify(storedMap)).not.toContain(PII_PLAINTEXT);
  });

  it('replaceResponseAnswers 도 동일하게 암호화된 맵을 받는다', async () => {
    const { completeResponse } = await import(
      '@/features/survey-response/server/services/response.service'
    );
    await completeResponse({
      responseId: RESPONSE_ID,
      data: {
        questionResponses: {
          [QUESTION_ID]: PII_PLAINTEXT,
          [PLAIN_QUESTION_ID]: '평문 답변',
        },
      },
    });

    expect(replaceResponseAnswersMock).toHaveBeenCalledTimes(1);
    const answersMap = replaceResponseAnswersMock.mock.calls[0]![3] as Record<string, unknown>;
    expect(String(answersMap[QUESTION_ID])).toMatch(/^v\d+:/);
    expect(answersMap[PLAIN_QUESTION_ID]).toBe('평문 답변');
    expect(JSON.stringify(answersMap)).not.toContain(PII_PLAINTEXT);
  });
});

describe('saveAdminEdit — 복호화 diff 안정성 + 재암호화 저장', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    // 실제 encryptAnswerValue 로 만든 암호문이 DB prev 에 저장돼 있는 상황을 재현한다.
    const { encryptAnswerValue } = await import('@/lib/crypto/response-pii');
    const prevCipher = encryptAnswerValue(PII_PLAINTEXT);

    // 소유권 검증 (db.query.surveys.findFirst)
    surveyFindFirstMock.mockResolvedValue({ id: SURVEY_ID });
    // 기존 응답 행 — status=completed 라 progress 재계산(getProgressSnapshot)은 타지 않는다.
    responseFindFirstMock.mockResolvedValue({
      id: RESPONSE_ID,
      surveyId: SURVEY_ID,
      versionId: VERSION_ID,
      deletedAt: null,
      status: 'completed',
      questionResponses: {
        [QUESTION_ID]: prevCipher,
        [PLAIN_QUESTION_ID]: '기존 답변',
      },
    });
    // loadPiiQuestionIds (versionId 분기, db.execute)
    executeMock.mockResolvedValue([{ id: QUESTION_ID }]);
    // diff 발생 시 버전 스냅샷 조회 — select().from().where().limit(1)
    selectLimitMock.mockResolvedValue([
      {
        snapshot: {
          questions: [
            { id: QUESTION_ID, title: '연락처' },
            { id: PLAIN_QUESTION_ID, title: '일반 질문' },
          ],
        },
      },
    ]);
    updateReturningMock.mockReturnValue([{ id: RESPONSE_ID }]);
  });

  it('동일 평문 재제출이면 edit log 를 만들지 않고, 저장 맵의 PII 는 다시 암호문이다', async () => {
    const { saveAdminEdit } = await import(
      '@/features/survey-response/server/services/response-edit.service'
    );
    await saveAdminEdit(
      {
        surveyId: SURVEY_ID,
        responseId: RESPONSE_ID,
        // DB 의 prev 는 암호문이지만 어드민 폼은 복호화된 평문을 그대로 재제출한다 —
        // 복호화 diff 가 없으면 손대지 않은 PII 문항이 매번 "변경됨"으로 기록된다.
        questionResponses: {
          [QUESTION_ID]: PII_PLAINTEXT,
          [PLAIN_QUESTION_ID]: '기존 답변',
        },
      },
      { id: 'admin-1', email: 'a@b.com' },
    );

    // 변경 0건 → responseEditLogs insert 미호출.
    expect(editLogValuesMock).not.toHaveBeenCalled();

    // 저장 맵은 재암호화 — 평문 PII 가 DB 에 남지 않는다.
    const setArg = updateSetLogMock.mock.calls[0]![0] as {
      questionResponses: Record<string, unknown>;
    };
    expect(String(setArg.questionResponses[QUESTION_ID])).toMatch(/^v\d+:/);
    expect(JSON.stringify(setArg.questionResponses)).not.toContain(PII_PLAINTEXT);
  });

  it('비PII 문항만 변경하면 edit log 에 그 문항만 기록되고 PII 값은 암호문으로 저장된다', async () => {
    const { saveAdminEdit } = await import(
      '@/features/survey-response/server/services/response-edit.service'
    );
    await saveAdminEdit(
      {
        surveyId: SURVEY_ID,
        responseId: RESPONSE_ID,
        questionResponses: {
          [QUESTION_ID]: PII_PLAINTEXT,
          [PLAIN_QUESTION_ID]: '수정된 답변',
        },
      },
      { id: 'admin-1', email: 'a@b.com' },
    );

    // 변경은 비PII 문항 1건만 — PII 문항이 diff 에 끼지 않는다.
    expect(editLogValuesMock).toHaveBeenCalledTimes(1);
    const logValues = editLogValuesMock.mock.calls[0]![0] as {
      changedQuestions: Array<{ questionId: string }>;
      changedCount: number;
    };
    expect(logValues.changedCount).toBe(1);
    expect(logValues.changedQuestions.map((c) => c.questionId)).toEqual([PLAIN_QUESTION_ID]);

    // 저장 맵: PII 는 암호문, 비PII 는 평문.
    const setArg = updateSetLogMock.mock.calls[0]![0] as {
      questionResponses: Record<string, unknown>;
    };
    expect(String(setArg.questionResponses[QUESTION_ID])).toMatch(/^v\d+:/);
    expect(setArg.questionResponses[PLAIN_QUESTION_ID]).toBe('수정된 답변');
    expect(JSON.stringify(setArg.questionResponses)).not.toContain(PII_PLAINTEXT);

    // replaceResponseAnswers 도 암호화된 맵을 받는다.
    expect(replaceResponseAnswersMock).toHaveBeenCalledTimes(1);
    const answersMap = replaceResponseAnswersMock.mock.calls[0]![3] as Record<string, unknown>;
    expect(String(answersMap[QUESTION_ID])).toMatch(/^v\d+:/);
    expect(answersMap[PLAIN_QUESTION_ID]).toBe('수정된 답변');
  });
});
