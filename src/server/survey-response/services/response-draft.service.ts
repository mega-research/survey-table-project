import { and, eq, isNull, sql } from 'drizzle-orm';
import 'server-only';

import { db } from '@/db';
import { surveyResponses } from '@/db/schema';
import { encryptAnswerValue } from '@/lib/crypto/response-pii';
import { readOptTextsSidecar } from '@/lib/option-text-read';

import type { SaveDraftResponseInput } from '../domain/response';
import {
  assertSurveyNotPaused,
  loadQuestionPiiFlags,
  loadResponseRowForMutation,
} from './response-answer-write';
import { SurveyNotAcceptingResponsesError } from './response-gate';
import { assertAnswerValueSize } from './submitted-answers';
import { lockAndAssertResponseMutation } from './test-target-attempt.server';

/**
 * 이탈 시점 임시 저장(draft) — 답변 일괄 병합, 순번(draftSeq) 선점, 활성 행일 때만 저장.
 *
 * 응답 행 쓰기 공통(response-answer-write)만 부른다. 진입·완료 경로를 부르지 않는다(순환 금지).
 */

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
