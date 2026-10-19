import { and, eq, isNull, sql } from 'drizzle-orm';
import 'server-only';

import { db } from '@/db';
import {
  contactTargets,
  responseEditLogs,
  surveyResponses,
  surveys,
} from '@/db/schema';
import { SurveyOwnershipError } from '@/lib/auth/require-survey-ownership';
import { decryptQuestionResponses } from '@/lib/crypto/response-pii';
import { logger } from '@/lib/logger';
import { readBrowserTestView, resolveWriteScopeIsTest } from '@/server/data-scope';
import { buildChangedQuestions, diffQuestionResponses } from '@/lib/operations/response-edit-diff';
import { calculateProgressPct, getProgressSnapshot } from './response-progress';

import type { SaveAdminEditInput } from '../domain/response-edit';
import { replaceResponseAnswers } from './response-answers';
import { finalizeAnswers, loadFinalizationMaterial } from './answer-finalization';
import { assertAnswerValueSize, detectQuotaOverflow } from './submitted-answers';

export { SurveyOwnershipError };

/** 응답 편집 거부 사유. */
export type ResponseEditErrorReason =
  | 'response_not_found'
  | 'response_deleted'
  | 'version_conflict'
  | 'status_conflict';

/**
 * 응답 편집 거부. procedure 가 메시지 문자열이 아니라 reason 으로 분기한다 —
 * 문구를 손대면 매핑이 조용히 죽던 자리였다(SurveyNotAcceptingResponsesError 와 같은 형태).
 * 여기 메시지는 로그용이고 사용자에게 보이는 문구는 procedure 가 따로 만든다.
 */
export class ResponseEditError extends Error {
  readonly reason: ResponseEditErrorReason;

  constructor(reason: ResponseEditErrorReason) {
    super(`응답을 수정할 수 없습니다. (${reason})`);
    this.name = 'ResponseEditError';
    this.reason = reason;
  }
}

/** 이관 시 metadata 갱신 sql 조각 — adminEditRollback 1회 백업 (+ 출처 버전 기록) */
function buildMigrationMetadataSql(rollback: {
  versionId: string | null;
  questionResponses: unknown;
  savedAt: string;
}) {
  const withRollback = sql`jsonb_set(
    COALESCE(${surveyResponses.metadata}, '{}'::jsonb),
    '{adminEditRollback}',
    COALESCE(${surveyResponses.metadata}->'adminEditRollback', ${JSON.stringify(rollback)}::jsonb),
    true
  )`;
  if (rollback.versionId === null) return withRollback;
  return sql`jsonb_set(
    ${withRollback},
    '{migratedFromVersionId}',
    COALESCE(${surveyResponses.metadata}->'migratedFromVersionId', to_jsonb(${rollback.versionId}::text)),
    true
  )`;
}

/**
 * 어드민 응답 수정 저장.
 *
 * - questionResponses (JSONB) 와 response_answers 정규화 행을 일괄 갱신.
 * - startedAt / totalSeconds 는 명시적으로 set 하지 않아 보존됨.
 *   예외 1 (2026-08-11): 이탈(drop) 응답은 저장 시 completed 로 전환한다 — drop 은 sweep 이
 *   비활동으로 자동 부여한 상태라 응답자 확정 종결이 아니고, 운영자가 수정 화면에서 채워
 *   제출하는 행위가 곧 완료 확정이다.
 *   예외 2: 종결 응답(completed·screened_out, 그리고 이번 저장으로 완료 전환되는 drop)은
 *   자격미달을 다시 판정해 completed ⇄ screened_out 을 오간다 — 운영자가 조건 문항을
 *   고쳤는데 상태가 따라오지 않으면 자격미달이 영구히 붙박이가 된다. in_progress 는
 *   응답자 세션을 방해하지 않도록, quotaful_out·bad 는 자격미달과 다른 축의 종결이라
 *   건드리지 않는다.
 * - lastEditedAt / lastActivityAt 은 갱신, currentStepId 는 null 로 초기화.
 * - 삭제(soft delete)된 응답은 거부. 트랜잭션 안 UPDATE WHERE 에 isNull(deletedAt) 가드를
 *   둬서 사전 검사 이후 동시 soft delete 가 끼어드는 TOCTOU 도 차단한다.
 * - progress_pct: status='completed' 면 100 유지, 그 외는 questionResponses 키 → snapshot
 *   position 매핑으로 재계산. 답변 0개면 NULL 로 reset.
 * - snapshot 은 트랜잭션 바깥에서 조회 — 동시 버전 publish 시 progress_pct 가 일시적으로
 *   구버전 기준이 될 수 있음. 다음 답변/완료 시 재계산되므로 데이터 손실은 없음.
 *
 * spread 사용 금지 — 명시적 set 만.
 *
 * 인증은 authed 미들웨어가 담당. 단 소유권 검증(surveys row 존재 확인)은 인증과
 * 별개이므로 service 안에 보존한다 — 없는 설문이면 SurveyOwnershipError('not_found').
 * 캐시 갱신(revalidatePath)은 소비처 router.push 로 대체한다.
 *
 * isGuest 는 procedure 가 이미 인증한 context.user.id 에서 파생해 전달한다(다른
 * feature 의 scoped 절차와 동일 패턴) — 게스트는 전역 테스트 모드 플래그와 무관하게
 * 항상 real 파티션만 읽고 쓴다. select/UPDATE 모두 resolveWriteScopeIsTest 로 확정한
 * isTest 값으로 스코프를 좁혀, 테스트 파티션 responseId 를 알아내도 편집이 닿지 않게
 * 한다 — 파티션이 안 맞으면 존재하지 않는 응답과 동일하게 response_not_found 로 처리.
 */
export async function saveAdminEdit(
  input: SaveAdminEditInput,
  editor: { id: string | null; email: string | null },
  isGuest: boolean,
): Promise<{ ok: true }> {
  const { surveyId, responseId, questionResponses } = input;

  // 소유권 검증 — surveys row 존재 확인 (require-survey-ownership.ts 패턴 인라인 복제)
  // testModeEnabled 도 함께 읽어 쓰기 파티션 산정에 재사용 — 별도 쿼리를 추가하지 않는다.
  const ownerRow = await db.query.surveys.findFirst({
    where: eq(surveys.id, surveyId),
    columns: { id: true, testModeEnabled: true, currentVersionId: true },
  });
  if (!ownerRow) throw new SurveyOwnershipError('not_found');

  // 낙관 버전 가드 (스펙 결정 4) — 클라이언트가 렌더한 버전이 저장 시점의 현재 배포
  // 버전과 다르면 저장을 거부한다. 입력 구조와 저장 버전의 불일치를 원천 차단하는 게
  // 목적이므로, 입력값 보존 없이 새로고침 재진입을 요구한다.
  if (input.versionId !== (ownerRow.currentVersionId ?? null)) {
    throw new ResponseEditError('version_conflict');
  }

  const isTest = resolveWriteScopeIsTest(
    ownerRow.testModeEnabled,
    isGuest,
    await readBrowserTestView(surveyId),
  );

  const existing = await db.query.surveyResponses.findFirst({
    where: and(
      eq(surveyResponses.id, responseId),
      eq(surveyResponses.surveyId, surveyId),
      eq(surveyResponses.isTest, isTest),
    ),
  });
  if (!existing) throw new ResponseEditError('response_not_found');
  if (existing.deletedAt !== null) {
    throw new ResponseEditError('response_deleted');
  }

  // 이번 저장이 기준으로 삼는 버전 — 렌더 버전(=현재 배포 버전). 미배포 설문(null)만
  // 응답 자신의 버전으로 폴백해 기존 동작을 유지한다.
  const effectiveVersionId = input.versionId ?? existing.versionId;
  const migrating = input.versionId !== null && existing.versionId !== input.versionId;

  const now = new Date();

  // 바뀐 질문 추출 (audit 용). 변경 0개면 audit 행 미생성.
  // diff 는 평문끼리 비교한다 — DB 의 암호문 prev 와 입력 평문을 그대로 비교하면
  // 손대지 않은 PII 문항도 매번 "변경됨"으로 edit log 에 남는다.
  const prevResponses = decryptQuestionResponses(
    (existing.questionResponses ?? {}) as Record<string, unknown>,
    { responseId },
  );
  // 이탈(drop) 완료 전환 여부 — 아래 UPDATE set 과 progress 분기, 컨택 후처리가 공유한다.
  const completesDrop = existing.status === 'drop';

  // progress_pct 재계산: completed(및 이번 저장으로 완료 전환되는 drop)는 100,
  // 그 외는 snapshot 기반 재계산.
  // status 기준 분기 (progressPct === 100 가 아님) — 99% drop 이 우연히 100 으로 반올림된 경우를
  // completed 로 오분류하지 않기 위해.
  // 자격미달(screened_out)도 종결이라 100 이다 — completeResponse 가 그렇게 적는다.
  // 빼면 자격미달 응답을 한 번 수정할 때마다 진척률이 조용히 떨어진다.
  let nextProgressPct: number | null;
  if (
    existing.status === 'completed' ||
    existing.status === 'screened_out' ||
    completesDrop
  ) {
    nextProgressPct = 100;
  } else {
    const { positionMap, totalQuestions } = await getProgressSnapshot(effectiveVersionId);
    nextProgressPct = calculateProgressPct(
      Object.keys(questionResponses),
      positionMap,
      totalQuestions,
    );
  }

  // 응답 확정 (CONTEXT.md 「응답 확정」) — 운영자 수정도 응답자 플로우와 같은 신뢰 경계다.
  // 숨은 문항 strip → 게이팅 strip → calc 재계산 → 등록 사이드카만 → 자격미달 판정 → 암호화.
  // 기준은 이번 저장이 기준 삼는 버전(렌더 버전, 미배포만 응답 버전 폴백) 스냅샷이다 — 빌더가
  // 이후 수식을 바꿔도 이미 수집된 이 응답에는 적용되지 않는다.
  //
  // **바뀐 문항이 없어도 늘 확정한다.** 변경이 없으면 스냅샷을 읽지 않던 시절, 아무것도 안 고친
  // 이탈 응답이 strip·자격미달 판정 없이 completed 로 확정됐다(2026-10-19 수리).
  //
  // **구버전 응답 이관(migrating)에는 숨은 문항 strip 을 걸지 않는다.** 이 응답이 수집된 버전과
  // 지금 저장 기준이 되는 버전이 다르면, 재배포로 새로 생기거나 좁혀진 표시 조건이 이미 수집된
  // 답을 소급해 지운다 — 스펙 결정 "이미 수집된 응답은 소급 정리하지 않는다" 정면 위반이고,
  // 편집 화면도 그 문항을 그리지 않아 운영자는 손실을 볼 수조차 없다(edit log 는 값을 남기지
  // 않아 복구 불가). 클라이언트 쪽 같은 게이트는 survey-response-flow.tsx 에 있다.
  //
  // 스냅샷을 못 얻으면(레거시 versionId=null, 버전 행 삭제, 손상 행) 확정 단계를 건너뛰고 제출값을
  // 그대로 저장한다 — 운영자의 정당한 수정이 서버 오류로 통째로 실패해선 안 된다.
  const material = await loadFinalizationMaterial({
    surveyId,
    versionId: effectiveVersionId,
    contactTargetId: existing.contactTargetId,
    responseId,
  });
  const finalized = finalizeAnswers(material, questionResponses, { skipHiddenStrip: migrating });
  const finalResponses = finalized.plain;

  // 변경 질문 확정 (audit 용) — 이전 값 ↔ 확정 평문. 확정은 스냅샷의 calc 셀을 전부 다시 계산하므로
  // 클라가 직접 건드리지 않은 질문(cross-question 수식, payload 에 없다가 새로 채워진 calc 질문)이나
  // strip 으로 지워진 질문도 DB 값이 바뀔 수 있다 — 그 변경까지 edit log 에 잡는다.
  const changedIds = diffQuestionResponses(prevResponses, finalResponses);
  const changedQuestions = buildChangedQuestions(changedIds, material.snapshot);

  // ── 자격미달 양방향 재판정 ───────────────────────────────────────────────
  // 운영자가 자격미달 조건 문항을 고치면 상태도 따라가야 한다. 종전에는 status 를
  // 아예 set 하지 않아, 조건을 풀어 줘도 screened_out 이 그대로 남았다(실제 사고).
  //
  // 대상은 종결 응답(completed·screened_out)과 이번 저장으로 완료 전환되는 drop 뿐이다.
  // in_progress 는 응답자 세션 중이라 건드리지 않고(기존 규약), quotaful_out·bad 는
  // 자격미달과 다른 축의 종결이라 재판정이 덮어써선 안 된다.
  //
  // 판정은 응답 확정이 확정 평문으로 한다(암호화 이전이어야 분기 매칭이 성립한다). 스냅샷을
  // 못 얻으면(레거시 versionId, 손상 행) 판정이 null 이라 기존 상태를 보존한다 — 운영자의 정당한
  // 수정이 판정 불능으로 실패하거나 조용히 강등되지 않게 하는 fail-safe.
  const reJudgeable =
    existing.status === 'completed' || existing.status === 'screened_out' || completesDrop;
  const screenedOut = reJudgeable ? finalized.screenedOut : null;

  // 종결 상태 set — 재판정이 돌았으면 그 결과가, 안 돌았으면 기존 drop→completed 예외만
  // 반영된다. completedAt 은 이미 있으면 보존한다(자격미달도 완료 시점에 기록된다).
  const terminalStatusSet: {
    status?: 'completed' | 'screened_out';
    isCompleted?: boolean;
    completedAt?: Date;
  } =
    screenedOut === null
      ? completesDrop
        ? { status: 'completed', isCompleted: true, completedAt: now }
        : {}
      : {
          status: screenedOut ? 'screened_out' : 'completed',
          // 자격미달은 완료 수 분자에서 빠진다 — completeResponse 와 같은 규칙.
          isCompleted: !screenedOut,
          ...(existing.completedAt === null ? { completedAt: now } : {}),
        };

  // 이탈→완료 전환의 쿼터 — 운영자가 만드는 완료라 「진행 중 마감」 하드 차단을 타지 않는다
  // (ADR 0025: 하드 차단은 경합 초과를 막는 것이지 운영자의 결정을 뒤집는 것이 아니다).
  // 찬 셀이면 기존 초과 표식(metadata.quotaOverflow)만 남긴다. 판정은 평문 finalResponses
  // 기준(암호화 이전)이고 attrs 는 응답 행의 연결로 서버가 읽는다. 테스트 파티션은 쿼터를
  // 소비하지 않으므로 보지 않는다. 종결 응답의 일반 수정은 완료 수가 늘지 않아 판정하지 않는다.
  // 자격미달로 판정된 전환은 완료 수에 들지 않아 표식을 남기지 않는다.
  const quotaOverflow =
    completesDrop && !existing.isTest && screenedOut !== true
      ? await detectQuotaOverflow(surveyId, finalResponses, existing.contactTargetId)
      : false;

  // metadata 갱신 조각 — 이관 백업(1회)과 초과 표식을 한 조각으로 합친다. 둘 다 기존 키를
  // 보존하는 jsonb 병합이라 통째 대입이 없다.
  const migrationMetadataSql = migrating
    ? buildMigrationMetadataSql({
        versionId: existing.versionId,
        questionResponses: existing.questionResponses ?? {},
        savedAt: now.toISOString(),
      })
    : null;
  const metadataSql = quotaOverflow
    ? sql`${migrationMetadataSql ?? sql`COALESCE(${surveyResponses.metadata}, '{}'::jsonb)`} || '{"quotaOverflow":true}'::jsonb`
    : migrationMetadataSql;

  // 저장값 — 판단 기준은 이번 저장 버전 스냅샷(레거시 null 은 questions 폴백)의 암호화 대상.
  const storedResponses = finalized.stored;

  // 크기 가드 — 응답자 경로와 같은 임계·같은 에러(assertAnswerValueSize)를 쓴다. 종전에는
  // 이 경로에만 가드가 전무해 questionResponses 가 verbatim UPDATE 됐다(입력 zod 도 검증자
  // 없는 z.custom 이라 통과). 판정 기준이 적재되는 값이라 암호화 이후 한 번만 재면 평문·
  // 암호문이 함께 덮인다. 관리자 편집은 여러 질문을 한 UPDATE 로 쓰므로 질문별로 잰다.
  // 응답자 경로의 silent drop 과 달리 throw 하는 이유: 운영자의 명시적 수정을 조용히 버리는
  // 것이 저장 실패를 알리는 것보다 나쁘다. procedure 가 BAD_REQUEST 로 접는다.
  for (const value of Object.values(storedResponses)) {
    assertAnswerValueSize(value);
  }

  await db.transaction(async (tx) => {
    // deletedAt 검사(line 61)와 이 UPDATE 사이에 동시 softDeleteResponse 가 deletedAt 을
    // 세팅하는 TOCTOU 를 차단한다. WHERE 에 isNull(deletedAt) 를 추가하고 .returning() 으로
    // 영향 행 수를 확인 — 0행이면 경합에서 삭제가 이겼으므로 throw 해 트랜잭션 전체(answers
    // 재작성·edit log)를 롤백한다 (BAD_REQUEST 로 매핑됨).
    const updated = await tx
      .update(surveyResponses)
      .set({
        questionResponses: storedResponses,
        lastEditedAt: now,
        lastActivityAt: now,
        currentStepId: null,
        progressPct: nextProgressPct,
        // 이탈 응답 완료 전환 + 자격미달 양방향 재판정 (위 블록 참조).
        // 그 밖의 상태(in_progress·quotaful_out·bad)는 보존된다.
        ...terminalStatusSet,
        // 구버전 응답 이관 (스펙 결정 5) — versionId 재고정 + 원본 1회 백업.
        // adminEditRollback/migratedFromVersionId 는 COALESCE 로 최초 이관 값을 보존한다
        // (재수정해도 원본 유지). 백업의 questionResponses 는 DB 암호문 그대로 —
        // 평문 PII 를 metadata 에 남기지 않는다.
        ...(migrating ? { versionId: input.versionId } : {}),
        ...(metadataSql ? { metadata: metadataSql } : {}),
      })
      .where(
        and(
          eq(surveyResponses.id, responseId),
          eq(surveyResponses.surveyId, surveyId),
          eq(surveyResponses.isTest, isTest),
          isNull(surveyResponses.deletedAt),
          // 종결 상태를 쓰는 저장은 조회 당시 상태가 그대로일 때만 통과한다. terminalStatusSet 은
          // 트랜잭션 밖에서 읽은 existing.status 로 정해지므로, 그 사이 재응답 허용이
          // in_progress 로 되돌렸다면 이 UPDATE 가 completed·screened_out 을 다시 덮어쓴다 —
          // 재응답 허용이 지운 completedAt·컨택 완료 링크는 복원되지 않아 상태와 연결이 어긋난다.
          ...(terminalStatusSet.status !== undefined
            ? [eq(surveyResponses.status, existing.status)]
            : []),
        ),
      )
      .returning({ id: surveyResponses.id });

    if (updated.length === 0) {
      // 0행의 원인은 둘이다 — 동시 삭제, 또는 위 상태 가드. 삭제가 아니면 상태 충돌이다.
      const [current] = await tx
        .select({ deletedAt: surveyResponses.deletedAt })
        .from(surveyResponses)
        .where(and(eq(surveyResponses.id, responseId), eq(surveyResponses.surveyId, surveyId)));
      throw new ResponseEditError(
        current && current.deletedAt === null ? 'status_conflict' : 'response_deleted',
      );
    }

    await replaceResponseAnswers(tx, responseId, surveyId, storedResponses);

    if (changedQuestions.length > 0) {
      await tx.insert(responseEditLogs).values({
        responseId,
        surveyId,
        editedBy: editor.id,
        editorEmail: editor.email,
        changedQuestions,
        changedCount: changedQuestions.length,
      });
    }
  });

  // 이탈→완료 전환 시 컨택 매칭 후처리 — completeResponse 의 실데이터 경로와 동일하게
  // 트랜잭션 밖 best-effort 로 유지한다 (response → target 순서를 tx 에 넣으면
  // target → response 순서인 컨택 삭제/hard reset 과 교착 가능). 실패해도 완료 전환은
  // 이미 커밋됐으므로 롤백하지 않는다. 테스트 파티션 행은 대상자 테스트 잠금 순서
  // 의미론이 별도라 건드리지 않는다.
  if (completesDrop && existing.contactTargetId && !existing.isTest) {
    try {
      await db
        .update(contactTargets)
        .set({ respondedAt: now, responseId, updatedAt: now })
        .where(
          and(
            eq(contactTargets.id, existing.contactTargetId),
            eq(contactTargets.surveyId, surveyId),
          ),
        );
    } catch (err) {
      logger.error(
        { surveyId, responseId, contactTargetId: existing.contactTargetId, err },
        '[saveAdminEdit] contact_targets UPDATE 실패 — 이탈→완료 전환은 성공',
      );
    }
  }

  return { ok: true as const };
}
