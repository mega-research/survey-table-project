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
  selectForUpdateMock,
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
  // select().from().where().for('update') 종단 — 빈 complete 의 row lock 재계산 읽기
  selectForUpdateMock: vi.fn(),
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

  // 회귀 가드: 암호화 판단이 스냅샷 ∪ 현재 questions 플래그 합집합인지는 SQL 문자열 조각의
  // 존재 여부로만 확인 가능하다 — mock 은 SQL 을 실행하지 않으므로 UNION 의 실제 동작(즉
  // "스냅샷에 없어도 라이브 플래그가 켜져 있으면 true") 자체는 이 테스트로 검증되지 않는다.
  // 그 의미론은 실DB 테스트(*.realdb.test.ts) 영역이며, 여기서는 assertQuestionBelongsToResponse
  // 가 보내는 쿼리 텍스트에 live 서브셀렉트 조각이 실수로 빠지지 않았는지만 가드한다.
  it('assert 쿼리 SQL 텍스트에 live 합집합 조각(FROM questions 서브셀렉트 + OR COALESCE)이 포함된다', async () => {
    executeMock.mockResolvedValue([{ pii: true }]);
    const { updateQuestionResponse } = await import(
      '@/features/survey-response/server/services/response.service'
    );
    await updateQuestionResponse({
      responseId: RESPONSE_ID,
      questionId: QUESTION_ID,
      value: PII_PLAINTEXT,
    });
    const queryArg = executeMock.mock.calls[0]![0];
    const text = sqlText(queryArg);
    expect(text).toContain('FROM questions');
    expect(text).toContain('OR COALESCE');
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
    insertReturningMock.mockResolvedValue([
      { id: RESPONSE_ID, contactTargetId: null, status: 'in_progress' },
    ]);
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

  it('평문이 상한 이하라도 암호문이 상한을 넘으면 INSERT 이전에 거부한다', async () => {
    const { createResponseWithFirstAnswer } = await import(
      '@/features/survey-response/server/services/response.service'
    );
    // 평문 220KB(<256KB) → 암호문 약 293KB(>256KB). 이 경로의 판정 기준은 저장될 값이다.
    await expect(
      createResponseWithFirstAnswer({
        surveyId: SURVEY_ID,
        sessionId: 'sess-1',
        versionId: VERSION_ID,
        questionId: QUESTION_ID,
        value: 'a'.repeat(220 * 1024),
        currentStepId: 'step-1',
        clientSignals: {
          deviceId: 'dev-1',
          screen: '1440x900',
          tz: 'Asia/Seoul',
          lang: 'ko',
          platform: 'MacIntel',
        },
      }),
    ).rejects.toMatchObject({ reason: 'answer_value_too_large' });
    expect(insertValuesLogMock).not.toHaveBeenCalled();
    expect(updateSetLogMock).not.toHaveBeenCalled();
  });
});

describe('createResponseWithFirstAnswer — 컨택 재사용 draftSeq 전달', () => {
  const CONTACT_ID = '00000000-0000-4000-8000-00000000c001';

  beforeEach(() => {
    vi.clearAllMocks();
    headersMock.mockResolvedValue({ get: vi.fn(() => 'test-agent') });
    computeSignalsMock.mockReturnValue({ ipHash: 'ip-h', fpHash: 'fp-h', deviceId: 'dev-1' });
    surveyFindFirstMock.mockResolvedValue(publishedSurveyRow());
    versionFindFirstMock.mockResolvedValue({ surveyId: SURVEY_ID, status: 'published' });
    executeMock.mockResolvedValue([{ pii: false }]);
    responseFindFirstMock.mockResolvedValue({
      id: RESPONSE_ID,
      surveyId: SURVEY_ID,
      versionId: VERSION_ID,
      isTest: false,
    });
    flagsMock.mockResolvedValue({ isPaused: false });
    updateReturningMock.mockReturnValue([{ id: RESPONSE_ID }]);
  });

  it('컨택 재사용 시 기존 행의 draftSeq 를 응답에 실어 보낸다 — resume 이 호출되지 않는 경로(다른 기기·시크릿창)의 seed 용', async () => {
    // Track A: 초대 토큰이 활성 컨택에 매칭됐다고 판정.
    checkTrackAMock.mockResolvedValue({
      blocked: false,
      contactTargetId: CONTACT_ID,
      isTestTarget: false,
    });
    // findActiveResponseByContact — 동일 컨택의 미완료 응답 행이 이미 있고, 1차 세션에서
    // draftSeq=7 까지 올라가 있다.
    selectLimitMock.mockResolvedValueOnce([
      {
        id: RESPONSE_ID,
        contactTargetId: CONTACT_ID,
        metadata: { draftSeq: 7 },
        status: 'in_progress',
      },
    ]);

    const { createResponseWithFirstAnswer } = await import(
      '@/features/survey-response/server/services/response.service'
    );
    const result = await createResponseWithFirstAnswer({
      surveyId: SURVEY_ID,
      sessionId: 'sess-new-device',
      versionId: VERSION_ID,
      questionId: PLAIN_QUESTION_ID,
      value: '새 기기에서 입력',
      currentStepId: 'step-1',
      inviteToken: 'invite-1',
      clientSignals: {
        deviceId: 'dev-1',
        screen: '1440x900',
        tz: 'Asia/Seoul',
        lang: 'ko',
        platform: 'MacIntel',
      },
    });

    expect(result).toMatchObject({ kind: 'created', id: RESPONSE_ID, draftSeq: 7 });
    // 재사용 분기이므로 새 INSERT 는 일어나지 않는다.
    expect(insertValuesLogMock).not.toHaveBeenCalled();
  });

  // 회귀: sweep_stale_sessions() 가 3시간 유휴 행을 drop 으로 바꿔도 is_completed 는 false 라
  // findActiveResponseByContact 가 그 행을 집어온다. 예전에는 곧바로 첫 답변 UPDATE 를
  // 시도해 status='in_progress' 가드에 0행으로 걸려 '응답을 수정할 수 없습니다.' 500 이 났다.
  it('drop 으로 쓸려간 행을 물려받으면 in_progress 로 되살려 재사용한다', async () => {
    checkTrackAMock.mockResolvedValue({
      blocked: false,
      contactTargetId: CONTACT_ID,
      isTestTarget: false,
    });
    selectLimitMock.mockResolvedValueOnce([
      { id: RESPONSE_ID, contactTargetId: CONTACT_ID, metadata: null, status: 'drop' },
    ]);

    const { createResponseWithFirstAnswer } = await import(
      '@/features/survey-response/server/services/response.service'
    );
    const result = await createResponseWithFirstAnswer({
      surveyId: SURVEY_ID,
      sessionId: 'sess-revived',
      versionId: VERSION_ID,
      questionId: PLAIN_QUESTION_ID,
      value: '3시간 뒤 재진입',
      currentStepId: 'step-1',
      inviteToken: 'invite-1',
      clientSignals: {
        deviceId: 'dev-1',
        screen: '1440x900',
        tz: 'Asia/Seoul',
        lang: 'ko',
        platform: 'MacIntel',
      },
    });

    expect(result).toMatchObject({ kind: 'created', id: RESPONSE_ID });
    expect(insertValuesLogMock).not.toHaveBeenCalled();
    // 첫 답변 UPDATE 이전에 status 를 in_progress 로 되돌리는 UPDATE 가 선행돼야 한다.
    // 이 assert 가 수정 전 코드(되살림 없이 곧장 답변 UPDATE)를 잡아낸다.
    expect(updateSetLogMock).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'in_progress' }),
    );
  });

  it('정원 마감으로 종결된 행을 물려받으면 500 이 아니라 quota_closed 로 차단한다', async () => {
    checkTrackAMock.mockResolvedValue({
      blocked: false,
      contactTargetId: CONTACT_ID,
      isTestTarget: false,
    });
    selectLimitMock.mockResolvedValueOnce([
      { id: RESPONSE_ID, contactTargetId: CONTACT_ID, metadata: null, status: 'quotaful_out' },
    ]);

    const { createResponseWithFirstAnswer } = await import(
      '@/features/survey-response/server/services/response.service'
    );
    const result = await createResponseWithFirstAnswer({
      surveyId: SURVEY_ID,
      sessionId: 'sess-quotaful',
      versionId: VERSION_ID,
      questionId: PLAIN_QUESTION_ID,
      value: '정원 마감 뒤 재진입',
      currentStepId: 'step-1',
      inviteToken: 'invite-1',
      clientSignals: {
        deviceId: 'dev-1',
        screen: '1440x900',
        tz: 'Asia/Seoul',
        lang: 'ko',
        platform: 'MacIntel',
      },
    });

    expect(result).toEqual({ kind: 'blocked', reason: 'quota_closed' });
  });

  it('신규 INSERT(재사용 아님)면 draftSeq 를 싣지 않는다', async () => {
    checkTrackAMock.mockResolvedValue({
      blocked: false,
      contactTargetId: CONTACT_ID,
      isTestTarget: false,
    });
    // findActiveResponseByContact — 활성 응답 없음 → INSERT 진행.
    selectLimitMock.mockResolvedValueOnce([]);
    insertReturningMock.mockResolvedValue([
      { id: RESPONSE_ID, contactTargetId: CONTACT_ID, metadata: null, status: 'in_progress' },
    ]);

    const { createResponseWithFirstAnswer } = await import(
      '@/features/survey-response/server/services/response.service'
    );
    const result = await createResponseWithFirstAnswer({
      surveyId: SURVEY_ID,
      sessionId: 'sess-first-time',
      versionId: VERSION_ID,
      questionId: PLAIN_QUESTION_ID,
      value: '첫 입력',
      currentStepId: 'step-1',
      inviteToken: 'invite-1',
      clientSignals: {
        deviceId: 'dev-1',
        screen: '1440x900',
        tz: 'Asia/Seoul',
        lang: 'ko',
        platform: 'MacIntel',
      },
    });

    expect(result.kind).toBe('created');
    expect(result).not.toHaveProperty('draftSeq');
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
    // calc 서버 재계산의 버전 스냅샷 조회(.limit(1) 종단) — 이 그룹의 기존 테스트는
    // PII 암호화가 관심사이므로 스냅샷 없음으로 두어 재계산을 스킵시킨다.
    selectLimitMock.mockResolvedValue([]);
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

  // 회귀 가드: loadPiiQuestionIds 가 보내는 쿼리 텍스트에 UNION + live pii_encrypted 조각이
  // 실수로 빠지지 않았는지만 확인한다. mock 은 SQL 을 실행하지 않으므로 "스냅샷에 없어도
  // 라이브 플래그로 잡힌다"는 실제 합집합 동작 자체는 이 테스트로 검증되지 않는다(실DB 영역).
  it('loadPiiQuestionIds 쿼리 텍스트에 UNION 과 live pii_encrypted 조각이 포함된다', async () => {
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

    const unionCall = executeMock.mock.calls.find((call) => sqlText(call[0]).includes('UNION'));
    expect(unionCall).toBeDefined();
    const text = sqlText(unionCall![0]);
    expect(text).toContain('pii_encrypted = true');
  });

  // calc 서버 재계산 (신뢰 경계) — 클라이언트가 조작/구버전 수식으로 보낸 계산값을
  // 서버가 버전 스냅샷 수식으로 다시 계산해 덮어쓰는지 검증한다.
  it('클라이언트가 보낸 calc 값을 버전 스냅샷 수식으로 재계산해 덮어쓴다', async () => {
    const CALC_Q_ID = 'q-calc-table';
    const calcTableQuestion = {
      id: CALC_Q_ID,
      type: 'table',
      title: '계산 표',
      required: false,
      order: 1,
      tableRowsData: [
        {
          id: 'r1',
          label: 'r1',
          cells: [
            { id: 'a1', content: '', type: 'input', inputType: 'number' },
            { id: 'c1', content: '', type: 'calc', formula: { kind: 'cell', cellId: 'a1' } },
          ],
        },
      ],
    };
    // 멤버십 필터가 calc 질문 키를 drop 하지 않도록 유효 id 목록에 포함시킨다.
    executeMock.mockImplementation((query: unknown) => {
      if (sqlText(query).includes('IS TRUE')) {
        return Promise.resolve([{ id: QUESTION_ID }]);
      }
      return Promise.resolve([
        { id: QUESTION_ID },
        { id: PLAIN_QUESTION_ID },
        { id: CALC_Q_ID },
      ]);
    });
    // 버전 스냅샷 조회가 calc 질문을 반환하게 한다.
    selectLimitMock.mockResolvedValue([
      { snapshot: { questions: [calcTableQuestion], lookups: [] } },
    ]);

    const { completeResponse } = await import(
      '@/features/survey-response/server/services/response.service'
    );
    await completeResponse({
      responseId: RESPONSE_ID,
      data: {
        questionResponses: {
          // 클라이언트가 c1 에 수식 결과(10)와 다른 조작값을 실어 보냄
          [CALC_Q_ID]: { a1: '10', c1: '999' },
        },
      },
    });

    const setArg = updateSetLogMock.mock.calls[0]![0] as {
      questionResponses?: Record<string, unknown>;
    };
    const storedTable = (setArg.questionResponses as Record<string, unknown>)[
      CALC_Q_ID
    ] as Record<string, unknown>;
    expect(storedTable['a1']).toBe('10');
    expect(storedTable['c1']).toBe('10'); // 999 가 아니라 서버 재계산 값
  });

  // 우회 차단 — 위조 calc 값을 draft 로 먼저 저장하고 data 없는 complete 를 불러도,
  // 서버가 저장된 응답을 로드해 같은 재계산을 태워 확정값을 수식 결과로 덮어쓴다.
  it('data 없는 complete 도 저장된 calc 값을 재계산해 확정한다', async () => {
    const CALC_Q_ID = 'q-calc-table';
    const calcTableQuestion = {
      id: CALC_Q_ID,
      type: 'table',
      title: '계산 표',
      required: false,
      order: 1,
      tableRowsData: [
        {
          id: 'r1',
          label: 'r1',
          cells: [
            { id: 'a1', content: '', type: 'input', inputType: 'number' },
            { id: 'c1', content: '', type: 'calc', formula: { kind: 'cell', cellId: 'a1' } },
          ],
        },
      ],
    };
    selectLimitMock.mockResolvedValue([
      { snapshot: { questions: [calcTableQuestion], lookups: [] } },
    ]);
    // 트랜잭션 안 row lock 읽기(FOR UPDATE)가 draft 로 저장된 위조값(c1: '999')을 반환한다.
    selectForUpdateMock.mockResolvedValue([
      { questionResponses: { [CALC_Q_ID]: { a1: '7', c1: '999' } } },
    ]);

    const { completeResponse } = await import(
      '@/features/survey-response/server/services/response.service'
    );
    await completeResponse({ responseId: RESPONSE_ID });

    const setArg = updateSetLogMock.mock.calls[0]![0] as {
      questionResponses?: Record<string, unknown>;
    };
    const storedTable = (setArg.questionResponses as Record<string, unknown>)[
      CALC_Q_ID
    ] as Record<string, unknown>;
    expect(storedTable['a1']).toBe('7');
    expect(storedTable['c1']).toBe('7'); // 999 가 아니라 저장분 기준 서버 재계산 값
  });

  it('버전 스냅샷이 없으면 재계산을 스킵하고 제출값을 그대로 저장한다', async () => {
    // beforeEach 의 selectLimitMock([]) 그대로 — 스냅샷 없음
    const { completeResponse } = await import(
      '@/features/survey-response/server/services/response.service'
    );
    await completeResponse({
      responseId: RESPONSE_ID,
      data: {
        questionResponses: { [PLAIN_QUESTION_ID]: '평문 답변' },
      },
    });

    const setArg = updateSetLogMock.mock.calls[0]![0] as {
      questionResponses?: Record<string, unknown>;
    };
    expect((setArg.questionResponses as Record<string, unknown>)[PLAIN_QUESTION_ID]).toBe(
      '평문 답변',
    );
  });
});

describe('saveAdminEdit — 복호화 diff 안정성 + 재암호화 저장', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    // 실제 encryptAnswerValue 로 만든 암호문이 DB prev 에 저장돼 있는 상황을 재현한다.
    const { encryptAnswerValue } = await import('@/lib/crypto/response-pii');
    const prevCipher = encryptAnswerValue(PII_PLAINTEXT);

    // 소유권 검증 (db.query.surveys.findFirst) — currentVersionId 는 버전 가드용,
    // 아래 saveAdminEdit 호출의 versionId 입력과 일치시켜 이 스위트의 관심사(복호화
    // diff/재암호화)와 무관한 버전 가드/이관 분기를 타지 않게 한다.
    surveyFindFirstMock.mockResolvedValue({ id: SURVEY_ID, currentVersionId: VERSION_ID });
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
        versionId: VERSION_ID,
      },
      { id: 'admin-1', email: 'a@b.com' },
      false,
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
        versionId: VERSION_ID,
      },
      { id: 'admin-1', email: 'a@b.com' },
      false,
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

describe('saveAdminEdit — calc 셀 서버 재계산 (Task 13)', () => {
  const CALC_QUESTION_ID = 'q-calc-1';
  const SOURCE_CELL_ID = `${CALC_QUESTION_ID}-a`;
  const CALC_CELL_ID = `${CALC_QUESTION_ID}-c`;

  /** withCalcValues 가 요구하는 최소 테이블 질문 스냅샷 — source 셀 값을 그대로 옮기는 calc 셀 1개. */
  function calcTableSnapshotQuestion() {
    return {
      id: CALC_QUESTION_ID,
      type: 'table',
      title: '계산 테이블',
      tableRowsData: [
        {
          id: 'r1',
          label: 'r1',
          cells: [
            { id: SOURCE_CELL_ID, content: '', type: 'input', inputType: 'number' },
            {
              id: CALC_CELL_ID,
              content: '',
              type: 'calc',
              formula: { kind: 'cell', cellId: SOURCE_CELL_ID },
            },
          ],
        },
      ],
    };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    surveyFindFirstMock.mockResolvedValue({ id: SURVEY_ID, currentVersionId: VERSION_ID });
    // status: completed → getProgressSnapshot(버전 스냅샷 재조회) 경로를 타지 않아
    // selectLimitMock 호출을 diff 스냅샷 조회 1건으로 고정할 수 있다.
    responseFindFirstMock.mockResolvedValue({
      id: RESPONSE_ID,
      surveyId: SURVEY_ID,
      versionId: VERSION_ID,
      deletedAt: null,
      status: 'completed',
      contactTargetId: null,
      questionResponses: {
        // 이전 저장값 — source=5, calc 도 그 시점엔 정합했던 5.
        [CALC_QUESTION_ID]: { [SOURCE_CELL_ID]: '5', [CALC_CELL_ID]: '5' },
      },
    });
    // loadPiiQuestionIds — PII 문항 없음.
    executeMock.mockResolvedValue([]);
    // 버전 스냅샷 조회 (diff 블록에서 changedIds.length > 0 일 때만 호출됨).
    selectLimitMock.mockResolvedValue([{ snapshot: { questions: [calcTableSnapshotQuestion()] } }]);
    updateReturningMock.mockReturnValue([{ id: RESPONSE_ID }]);
  });

  it('source 셀 값을 바꾸면 클라가 제출한 calc 값을 무시하고 서버가 재계산한 값을 저장한다', async () => {
    const { saveAdminEdit } = await import(
      '@/features/survey-response/server/services/response-edit.service'
    );
    await saveAdminEdit(
      {
        surveyId: SURVEY_ID,
        responseId: RESPONSE_ID,
        questionResponses: {
          // 운영자가 source 셀을 5 → 10 으로 수정. calc 셀은 (오래된 클라 상태 등으로) 여전히
          // 구값 5 를 담아 제출됐다고 가정 — 서버가 이걸 신뢰하지 않고 재계산해야 한다.
          [CALC_QUESTION_ID]: { [SOURCE_CELL_ID]: '10', [CALC_CELL_ID]: '5' },
        },
        versionId: VERSION_ID,
      },
      { id: 'admin-1', email: 'a@b.com' },
      false,
    );

    const setArg = updateSetLogMock.mock.calls[0]![0] as {
      questionResponses: Record<string, unknown>;
    };
    const stored = setArg.questionResponses[CALC_QUESTION_ID] as Record<string, unknown>;
    expect(stored[SOURCE_CELL_ID]).toBe('10');
    // 서버 재계산 값 — 클라가 보낸 stale '5' 가 아니라 새 source 기준 '10' 이어야 한다.
    expect(stored[CALC_CELL_ID]).toBe('10');

    // response_answers 정규화 저장에도 동일하게 재계산된 값이 들어간다.
    const answersMap = replaceResponseAnswersMock.mock.calls[0]![3] as Record<string, unknown>;
    const storedAnswers = answersMap[CALC_QUESTION_ID] as Record<string, unknown>;
    expect(storedAnswers[CALC_CELL_ID]).toBe('10');
  });

  it('버전 스냅샷을 못 얻으면(versionId=null) 재계산을 건너뛰고 제출값을 그대로 저장한다 (fail-safe)', async () => {
    // 미배포 설문(currentVersionId=null) 시나리오로 고정 — effectiveVersionId 는
    // input.versionId(null) ?? existing.versionId(null) 이라 결국 null 이 되어야
    // 기존 fail-safe 의도(스냅샷 조회 자체를 skip)가 그대로 재현된다.
    surveyFindFirstMock.mockResolvedValue({ id: SURVEY_ID, currentVersionId: null });
    responseFindFirstMock.mockResolvedValue({
      id: RESPONSE_ID,
      surveyId: SURVEY_ID,
      versionId: null,
      deletedAt: null,
      status: 'completed',
      contactTargetId: null,
      questionResponses: {
        [CALC_QUESTION_ID]: { [SOURCE_CELL_ID]: '5', [CALC_CELL_ID]: '5' },
      },
    });

    const { saveAdminEdit } = await import(
      '@/features/survey-response/server/services/response-edit.service'
    );
    await saveAdminEdit(
      {
        surveyId: SURVEY_ID,
        responseId: RESPONSE_ID,
        questionResponses: {
          [CALC_QUESTION_ID]: { [SOURCE_CELL_ID]: '10', [CALC_CELL_ID]: '5' },
        },
        versionId: null,
      },
      { id: 'admin-1', email: 'a@b.com' },
      false,
    );

    // 스냅샷을 조회할 수 없으므로(versionId null) 재계산 없이 제출값 그대로 저장된다.
    const setArg = updateSetLogMock.mock.calls[0]![0] as {
      questionResponses: Record<string, unknown>;
    };
    const stored = setArg.questionResponses[CALC_QUESTION_ID] as Record<string, unknown>;
    expect(stored[SOURCE_CELL_ID]).toBe('10');
    expect(stored[CALC_CELL_ID]).toBe('5');
  });

  it('클라가 건드리지 않은 cross-question calc 질문도 재계산으로 값이 바뀌면 edit log 에 잡힌다', async () => {
    // q-source-num: 숫자형 단답(kind:'question' 수식이 참조하는 원본).
    // q-calc-cross: 그 값을 그대로 옮기는 calc 셀 1개짜리 표 — 클라는 이 질문을 전혀 건드리지
    // 않고 이전 저장값 그대로("5") 재제출한다. 서버 재계산 없이는 이 변경이 diff 에 안 잡힌다.
    const SOURCE_QUESTION_ID = 'q-source-num';
    const CROSS_CALC_QUESTION_ID = 'q-calc-cross';
    const CROSS_CALC_CELL_ID = `${CROSS_CALC_QUESTION_ID}-c`;

    surveyFindFirstMock.mockResolvedValue({ id: SURVEY_ID, currentVersionId: VERSION_ID });
    responseFindFirstMock.mockResolvedValue({
      id: RESPONSE_ID,
      surveyId: SURVEY_ID,
      versionId: VERSION_ID,
      deletedAt: null,
      status: 'completed',
      contactTargetId: null,
      questionResponses: {
        [SOURCE_QUESTION_ID]: '5',
        [CROSS_CALC_QUESTION_ID]: { [CROSS_CALC_CELL_ID]: '5' },
      },
    });
    executeMock.mockResolvedValue([]);
    selectLimitMock.mockResolvedValue([
      {
        snapshot: {
          questions: [
            { id: SOURCE_QUESTION_ID, type: 'text', title: '소스 질문' },
            {
              id: CROSS_CALC_QUESTION_ID,
              type: 'table',
              title: '교차 계산',
              tableRowsData: [
                {
                  id: 'r1',
                  label: 'r1',
                  cells: [
                    {
                      id: CROSS_CALC_CELL_ID,
                      content: '',
                      type: 'calc',
                      formula: { kind: 'question', questionId: SOURCE_QUESTION_ID },
                    },
                  ],
                },
              ],
            },
          ],
        },
      },
    ]);
    updateReturningMock.mockReturnValue([{ id: RESPONSE_ID }]);

    const { saveAdminEdit } = await import(
      '@/features/survey-response/server/services/response-edit.service'
    );
    await saveAdminEdit(
      {
        surveyId: SURVEY_ID,
        responseId: RESPONSE_ID,
        questionResponses: {
          // 운영자는 source 만 5 → 20 으로 수정. cross-question calc 질문은 손대지 않고
          // (읽기 전용이므로) 이전 값 그대로 재제출.
          [SOURCE_QUESTION_ID]: '20',
          [CROSS_CALC_QUESTION_ID]: { [CROSS_CALC_CELL_ID]: '5' },
        },
        versionId: VERSION_ID,
      },
      { id: 'admin-1', email: 'a@b.com' },
      false,
    );

    // 저장값: cross-question calc 셀이 재계산으로 20 을 반영한다.
    const setArg = updateSetLogMock.mock.calls[0]![0] as {
      questionResponses: Record<string, unknown>;
    };
    const storedCross = setArg.questionResponses[CROSS_CALC_QUESTION_ID] as Record<
      string,
      unknown
    >;
    expect(storedCross[CROSS_CALC_CELL_ID]).toBe('20');

    // 핵심: 클라가 diff 상 건드리지 않은 CROSS_CALC_QUESTION_ID 도 실제 DB 값이 바뀌었으므로
    // edit log(changedQuestions) 에 포함돼야 한다 — 감사 로그 누락 방지.
    expect(editLogValuesMock).toHaveBeenCalledTimes(1);
    const logValues = editLogValuesMock.mock.calls[0]![0] as {
      changedQuestions: Array<{ questionId: string }>;
      changedCount: number;
    };
    const changedIds = logValues.changedQuestions.map((c) => c.questionId);
    expect(changedIds).toContain(SOURCE_QUESTION_ID);
    expect(changedIds).toContain(CROSS_CALC_QUESTION_ID);
    expect(logValues.changedCount).toBe(2);
  });

  it('손상된 스냅샷(questions 필드 누락)이면 재계산에서 크래시하지 않고 제출값을 그대로 저장한다 (fail-safe)', async () => {
    executeMock.mockResolvedValue([]);
    // questions 필드 자체가 없는 손상된 스냅샷 — withCalcValues 의 `for (const q of ctx.questions)` 가
    // ctx.questions 를 무방비로 순회하면 "not iterable" 로 saveAdminEdit 전체가 죽는다.
    selectLimitMock.mockResolvedValue([{ snapshot: {} }]);
    updateReturningMock.mockReturnValue([{ id: RESPONSE_ID }]);

    const { saveAdminEdit } = await import(
      '@/features/survey-response/server/services/response-edit.service'
    );
    await expect(
      saveAdminEdit(
        {
          surveyId: SURVEY_ID,
          responseId: RESPONSE_ID,
          questionResponses: {
            [CALC_QUESTION_ID]: { [SOURCE_CELL_ID]: '10', [CALC_CELL_ID]: '5' },
          },
          versionId: VERSION_ID,
        },
        { id: 'admin-1', email: 'a@b.com' },
        false,
      ),
    ).resolves.toEqual({ ok: true });

    const setArg = updateSetLogMock.mock.calls[0]![0] as {
      questionResponses: Record<string, unknown>;
    };
    const stored = setArg.questionResponses[CALC_QUESTION_ID] as Record<string, unknown>;
    // 재계산할 questions 자체가 없으므로 클라 제출값이 그대로 저장된다(재계산 시도는 하되 결과가
    // 원본과 동일 — withCalcValues 는 calc 셀 없으면 payloadAnswers 를 그대로 반환).
    expect(stored[SOURCE_CELL_ID]).toBe('10');
    expect(stored[CALC_CELL_ID]).toBe('5');
  });
});
