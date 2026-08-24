import { headers } from 'next/headers';

import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import 'server-only';

import { type DbTransaction, db } from '@/db';
import {
  NewSurveyResponse,
  questions,
  surveyResponses,
} from '@/db/schema';
import {
  encryptAnswerValue,
} from '@/lib/crypto/response-pii';
import { checkTrackA, checkTrackB } from './check';
import { computeSignals } from './signals';
import { parseBrowser, parsePlatform } from '@/lib/operations/parse-ua';
import { readOptTextsSidecar } from '@/lib/option-text-read';
import { getSurveyControlFlags, isValidTestToken } from '@/server/read-models/survey-control';
import {
  acquireTestTargetResponse,
  lockAndAssertResponseMutation,
} from './test-target-attempt.server';

import { ongoingResponseDenial } from '../domain/acceptance';
import type { PageVisit } from '@/shared/contracts/survey-response';

import { extractDraftSeq } from '../domain/draft-seq';
import type {
  ClientSignals,
  CreateBlankResponseInput,
  CreateResponseWithFirstAnswerInput,
  FirstAnswerResult,
  SaveDraftResponseInput,
  StartResponseInput,
  SurveyResponse,
  UpdateQuestionResponseInput,
} from '../domain/response';
import {
  SurveyNotAcceptingResponsesError,
  assertSurveyAcceptingResponses,
  loadSurveyGateRow,
  loadValidatedVersionGateRow,
  toGateBlockedResult,
} from './response-gate';
import {
  insertAnonymousTestResponse,
  insertResponseWithContactReuse,
} from './response-row-create';
import {
  assertAnswerValueSize,
} from './submitted-answers';

type ResponseQueryExecutor = Pick<DbTransaction, 'execute' | 'select'>;


/**
 * questionId 가 응답이 가리키는 질문 집합에 존재하는지 검증한다. 미존재면 throw.
 *
 * - versionId 가 있으면 그 버전 스냅샷(snapshot->'questions')의 멤버십을 검사한다
 *   (응답은 응답 시점 스냅샷을 기준으로 하므로 권위 소스). non-array 스냅샷은 빈 배열로 폴백.
 * - versionId 가 없으면(레거시/버전 미연결) surveyId 의 라이브 questions 테이블로 폴백.
 *
 * 암호화 플래그는 스냅샷 ∪ 현재 설정 합집합 — 진행 중 세션이 옛 버전에 고정돼도 새로 켠
 * 토글이 새 저장분부터 적용되게 한다(과잉 암호화 방향만 허용). 멤버십 검증은 여전히 스냅샷 단독.
 *
 * 임의 키 JSONB 주입(설문에 없는 questionId 로 questionResponses 오염)을 차단한다.
 */
async function assertQuestionBelongsToResponse(
  versionId: string | null,
  surveyId: string,
  questionId: string,
  executor: ResponseQueryExecutor = db,
): Promise<{ piiEncrypted: boolean }> {
  if (versionId) {
    // 소속 검증(스냅샷 단독) + piiEncrypted 플래그(스냅샷 ∪ 라이브 questions 합집합)를 한
    // 쿼리로. 행이 없으면 미소속 → 거부. questionId 는 pub 입력이라 uuid 형식이 아닐 수
    // 있다 — 파라미터에 ::uuid 를 걸면 plan 시점 캐스트 에러(DB 500)가 나므로, 캐스트는
    // 컬럼 쪽(q.id::text)에 건다. 비정상 id 는 스냅샷 텍스트 비교에서 0행 → 정상 거부.
    const rows = await executor.execute<{ pii: boolean | null }>(sql`
      SELECT
        COALESCE((qe.elem->>'piiEncrypted')::boolean, false)
        OR COALESCE(
          (SELECT q.pii_encrypted FROM questions q
           WHERE q.id::text = ${questionId} AND q.survey_id = ${surveyId}::uuid),
          false
        ) AS pii
      FROM survey_versions sv,
           jsonb_array_elements(
             CASE WHEN jsonb_typeof(sv.snapshot->'questions') = 'array'
                  THEN sv.snapshot->'questions'
                  ELSE '[]'::jsonb
             END
           ) AS qe(elem)
      WHERE sv.id = ${versionId}
        AND qe.elem->>'id' = ${questionId}
      LIMIT 1
    `);
    const row = rows[0];
    if (!row) {
      throw new Error('해당 설문에 존재하지 않는 질문입니다.');
    }
    return { piiEncrypted: row.pii === true };
  }

  const [hit] = await executor
    .select({ id: questions.id, piiEncrypted: questions.piiEncrypted })
    .from(questions)
    .where(and(eq(questions.surveyId, surveyId), eq(questions.id, questionId)))
    .limit(1);
  if (!hit) {
    throw new Error('해당 설문에 존재하지 않는 질문입니다.');
  }
  return { piiEncrypted: hit.piiEncrypted === true };
}

/**
 * jsonb_set 저수준 UPDATE. 크기 가드를 갖지 않는다 — 저장될 값(PII 는 암호문)에 대한
 * assertAnswerValueSize 는 호출자 책임이다(현재 호출자: updateQuestionResponse ·
 * acquireTestTargetEntry). 새 호출자를 추가할 때 이 검사를 빠뜨리면
 * 무가드 쓰기 경로가 다시 생긴다. 배치 UPDATE 쪽은 applyDraftAnswersUpdate 가 같은 규약을 진다.
 */
async function applyQuestionResponseUpdate(
  executor: { update: typeof db.update },
  input: { responseId: string; questionId: string },
  storedValue: unknown,
): Promise<SurveyResponse> {
  const { responseId, questionId } = input;
  const [updated] = await executor
    .update(surveyResponses)
    .set({
      questionResponses: sql`jsonb_set(
        COALESCE(${surveyResponses.questionResponses}, '{}'::jsonb),
        ARRAY[${questionId}],
        ${JSON.stringify(storedValue)}::jsonb,
        true
      )`,
      progressPct: sql`NULLIF(LEAST(100, GREATEST(
        COALESCE(${surveyResponses.progressPct}, 0),
        COALESCE((
          SELECT ROUND((t.idx::numeric
                        / NULLIF(jsonb_array_length(
                            CASE WHEN jsonb_typeof(sv.snapshot->'questions') = 'array'
                                 THEN sv.snapshot->'questions'
                                 ELSE '[]'::jsonb
                            END
                          ), 0)) * 100)::int
          FROM survey_versions sv,
               jsonb_array_elements(
                 CASE WHEN jsonb_typeof(sv.snapshot->'questions') = 'array'
                      THEN sv.snapshot->'questions'
                      ELSE '[]'::jsonb
                 END
               ) WITH ORDINALITY AS t(elem, idx)
          WHERE sv.id = ${surveyResponses.versionId}
            AND elem->>'id' = ${questionId}
          LIMIT 1
        ), 0)
      ))::smallint, 0)`,
    })
    .where(
      and(
        eq(surveyResponses.id, responseId),
        isNull(surveyResponses.deletedAt),
        eq(surveyResponses.status, 'in_progress'),
      ),
    )
    .returning();

  if (!updated) {
    throw new Error('응답을 수정할 수 없습니다.');
  }
  return updated;
}


// ========================
// 응답 변경 service (Mutations)
// ========================

// 아래 함수들은 설문 응답자용이므로 인증 체크하지 않음(pub 미들웨어):
// - startResponse
// - updateQuestionResponse
// - createResponseWithFirstAnswer
// - createBlankResponse
// - completeResponse

// 응답 시작.
//
// ⚠️ 보안: pub procedure 로 다시 노출하지 말 것. clientSignals/honeypot 을 받지 않는
// 무인증 빈 행 생성 경로라 봇 방어(isLikelyBot)를 우회하는 표면이 된다(2026-06 적대 리뷰).
// response.start procedure 는 제거됐고, 정상 클라는 createWithFirstAnswer/createBlank 만 쓴다.
// 이 함수는 가용성 게이트(assertSurveyAcceptingResponses) 단위 테스트용으로만 유지한다.
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
export async function updateQuestionResponse(
  input: UpdateQuestionResponseInput,
): Promise<SurveyResponse> {
  const { responseId, questionId, value } = input;

  // #5 변조 가드 1: value 직렬화 바이트 상한. DB UPDATE 이전에 차단해 거대 JSONB 주입을 막는다.
  assertAnswerValueSize(value);

  // #5 변조 가드 2: 응답 행 조회 — versionId/surveyId 로 questionId 소속을 검증한다.
  const responseRow = await loadResponseRowForMutation(responseId);

  // #5 변조 가드 3: questionId 가 해당 응답의 versionId 스냅샷(또는 surveyId 의 questions)에
  // 존재해야 한다. 미존재면 거부 — 임의 키 JSONB 주입 차단.
  const { piiEncrypted } = await assertQuestionBelongsToResponse(
    responseRow.versionId,
    responseRow.surveyId,
    questionId,
  );
  // PII 문항이면 저장 직전 암호화. 이미 암호문이면 encryptAnswerValue 가 통과시킨다.
  const storedValue = piiEncrypted ? encryptAnswerValue(value) : value;
  // #5 변조 가드 1(저장값 기준): 위 평문 검사는 사전 필터일 뿐이고 판정 기준은 적재되는 값이다.
  // 진입 파이프라인·대상자 테스트 lane 과 같은 기준 — 같은 값을 어느 경로로 넣든 임계가 같다.
  assertAnswerValueSize(storedValue);

  // 중단 모드: 열려 있던 탭의 답변 저장 차단 (테스트 행 예외) — 스펙 5절 게이트 3.
  await assertSurveyNotPaused(responseRow);

  // jsonb_set 으로 답변 저장 + progress_pct 동기 갱신.
  // progress_pct 는 versionId 의 snapshot 에서 questionId 의 1-based position 을 찾아
  // (position / totalQuestions) × 100 으로 계산. GREATEST 로 단조 증가 보장 (앞 질문 수정
  // 시 % 후퇴 방지). snapshot 깨졌거나 questionId 가 snapshot 에 없으면 inner subquery
  // 가 NULL → COALESCE(0) → GREATEST 가 기존값 유지.
  // 방어: non-array snapshot 은 CASE 로 빈 배열 fallback (ERROR 방지). 최종 0 은 NULLIF
  // 로 NULL 로 변환해 "0%" 오표시 회피 (UI 가 NULL → '—' 표시).
  if (!responseRow.isTest) {
    return applyQuestionResponseUpdate(db, { responseId, questionId }, storedValue);
  }

  return db.transaction(async (tx) => {
    await lockAndAssertResponseMutation(tx, {
      responseId,
      attemptId: input.attemptId,
      sessionId: input.sessionId,
    });
    return applyQuestionResponseUpdate(tx, { responseId, questionId }, storedValue);
  });
}

/** 응답 변조 가드에 필요한 최소 응답 행. 단건/배치 경로가 공유한다. */
type ResponseMutationRow = {
  id: string;
  surveyId: string;
  versionId: string | null;
  isTest: boolean;
  contactTargetId: string | null;
};


/** #5 변조 가드 2: 응답 행 조회. 미존재면 기존 에러 메시지를 그대로 던진다. */
async function loadResponseRowForMutation(responseId: string): Promise<ResponseMutationRow> {
  const row = await db.query.surveyResponses.findFirst({
    where: eq(surveyResponses.id, responseId),
    columns: {
      id: true,
      surveyId: true,
      versionId: true,
      isTest: true,
      contactTargetId: true,
    },
  });
  if (!row) {
    throw new Error('응답을 찾을 수 없습니다.');
  }
  return row;
}

/**
 * 중단 모드 게이트. isTest 행은 flags 조회 자체를 skip 해 정상 트래픽 비용을 늘리지 않는다.
 *
 * 판정 자체는 domain/acceptance 의 ongoingResponseDenial 소관이고, 여기 남는 것은
 * (a) 조회 회피 최적화와 (b) flags 미조회(설문 삭제 등) 시 fail-open 이다 — module 은
 * non-null 상태만 받고 null 처리는 호출자가 진다.
 */
async function assertSurveyNotPaused(
  row: Pick<ResponseMutationRow, 'surveyId' | 'isTest'>,
): Promise<void> {
  if (row.isTest) return;
  const flags = await getSurveyControlFlags(row.surveyId);
  const denial = flags ? ongoingResponseDenial(flags, { isTest: row.isTest }) : null;
  if (denial) {
    throw new SurveyNotAcceptingResponsesError(denial);
  }
}

/**
 * assertQuestionBelongsToResponse 의 배치 버전 — 소속 검증 + piiEncrypted 를 1회 쿼리로.
 *
 * 페이지 이동 체크포인트는 답변을 한 번에 여러 개 받는다. 문항마다 검증 쿼리를 돌리면
 * 왕복이 답변 수에 비례해 늘어난다(10문항 페이지에서 2.3초 관측, 2026-08-04).
 * 하나라도 소속되지 않으면 단건 경로와 동일한 메시지로 거부한다 — 부분 저장은 하지 않는다.
 */
async function loadQuestionPiiFlags(
  versionId: string | null,
  surveyId: string,
  questionIds: string[],
): Promise<Map<string, boolean>> {
  const flags = new Map<string, boolean>();

  if (versionId) {
    // questionId 는 pub 입력이라 uuid 형식이 아닐 수 있다 — 캐스트는 컬럼 쪽(q.id::text)에 건다.
    // 비정상 id 는 스냅샷 텍스트 비교에서 매치되지 않아 아래 미존재 검사로 거부된다.
    const idList = sql.join(
      questionIds.map((id) => sql`${id}`),
      sql`, `,
    );
    const rows = await db.execute<{ id: string | null; pii: boolean | null }>(sql`
      SELECT
        qe.elem->>'id' AS id,
        (COALESCE((qe.elem->>'piiEncrypted')::boolean, false)
         OR COALESCE(q.pii_encrypted, false)) AS pii
      FROM survey_versions sv,
           jsonb_array_elements(
             CASE WHEN jsonb_typeof(sv.snapshot->'questions') = 'array'
                  THEN sv.snapshot->'questions'
                  ELSE '[]'::jsonb
             END
           ) AS qe(elem)
      LEFT JOIN questions q
        ON q.id::text = qe.elem->>'id' AND q.survey_id = ${surveyId}::uuid
      WHERE sv.id = ${versionId}
        AND qe.elem->>'id' IN (${idList})
    `);
    for (const row of rows) {
      if (row.id != null) flags.set(row.id, row.pii === true);
    }
  } else {
    const rows = await db
      .select({ id: questions.id, piiEncrypted: questions.piiEncrypted })
      .from(questions)
      .where(and(eq(questions.surveyId, surveyId), inArray(questions.id, questionIds)));
    for (const row of rows) {
      flags.set(row.id, row.piiEncrypted === true);
    }
  }

  for (const questionId of questionIds) {
    if (!flags.has(questionId)) {
      throw new Error('해당 설문에 존재하지 않는 질문입니다.');
    }
  }
  return flags;
}

/**
 * applyQuestionResponseUpdate 의 배치 버전 — 답변 전체를 단일 UPDATE 로 반영한다.
 *
 * questionResponses 는 top-level 키 병합이라 `|| jsonb` 가 문항별 jsonb_set 연쇄와 동치다.
 * progress_pct 는 배치 중 가장 뒤에 있는 문항의 위치로 계산한다(단건 경로를 답변 수만큼
 * 반복한 결과와 동일 — GREATEST 로 단조 증가라 최대값만 남는다).
 */
/**
 * draft 답변 병합 UPDATE.
 *
 * seq 가 주어지면 WHERE 에 metadata.draftSeq = seq 조건을 건다 — claimDraftSeq(선점)와
 * 이 UPDATE 는 별개 문장이라, 그 사이에 더 큰 seq 가 선점·적용되면(예: 지연된 oRPC draft 와
 * pagehide beacon 의 역순 완료) 낡은 답변이 최신을 덮을 수 있다. 조건이 0행이면 선점 이후
 * 더 새로운 쓰기가 끼어든 것이므로 'stale' 로 돌려 답변을 쓰지 않는다.
 * 내보내는 이유: 이 동시성 가드는 두 문장 사이를 외부에서 쪼갤 수 없어 실DB 테스트가
 * 이 함수를 직접 호출해 고정한다 (tests/integration/draft-seq-guard.realdb.test.ts).
 *
 * applyQuestionResponseUpdate 와 동일하게 크기 가드를 갖지 않는다 — 저장될 값(PII 는 암호문)
 * 에 대한 assertAnswerValueSize 는 호출자 책임이다(현재 호출자: saveDraftResponse).
 * 테스트를 위해 export 돼 있으므로 새 호출자를 붙일 때 이 검사를 빠뜨리면 무가드 쓰기 경로가
 * 다시 생긴다 — 저수준 UPDATE 자체에 가드를 넣지 않는 것은 배치 전체를 한 번 더 직렬화하지
 * 않기 위한 의도된 선택이다.
 */
export async function applyDraftAnswersUpdate(
  executor: { update: typeof db.update },
  responseId: string,
  questionIds: string[],
  storedAnswers: Record<string, unknown>,
  seq?: number,
): Promise<'applied' | 'stale' | 'concluded'> {
  const seqGuard =
    seq !== undefined
      ? [sql`COALESCE((${surveyResponses.metadata}->>'draftSeq')::bigint, 0) = ${seq}`]
      : [];
  // 사이드카(__optTexts__)만 실려 온 배치 — 실존 문항이 없어 진척률 계산 불가.
  // jsonb 병합만 수행한다 (빈 idList 를 IN () 으로 흘리면 SQL 오류).
  if (questionIds.length === 0) {
    const [updated] = await executor
      .update(surveyResponses)
      .set({
        questionResponses: sql`COALESCE(${surveyResponses.questionResponses}, '{}'::jsonb)
          || ${JSON.stringify(storedAnswers)}::jsonb`,
      })
      .where(
        and(
          eq(surveyResponses.id, responseId),
          isNull(surveyResponses.deletedAt),
          eq(surveyResponses.status, 'in_progress'),
          ...seqGuard,
        ),
      )
      .returning();
    if (!updated) return judgeDraftZeroRow(responseId, seq);
    return 'applied';
  }
  const idList = sql.join(
    questionIds.map((id) => sql`${id}`),
    sql`, `,
  );
  const [updated] = await executor
    .update(surveyResponses)
    .set({
      questionResponses: sql`COALESCE(${surveyResponses.questionResponses}, '{}'::jsonb)
        || ${JSON.stringify(storedAnswers)}::jsonb`,
      progressPct: sql`NULLIF(LEAST(100, GREATEST(
        COALESCE(${surveyResponses.progressPct}, 0),
        COALESCE((
          SELECT ROUND((
            (SELECT MAX(t.idx)
             FROM jsonb_array_elements(
                    CASE WHEN jsonb_typeof(sv.snapshot->'questions') = 'array'
                         THEN sv.snapshot->'questions'
                         ELSE '[]'::jsonb
                    END
                  ) WITH ORDINALITY AS t(elem, idx)
             WHERE t.elem->>'id' IN (${idList})
            )::numeric
            / NULLIF(jsonb_array_length(
                CASE WHEN jsonb_typeof(sv.snapshot->'questions') = 'array'
                     THEN sv.snapshot->'questions'
                     ELSE '[]'::jsonb
                END
              ), 0)) * 100)::int
          FROM survey_versions sv
          WHERE sv.id = ${surveyResponses.versionId}
          LIMIT 1
        ), 0)
      ))::smallint, 0)`,
    })
    .where(
      and(
        eq(surveyResponses.id, responseId),
        isNull(surveyResponses.deletedAt),
        eq(surveyResponses.status, 'in_progress'),
        ...seqGuard,
      ),
    )
    .returning();

  if (!updated) return judgeDraftZeroRow(responseId, seq);
  return 'applied';
}

/**
 * 답변 UPDATE 0행의 사유 판별 — seq 가드 때문인지(그 사이 더 새로운 쓰기가 선점 = stale),
 * 행이 종결(완료 등)돼서인지(concluded — 잔여 화면 안내로 접는다), 그 외(삭제/부재 =
 * 기존 throw 의미론 유지)인지 구분한다.
 */
async function judgeDraftZeroRow(
  responseId: string,
  seq: number | undefined,
): Promise<'stale' | 'concluded'> {
  const rows = await db.execute<{ draft_seq: string | null; status: string; deleted: boolean }>(sql`
    SELECT metadata->>'draftSeq' AS draft_seq, status, (deleted_at IS NOT NULL) AS deleted
    FROM survey_responses WHERE id = ${responseId}
  `);
  const row = rows[0];
  if (seq !== undefined && row?.draft_seq != null && Number(row.draft_seq) > seq) return 'stale';
  // 종결(완료·스크린아웃 등) 행에 대한 잔여 화면의 쓰기 — 에러가 아니라 "이미 완료됨" 신호.
  if (row && !row.deleted && row.status !== 'in_progress') return 'concluded';
  throw new Error('응답을 수정할 수 없습니다.');
}

type DraftSeqClaim = 'claimed' | 'stale' | 'not_found';


/**
 * draft 쓰기 순번을 선점한다.
 *
 * 저장된 draftSeq 보다 큰 요청만 통과시키고 그 자리에서 값을 올린다. 단일 UPDATE 라
 * 동시 요청에도 하나만 통과한다. 0행이면 seq 가 밀렸거나 행이 없는 것이므로 구분해서
 * 돌려준다 — 행 부재는 기존 에러 경로를 그대로 타야 하기 때문이다.
 */
async function claimDraftSeq(responseId: string, seq: number): Promise<DraftSeqClaim> {
  const claimed = await db.execute<{ id: string }>(sql`
    UPDATE survey_responses
    SET metadata = jsonb_set(
      COALESCE(metadata, '{}'::jsonb),
      ARRAY['draftSeq'],
      to_jsonb(${seq}::bigint),
      true
    )
    WHERE id = ${responseId}
      AND COALESCE((metadata->>'draftSeq')::bigint, 0) < ${seq}
    RETURNING id
  `);
  if (claimed.length > 0) return 'claimed';

  const existing = await db.execute<{ id: string }>(sql`
    SELECT id FROM survey_responses WHERE id = ${responseId} LIMIT 1
  `);
  return existing.length > 0 ? 'stale' : 'not_found';
}

/**
 * 페이지 이동 체크포인트.
 *
 * 외부 요청은 한 번만 받되 기존 단건 저장 경로를 재사용해 문항 소속 검증, 크기 제한,
 * PII 암호화, 테스트 attempt 소유권 검사를 모든 답에 동일하게 적용한다.
 *
 * seq 가 실려 있으면 요청 단위로 한 번 claim 한다(문항별 WHERE 절이 아니라 배치 단위인
 * 이유는 claimDraftSeq 주석 참조 — 0행 매치를 문항별로 두면 정상 시나리오가 500 으로 샌다).
 * 지연 도착한 stale 요청이면 답변을 전혀 쓰지 않고 applied:false 로 돌아간다.
 */
export async function saveDraftResponse(
  input: SaveDraftResponseInput,
): Promise<{ applied: boolean; concluded?: boolean }> {
  if (input.seq !== undefined) {
    const claim = await claimDraftSeq(input.responseId, input.seq);
    // 더 새로운 쓰기가 이미 반영됐다. 지연 도착한 이 요청을 적용하면 최신 답변을 덮는다.
    if (claim === 'stale') return { applied: false };
    // 'not_found' 는 그대로 진행시켜 아래 응답 행 조회의 기존 에러 경로를 타게 한다.
  }

  const entries = Object.entries(input.answers);
  if (entries.length === 0) return { applied: true };

  // #5 변조 가드 1: value 직렬화 바이트 상한. 답변별로 검사해 단건 경로와 동일하게 거른다.
  for (const [, value] of entries) {
    assertAnswerValueSize(value);
  }

  // 기타/상세 기재 사이드카(__optTexts__)는 실존 질문이 아니므로 소속 검증에서 분리한다.
  // 제출 전 이탈에도 텍스트가 남도록 draft 에 실려 오며, 형태 정제 후 통째로 병합한다.
  // 그 외 '__' 키는 기존대로 소속 검증에서 거부된다.
  const sidecarEntry = entries.find(([key]) => key === '__optTexts__');
  const answerEntries = entries.filter(([key]) => key !== '__optTexts__');

  // #5 변조 가드 2: 응답 행 조회. 배치 전체가 같은 행이라 1회면 충분하다.
  const responseRow = await loadResponseRowForMutation(input.responseId);

  // #5 변조 가드 3: 소속 검증 + PII 플래그를 questionId 전체에 대해 1회 쿼리로 수집.
  const piiFlags =
    answerEntries.length > 0
      ? await loadQuestionPiiFlags(
          responseRow.versionId,
          responseRow.surveyId,
          answerEntries.map(([questionId]) => questionId),
        )
      : new Map<string, boolean>();

  // 중단 모드: 열려 있던 탭의 답변 저장 차단 (테스트 행 예외) — 스펙 5절 게이트 3.
  await assertSurveyNotPaused(responseRow);

  // PII 문항이면 저장 직전 암호화. 이미 암호문이면 encryptAnswerValue 가 통과시킨다.
  const storedAnswers: Record<string, unknown> = {};
  for (const [questionId, value] of answerEntries) {
    const storedValue = piiFlags.get(questionId) ? encryptAnswerValue(value) : value;
    // #5 변조 가드 1(저장값 기준): 단건 경로와 같은 기준으로 답변별로 다시 잰다. 하나라도
    // 넘으면 배치 전체를 거부한다 — 소속 검증과 동일하게 부분 저장은 하지 않는다.
    assertAnswerValueSize(storedValue);
    storedAnswers[questionId] = storedValue;
  }
  if (sidecarEntry) {
    storedAnswers['__optTexts__'] = readOptTextsSidecar({ __optTexts__: sidecarEntry[1] });
  }
  const questionIds = answerEntries.map(([questionId]) => questionId);

  if (!responseRow.isTest) {
    const outcome = await applyDraftAnswersUpdate(
      db,
      input.responseId,
      questionIds,
      storedAnswers,
      input.seq,
    );
    return {
      applied: outcome === 'applied',
      ...(outcome === 'concluded' ? { concluded: true } : {}),
    };
  }

  // 테스트 행은 시도 소유권 락을 먼저 잡는다. 락도 배치당 1회.
  const outcome = await db.transaction(async (tx) => {
    await lockAndAssertResponseMutation(tx, {
      responseId: input.responseId,
      ...(input.attemptId ? { attemptId: input.attemptId } : {}),
      ...(input.sessionId ? { sessionId: input.sessionId } : {}),
    });
    return applyDraftAnswersUpdate(tx, input.responseId, questionIds, storedAnswers, input.seq);
  });
  return {
    applied: outcome === 'applied',
    ...(outcome === 'concluded' ? { concluded: true } : {}),
  };
}

/** saveDraftResponseIfActive 가 저장을 건너뛴 사유. 서버 로그·테스트 어서션용. */
export type SaveDraftSkipReason =
  | 'not_found'
  | 'deleted'
  | 'concluded'
  | 'survey_paused'
  | 'answer_value_too_large'
  | 'not_accepting'
  | 'stale';

export type SaveDraftIfActiveResult =
  { saved: true } | { saved: false; skipped: SaveDraftSkipReason };

/** SurveyNotAcceptingResponsesError.reason 은 string 이라 미지의 값이 올 수 있다. union 을 닫는다. */
function toSkipReason(reason: string): SaveDraftSkipReason {
  return reason === 'survey_paused' || reason === 'answer_value_too_large'
    ? reason
    : 'not_accepting';
}

/** 응답 행의 not_found/deleted/concluded 판정. 사전 게이트와 저장 실패 후 재조회가 공유한다. */
function judgeRowGate(
  row: { status: string; deletedAt: Date | null } | undefined,
): { saved: false; skipped: 'not_found' | 'deleted' | 'concluded' } | null {
  if (!row) return { saved: false, skipped: 'not_found' };
  if (row.deletedAt !== null) return { saved: false, skipped: 'deleted' };
  if (row.status !== 'in_progress') return { saved: false, skipped: 'concluded' };
  return null;
}

/**
 * 이탈 시점 beacon 전용 draft 저장.
 *
 * saveDraftResponse 와 달리 "저장할 이유가 없는" 상태를 throw 가 아니라 skipped 로 돌려준다.
 * beacon 은 응답을 읽지 않으므로 상태 코드가 클라이언트 동작을 바꾸지 않는다. 제출 직후 탭
 * 닫기·중단된 설문 탭 닫기 같은 정상 시나리오를 5xx 로 올리면 Sentry 에러율만 오염된다.
 *
 * 상태 조회를 한 번 더 하지만 updateQuestionResponse 가 어차피 문항마다 행을 조회하므로
 * 비중은 작다. 라우트가 throw 메시지 문자열로 분기하지 않게 하는 것이 목적이다.
 */
export async function saveDraftResponseIfActive(
  input: SaveDraftResponseInput,
): Promise<SaveDraftIfActiveResult> {
  const row = await db.query.surveyResponses.findFirst({
    where: eq(surveyResponses.id, input.responseId),
    columns: { id: true, status: true, deletedAt: true },
  });
  const gateResult = judgeRowGate(row);
  if (gateResult) return gateResult;

  try {
    const result = await saveDraftResponse(input);
    // 지연 도착한 stale/concluded beacon — 답변 쓰기 자체를 하지 않았으므로 최신 답변은 그대로 남는다.
    if (!result.applied) return { saved: false, skipped: result.concluded ? 'concluded' : 'stale' };
  } catch (err) {
    if (err instanceof SurveyNotAcceptingResponsesError) {
      return { saved: false, skipped: toSkipReason(err.reason) };
    }
    // 게이트 통과 후 저장 사이에 행이 종결·삭제됐을 수 있다(제출 직후 탭 닫기 등). 다시
    // 읽어 확인되면 정상 skip 으로 접는다. 에러 메시지 문자열을 파싱하지 않는 이유는 이
    // 래퍼의 존재 이유(정상 시나리오를 throw 문자열 매칭 없이 판정)와 같다.
    const recheckRow = await db.query.surveyResponses.findFirst({
      where: eq(surveyResponses.id, input.responseId),
      columns: { id: true, status: true, deletedAt: true },
    });
    const recheckResult = judgeRowGate(recheckRow);
    if (recheckResult) return recheckResult;
    throw err;
  }
  return { saved: true };
}

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


