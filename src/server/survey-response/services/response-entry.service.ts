import { headers } from 'next/headers';

import { eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import 'server-only';

import { db } from '@/db';
import { NewSurveyResponse, surveyResponses } from '@/db/schema';
import { encryptAnswerValue } from '@/lib/crypto/response-pii';
import { parseBrowser, parsePlatform } from '@/lib/operations/parse-ua';
import { isValidTestToken } from '@/server/read-models/survey-control';
import type { PageVisit } from '@/shared/contracts/survey-response';

import { extractDraftSeq } from '../domain/draft-seq';
import type {
  ClientSignals,
  CreateBlankResponseInput,
  CreateResponseWithFirstAnswerInput,
  FirstAnswerResult,
  StartResponseInput,
  SurveyResponse,
} from '../domain/response';
import { checkTrackA, checkTrackB } from './check';
import {
  applyQuestionResponseUpdate,
  assertQuestionBelongsToResponse,
  updateQuestionResponse,
} from './response-answer-write';
import {
  assertSurveyAcceptingResponses,
  loadSurveyGateRow,
  loadValidatedVersionGateRow,
  toGateBlockedResult,
} from './response-gate';
import {
  insertAnonymousTestResponse,
  insertResponseWithContactReuse,
} from './response-row-create';
import { computeSignals } from './signals';
import { assertAnswerValueSize } from './submitted-answers';
import {
  acquireTestTargetResponse,
} from './test-target-attempt.server';

/**
 * 응답 진입 — 빈 행 생성, 첫 답변과 함께 생성, 테스트 대상자 회차 확보, 봇 판정.
 *
 * 응답 행 쓰기 공통(response-answer-write)만 부른다. 초안·완료 경로를 부르지 않는다(순환 금지).
 */

export async function startResponse(input: StartResponseInput): Promise<SurveyResponse> {
  const { surveyId, sessionId, versionId } = input;

  // 가용성 게이트: 마감/draft/closed/비공개 설문에 응답 행이 생성되지 않도록 진입부에서 차단.
  // startResponse 는 inviteToken 을 받지 않으므로 비공개/토큰강제 설문이면 contactTargetId=null 로 거부된다.
  const survey = await loadSurveyGateRow(surveyId);
  // #24 버전 무결성: 클라 제공 versionId 검증(타 설문 거부) + 구버전이면 현재 버전으로 재핀.
  const { version, effectiveVersionId } = await loadValidatedVersionGateRow(
    surveyId,
    versionId,
    survey.currentVersionId,
  );
  // startResponse 는 테스트 전용 유지 함수(#402 주석 참조)라 isTest 판정 없이 고정한다.
  assertSurveyAcceptingResponses(survey, version, { contactTargetId: null, isTest: false });

  const newResponse: NewSurveyResponse = {
    surveyId,
    questionResponses: {},
    isCompleted: false,
    // 예측 가능한 session-<밀리초> 폴백 금지 — pub(무인증) start 로 도달 가능해
    // resume→updateQuestionResponse 응답 변조 윈도를 연다. crypto.randomUUID 로 생성.
    sessionId: sessionId || randomUUID(),
    versionId: effectiveVersionId,
  };

  const [response] = await db.insert(surveyResponses).values(newResponse).returning();
  if (!response) {
    throw new Error('startResponse: 응답 행 INSERT 실패');
  }
  return response;
}

// 질문 응답 업데이트 (원자적 업데이트로 Race Condition 방지)

/**
 * 대상자 테스트 회차 인수 (+ 있으면 첫 답변 저장). 단일 트랜잭션.
 *
 * 기존 saveTestTargetFirstAnswer 가 blank 경로의 db.transaction(acquireTestTargetResponse)
 * 에 대한 "정확한 접두 확장" 이라 합친 것이다 — firstAnswer 유무로 꼬리만 켜므로 두 경로의
 * tx 내용은 각각 현행과 동일하다. firstAnswer 가 없을 때 tx 안에서 도는 문장은
 * acquireTestTargetResponse 하나뿐이어야 한다(versionId select 를 조건 밖으로 끌어내면
 * contact_targets FOR UPDATE 잠금 구간이 늘어난다).
 */
async function acquireTestTargetEntry(
  input: Parameters<typeof acquireTestTargetResponse>[1],
  firstAnswer?: { questionId: string; value: unknown },
): Promise<{ responseId: string; reset: boolean; versionId: string | null }> {
  // 크기 가드: tx(컨택 FOR UPDATE 잠금 + 회차 INSERT) 이전에 평문으로 거른다.
  // 호출자(admitAndCreateResponseInner)가 아니라 이 함수 안에 두는 이유 —
  // saveTestTargetFirstAnswer 가 별도 export 진입점이라 호출자에만 두면 그 우회로가 무가드로 남는다.
  if (firstAnswer) assertAnswerValueSize(firstAnswer.value);

  return db.transaction(async (tx) => {
    const acquired = await acquireTestTargetResponse(tx, input);
    if (!firstAnswer) return acquired;

    const [response] = await tx
      .select({ versionId: surveyResponses.versionId })
      .from(surveyResponses)
      .where(eq(surveyResponses.id, acquired.responseId))
      .limit(1);
    if (!response) throw new Error('응답을 찾을 수 없습니다.');

    const { piiEncrypted } = await assertQuestionBelongsToResponse(
      response.versionId,
      input.surveyId,
      firstAnswer.questionId,
      tx,
    );
    const storedValue = piiEncrypted ? encryptAnswerValue(firstAnswer.value) : firstAnswer.value;
    // 진입 파이프라인과 동일 기준(저장될 값)으로 판정한다 — 같은 lane 을 RPC 로 타든
    // export 로 타든 임계가 같아야 한다. tx 안이라 throw 시 회차 INSERT 까지 롤백된다.
    assertAnswerValueSize(storedValue);
    await applyQuestionResponseUpdate(
      tx,
      { responseId: acquired.responseId, questionId: firstAnswer.questionId },
      storedValue,
    );
    return acquired;
  });
}

/** export 유지 필수 — tests/integration/test-target-attempt-ownership.realdb.test.ts 가 직접 import 한다. */
export async function saveTestTargetFirstAnswer(
  input: Parameters<typeof acquireTestTargetResponse>[1] & {
    questionId: string;
    value: unknown;
  },
): Promise<{ responseId: string; reset: boolean; versionId: string | null }> {
  return acquireTestTargetEntry(input, { questionId: input.questionId, value: input.value });
}

// ========================
// 운영 현황 콘솔 — 응답 라이프사이클 통합 지점 (T4)
// ========================

/**
 * 봇 방어 가드 (bypass defense). true 면 차단 대상.
 * - honeypot 채워짐: 실제 클라이언트는 hidden 필드라 항상 빈 값, 봇이 자동 채움.
 * - 익명(invite 없음) + clientSignals 부재: 실제 클라이언트는 응답 페이지 렌더 게이트상
 *   signals 수집 완료(non-null) 전엔 답변이 불가하므로 create 시점 항상 non-null.
 *   null 은 Track B 중복검사를 우회하려는 직접 RPC 호출 봇뿐이다.
 */
function isLikelyBot(args: {
  honeypot: string | undefined;
  inviteToken: string | undefined;
  testToken: string | undefined;
  clientSignals: ClientSignals | null;
}): boolean {
  if (args.honeypot && args.honeypot.trim().length > 0) return true;
  // testToken 면제: 테스트 세션은 신호 기반 검사 대상이 아니고, 무효 토큰은 바로 뒤의
  // isValidTestToken 게이트가 invalid_test_token 으로 차단하므로 봇 우회 구멍이 생기지 않는다.
  // 면제 없이는 유효 테스트 링크의 첫 답변(신호 수집 전)이 봇으로 오차단된다.
  if (!args.inviteToken && !args.testToken && !args.clientSignals) return true;
  return false;
}

/**
 * 두 진입 경로의 유일한 차이 = "첫 답변을 들고 들어오는가".
 * 발명한 개념이 아니라 스키마 차집합이다(domain/response.ts 의 두 Input 대조로 확인):
 *   CreateResponseWithFirstAnswerInput - CreateBlankResponseInput === EntryFirstAnswer
 */
type EntryFirstAnswer = {
  questionId: string;
  value: unknown;
};

// 두 입력의 차집합이 EntryFirstAnswer 와 정확히 일치함을 tsc 가 매 빌드 확인한다.
// 한쪽 입력에만 필드가 늘면 여기서 컴파일이 깨져 파이프라인이 그 필드를 호명받는다.
// keyof 방향으로 거는 이유: extends 방향은 구조적 subtyping 이 초과 속성을 통과시켜 침묵한다.
// 선례: _TestAttemptIdentityContract (domain/response.ts).
type _EntryInputContract =
  keyof CreateResponseWithFirstAnswerInput extends keyof (CreateBlankResponseInput &
    EntryFirstAnswer)
    ? true
    : never;
const _entryInputContract: _EntryInputContract = true;
void _entryInputContract;

/**
 * 게이트 에러 → blocked 폴딩. 현행 두 wrapper 의 동일한 try/catch 를 승격한 것이다.
 *
 * 수용 게이트 위반은 여기서 던지고 여기서 접는다 — 안쪽에서 미리 blocked 로 접으면
 * startResponse 와 공유하는 assertSurveyAcceptingResponses 계약과 갈라지고
 * toGateBlockedResult 가 죽은 코드가 된다. throw→catch 구조를 유지할 것.
 */
async function admitAndCreateResponse(
  input: CreateBlankResponseInput,
  answer: EntryFirstAnswer | null,
): Promise<FirstAnswerResult> {
  try {
    return await admitAndCreateResponseInner(input, answer);
  } catch (err) {
    const blocked = toGateBlockedResult(err);
    if (blocked) return blocked;
    throw err;
  }
}

/**
 * 첫 답변과 함께 survey_responses 행을 INSERT.
 *
 * - UA를 서버 헤더에서 읽어 platform/browser를 파싱
 * - 첫 답변(`questionResponses`)과 첫 페이지 방문 기록을 함께 기록
 * - 동일 (surveyId, sessionId) 조합 동시 INSERT race 는 DB UNIQUE 제약 +
 *   `ON CONFLICT DO NOTHING` 으로 차단. 충돌 시 기존 행에 답변만 적용.
 * - clientSignals 로 중복 감지 재검증 (bypass defense). 차단 시 blocked 반환.
 *
 * @returns created (생성/기존 행 id) 또는 blocked (중복 감지)
 */
export async function createResponseWithFirstAnswer(
  input: CreateResponseWithFirstAnswerInput,
): Promise<FirstAnswerResult> {
  return admitAndCreateResponse(input, {
    questionId: input.questionId,
    value: input.value,
  });
}

/**
 * 응답 진입의 단일 소유자 — 판정(admit)부터 쓰기 가능한 행 확보(create)까지.
 *
 * 부작용 순서가 외부 계약이다. 재배치 금지:
 *   토큰 배타 → isLikelyBot → (answer) 평문 크기 가드 → headers()+UA → computeSignals
 *   → loadSurveyGateRow → isValidTestToken → 무효 테스트 토큰 차단 → Track A|B → isTest 합성
 *   → attempt 가드 → [대상자 테스트 lane 조기 반환] → loadValidatedVersionGateRow
 *   → assertSurveyAcceptingResponses → (answer) 멤버십+암호화+암호문 크기 가드 → firstVisit
 *   → 행 조립 → insert lane 선택 → blocked 접기 → (answer) updateQuestionResponse
 *
 * 수용 게이트 위반은 여기서 던진다(접지 않는다) — admitAndCreateResponse 의
 * toGateBlockedResult 가 현행과 같은 지점에서 접는다.
 *
 * answer 분기는 크기 가드 1곳 + 본문 (1/4)~(4/4) 4곳이며 전부 "첫 답변" 그 자체다.
 * 정책 가드(봇·토큰·중복·버전·수용)를 이 분기 안에 넣지 말 것 — 넣는 순간 A-2 이전으로 돌아간다.
 */
async function admitAndCreateResponseInner(
  input: CreateBlankResponseInput,
  answer: EntryFirstAnswer | null,
): Promise<FirstAnswerResult> {
  const {
    surveyId,
    sessionId,
    versionId,
    currentStepId,
    visibleStepIndex,
    visibleStepTotal,
    inviteToken,
    clientSignals,
    honeypot,
    testToken,
    attemptId,
  } = input;

  if (inviteToken != null && testToken != null) {
    return { kind: 'blocked', reason: 'invalid_test_token' };
  }

  // 봇 방어: db/헤더 접근 전에 차단. 사유는 device_already_responded 로 통일(탐지 비노출). 위치·동작 불변.
  if (isLikelyBot({ honeypot, inviteToken, testToken, clientSignals })) {
    return { kind: 'blocked', reason: 'device_already_responded' };
  }

  // #5 변조 가드 1(전방 배치): 첫 답변 평문 크기. headers()·중복검사·게이트 조회·암호화 등
  // 모든 I/O 이전에 거른다. 봇 가드보다 앞에 두지 말 것 — honeypot + 거대값 요청이
  // blocked 대신 500 이 되어 탐지 비노출 원칙과 어긋난다.
  // 평문이 상한 이하여도 PII 암호문은 상한을 넘을 수 있어 암호화 직후 한 번 더 검사한다.
  if (answer) assertAnswerValueSize(answer.value);

  // UA + IP (Next 15+ 비동기 headers API)
  const headerStore = await headers();
  const userAgent = headerStore.get('user-agent') ?? null;
  const platform = parsePlatform(userAgent);
  const browser = parseBrowser(userAgent);

  // 신호 계산: ipHash, fpHash, deviceId (clientSignals null 이면 모두 null)
  const signals = clientSignals ? computeSignals(headerStore, clientSignals) : null;

  // 가용성 게이트 + 익명 테스트 세션 판정. 대상자 테스트는
  // invite Track A가 반환하는 isTestTarget을 권위 소스로 삼는다.
  const survey = await loadSurveyGateRow(surveyId);
  const isAnonymousTest = isValidTestToken(survey, testToken);

  // 무효 테스트 링크 차단(스펙 §9, 결정 5): testToken 이 왔는데 유효 세션으로 판정되지 않으면
  // (테스트 모드 OFF 또는 토큰 불일치) 익명 실데이터로 폴백하지 않고 즉시 차단한다.
  // 테스트 모드 OFF 후 stale 테스트 탭의 신규 응답이 isTest=false 실데이터로 새는 것 방지.
  // 위치: 봇 가드 뒤, 중복검사(Track A/B) 앞.
  if (testToken != null && !isAnonymousTest) {
    return { kind: 'blocked', reason: 'invalid_test_token' };
  }

  // 중복 감지 재검증 (bypass defense — checkDuplicateOnEntry 우회 시 server action에서 2차 차단)
  // checkTrackA 가 통과 시 contactTargetId 를 반환하므로 그대로 사용 (중복 DB 호출 회피)
  // clientSignals null 시 Track B 검사 skip (수용된 trade-off — fallback 신호로 거짓 차단 회피)
  // invite는 Track A로 실제/테스트 대상자를 구분한다. 익명 테스트만 Track A/B를
  // 우회하며, 비초대 실응답은 기존 Track B 재검증을 유지한다.
  let contactTargetId: string | null = null;
  let isTestTarget = false;
  if (inviteToken) {
    const trackA = await checkTrackA(surveyId, inviteToken);
    if (trackA.blocked) return { kind: 'blocked', reason: trackA.reason };
    contactTargetId = trackA.contactTargetId ?? null;
    isTestTarget = trackA.isTestTarget === true;
  } else if (!isAnonymousTest && signals) {
    const trackB = await checkTrackB({ surveyId, signals });
    if (trackB.blocked) return { kind: 'blocked', reason: trackB.reason };
  }
  const isTest = isAnonymousTest || isTestTarget;

  if (isTestTarget && (!attemptId || !contactTargetId)) {
    return { kind: 'blocked', reason: 'invalid_test_token' };
  }

  if (isTestTarget && contactTargetId && attemptId) {
    // answer 분기 (1/4) — 첫 답변이 있으면 같은 tx 꼬리에서 저장한다.
    // 정책 가드를 이 분기 안에 넣지 말 것.
    const acquired = await acquireTestTargetEntry(
      {
        surveyId,
        contactTargetId,
        sessionId,
        attemptId,
        currentStepId,
        visibleStepIndex,
        visibleStepTotal,
        userAgent,
        ipHash: signals?.ipHash ?? null,
        fpHash: signals?.fpHash ?? null,
        deviceId: signals?.deviceId ?? null,
        platform,
        browser,
      },
      answer ? { questionId: answer.questionId, value: answer.value } : undefined,
    );
    return {
      kind: 'created',
      id: acquired.responseId,
      contactTargetId,
      // 대상자 테스트 경로는 버전 게이트를 타지 않고 언제나 현재 버전에 핀한다.
      // 입력을 그대로 돌려주면 클라이언트가 자기 값과 자기 값을 비교하게 되어
      // 이 lane 에서만 무중단 갈아타기 재핀 감지가 죽는다 — 행에 적힌 값을 돌려준다.
      versionId: acquired.versionId,
    };
  }

  // #24 버전 무결성: 클라 제공 versionId 검증(타 설문 거부) + 무중단 갈아타기(티켓 04) —
  // 배포 전 열린 탭의 구버전 versionId 는 거부 대신 현재 버전으로 재핀된다(effectiveVersionId).
  // create 시점 정원은 soft(completedCount 미전달) — 잔여 race window 는 complete 하드체크가 보강.
  const { version, effectiveVersionId } = await loadValidatedVersionGateRow(
    surveyId,
    versionId,
    survey.currentVersionId,
  );
  assertSurveyAcceptingResponses(survey, version, { contactTargetId, isTest });

  // PII 문항이면 INSERT 전에 암호화 — 평문이 순간이라도 DB(WAL 포함)에 닿지 않게 한다.
  // 이후 updateQuestionResponse 재호출은 이미 암호문이라 이중 암호화되지 않는다.
  // 재핀된 경우 멤버십 검증도 현재 스냅샷(effectiveVersionId) 기준 — 첫 답변 질문이 현재
  // 스냅샷에 없으면(관리자가 배포 직전에 바로 그 질문을 삭제한 좁은 엣지) 기존 멤버십 에러
  // ('해당 설문에 존재하지 않는 질문입니다')가 그대로 발생한다. 허용되는 엣지로 둔다.
  // answer 분기 (2/4) — 첫 답변이 없으면 검증 대상 자체가 없다.
  // 반드시 assertSurveyAcceptingResponses 뒤, firstVisit 조립 앞. 정책 가드 금지.
  let storedValue: unknown;
  if (answer) {
    const { piiEncrypted } = await assertQuestionBelongsToResponse(
      effectiveVersionId,
      surveyId,
      answer.questionId,
    );
    storedValue = piiEncrypted ? encryptAnswerValue(answer.value) : answer.value;
    // #5 변조 가드 1(현행 임계 보존): 이 경로의 판정 기준은 저장될 값이다(PII 는 암호문).
    // 종전에는 INSERT 뒤 updateQuestionResponse 안에서 같은 값에 같은 검사가 돌았다 —
    // 임계는 그대로 두고 판정 시점만 DB 쓰기 앞으로 옮긴 것이다.
    assertAnswerValueSize(storedValue);
  }

  const firstVisit: PageVisit = {
    stepId: currentStepId,
    enteredAt: new Date().toISOString(),
  };

  const newResponse: NewSurveyResponse = {
    surveyId,
    sessionId,
    versionId: effectiveVersionId,
    questionResponses: answer ? { [answer.questionId]: storedValue } : {},
    isCompleted: false,
    status: 'in_progress',
    userAgent,
    ipHash: signals?.ipHash ?? null,
    fpHash: signals?.fpHash ?? null,
    deviceId: signals?.deviceId ?? null,
    platform,
    browser,
    currentStepId,
    visibleStepIndex: visibleStepIndex ?? null,
    visibleStepTotal: visibleStepTotal ?? null,
    pageVisits: [firstVisit],
    contactTargetId,
    isTest,
  };

  const result =
    isAnonymousTest && testToken
      ? await insertAnonymousTestResponse({ surveyId, sessionId, testToken }, newResponse)
      : await insertResponseWithContactReuse({
          surveyId,
          sessionId,
          contactTargetId,
          newResponse,
        });
  // 종결 상태 행을 물려받으려던 경우 — 500 대신 "이미 끝난 응답" 안내로 돌려보낸다.
  if (result.kind === 'blocked') return { kind: 'blocked', reason: result.reason };

  // answer 분기 (4/4) — 첫 답변이 있을 때만 머지한다.
  // 신규 INSERT 든 reuse 든 모두 updateQuestionResponse 로 첫 답변 머지 + progress_pct
  // 갱신을 단일화. jsonb_set 은 동일 값 덮어쓰기라 멱등이라 신규 INSERT path 의 중복 set
  // 도 안전. onReuse 콜백을 사용하지 않는 이유: progress_pct 가 신규 INSERT 에서도 필요.
  if (answer) {
    await updateQuestionResponse({
      responseId: result.row.id,
      questionId: answer.questionId,
      value: storedValue,
    });
  }
  // 컨택 재사용으로 기존 행을 물려받았으면 그 행의 draftSeq 를 함께 실어 보낸다 — resume 이
  // 호출되지 않는 경로(localStorage 없는 재진입)에서도 draftSeqRef 를 올바르게 seed 하기 위함.
  // 반환은 두 경로가 공유한다 — 갈라 두면 한쪽만 필드가 빠지는 드리프트가 다시 생긴다(D-1).
  const draftSeq = extractDraftSeq(result.row.metadata);
  return {
    kind: 'created',
    id: result.row.id,
    contactTargetId: result.row.contactTargetId,
    ...(draftSeq !== undefined ? { draftSeq } : {}),
    // 행에 실제 기록된 versionId — 클라이언트가 자신이 알던 값과 비교해 재핀(티켓 04)을 감지한다.
    versionId: result.row.versionId,
  };
}

/**
 * 답변 없이 응답 행을 INSERT.
 *
 * notice-only / optional-only / visible-question-0 인 설문은 첫 답변이 발생하지 않아
 * createResponseWithFirstAnswer 가 트리거되지 않는다. 사용자가 그 상태로 제출을 누르면
 * survey_responses 가 만들어지지 않은 채 화면만 완료로 바뀌어 silent data loss 가 됨.
 * 호출자(handleSubmit)는 currentResponseId === null 일 때만 이 함수를 fallback 으로 호출한다.
 *
 * createResponseWithFirstAnswer 와 동일하게:
 * - (surveyId, sessionId) UNIQUE 제약으로 멱등 (ON CONFLICT DO NOTHING)
 * - inviteToken 으로 contactTargetId 매칭
 * - UA/platform/browser/firstVisit 캡처
 * - clientSignals 로 중복 감지 재검증 (bypass defense)
 *
 * 충돌(=이미 답변이 있는 row 존재) 시 기존 row 의 id 를 그대로 반환.
 */
export async function createBlankResponse(
  input: CreateBlankResponseInput,
): Promise<FirstAnswerResult> {
  return admitAndCreateResponse(input, null);
}
