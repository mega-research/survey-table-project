
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import 'server-only';

import { type DbTransaction, db } from '@/db';
import {
  questions,
  surveyResponses,
} from '@/db/schema';
import {
  encryptAnswerValue,
} from '@/lib/crypto/response-pii';
import { getSurveyControlFlags } from '@/server/read-models/survey-control';
import {
  lockAndAssertResponseMutation,
} from './test-target-attempt';

import { ongoingResponseDenial } from '../domain/acceptance';

import type {
  SurveyResponse,
  UpdateQuestionResponseInput,
} from '../domain/response';
import {
  SurveyNotAcceptingResponsesError,
} from './response-gate';
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
export async function assertQuestionBelongsToResponse(
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
export async function applyQuestionResponseUpdate(
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
export async function loadResponseRowForMutation(responseId: string): Promise<ResponseMutationRow> {
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
export async function assertSurveyNotPaused(
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
export async function loadQuestionPiiFlags(
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
