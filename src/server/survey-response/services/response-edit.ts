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
import { decryptQuestionResponses, encryptResponsesForStorage } from '@/lib/crypto/response-pii';
import { logger } from '@/lib/logger';
import { resolveWriteScopeIsTest } from '@/server/data-scope';
import { buildChangedQuestions, diffQuestionResponses } from '@/lib/operations/response-edit-diff';
import { calculateProgressPct } from '@/lib/operations/response-progress';
import { getProgressSnapshot } from './response-progress';
import { withCalcValues } from '@/lib/survey/cell-formula';
import { stripDisabledCellValues } from '@/lib/survey/cell-gating';
import { loadVersionSnapshot } from '@/server/read-models/version-snapshot';
import type { SurveyVersionSnapshot } from '@/shared/contracts/survey';
import type { Question, SurveyLookup } from '@/types/survey';

import type { SaveAdminEditInput } from '../domain/response-edit';
import { replaceResponseAnswers } from './response-answers';
import { assertAnswerValueSize, loadPiiQuestionIds } from './submitted-answers';

export { SurveyOwnershipError };

/** 응답 편집 거부 사유. */
export type ResponseEditErrorReason =
  | 'response_not_found'
  | 'response_deleted'
  | 'version_conflict';

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
 * - completedAt / status / startedAt / totalSeconds 는 명시적으로 set 하지 않아 보존됨.
 *   예외(2026-08-11): 이탈(drop) 응답은 저장 시 completed 로 전환한다 — drop 은 sweep 이
 *   비활동으로 자동 부여한 상태라 응답자 확정 종결이 아니고, 운영자가 수정 화면에서 채워
 *   제출하는 행위가 곧 완료 확정이다. completed 재수정은 답만 갱신(상태 불변),
 *   in_progress 는 응답자 세션을 방해하지 않도록 전환하지 않는다.
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

  const isTest = resolveWriteScopeIsTest(ownerRow.testModeEnabled, isGuest);

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
  // 클라 제출값 기준 diff — 아래 calc 재계산 대상 조회 여부를 결정하는 게이트로만 쓰고,
  // audit 로 남길 최종 changedIds/changedQuestions 는 재계산 이후(아래) 다시 확정한다.
  // (재계산이 cross-question 수식이나 payload 에 없던 calc 질문까지 값을 바꿀 수 있어
  // 클라 diff 만으로는 "실제로 DB 값이 바뀐 질문"을 다 못 잡는다.)
  const clientChangedIds = diffQuestionResponses(prevResponses, questionResponses);
  // calc 셀 재계산(아래)에서도 재사용 — 변경이 없으면(=재계산 대상도 없음) 조회 자체를 skip.
  let versionSnapshot: SurveyVersionSnapshot | null = null;
  if (clientChangedIds.length > 0) {
    versionSnapshot = await loadVersionSnapshot(effectiveVersionId);
  }

  // 이탈(drop) 완료 전환 여부 — 아래 UPDATE set 과 progress 분기, 컨택 후처리가 공유한다.
  const completesDrop = existing.status === 'drop';

  // progress_pct 재계산: completed(및 이번 저장으로 완료 전환되는 drop)는 100,
  // 그 외는 snapshot 기반 재계산.
  // status 기준 분기 (progressPct === 100 가 아님) — 99% drop 이 우연히 100 으로 반올림된 경우를
  // completed 로 오분류하지 않기 위해.
  let nextProgressPct: number | null;
  if (existing.status === 'completed' || completesDrop) {
    nextProgressPct = 100;
  } else {
    const { positionMap, totalQuestions } = await getProgressSnapshot(effectiveVersionId);
    nextProgressPct = calculateProgressPct(
      Object.keys(questionResponses),
      positionMap,
      totalQuestions,
    );
  }

  // calc 셀 서버 재계산 (스펙 §5) — 클라 저장 경로(draft flush/beacon/제출)와 동일한 순수
  // 함수 withCalcValues 를 서버에서도 다시 태운다(신뢰 경계: 클라 주입값을 그대로 믿지 않음).
  // 반드시 평문 단계(위 diff 비교 이후, 아래 encryptResponsesForStorage 이전)에서 수행 —
  // 암호문을 수식에 넣으면 쓰레기 값이 나온다.
  // 재계산은 이번 저장이 기준 삼는 버전(렌더 버전, 미배포만 응답 버전 폴백) 스냅샷 기준이다 —
  // 빌더가 이후 수식을 바꿔도 이미 수집된 이 응답에는 적용되지 않는다(스펙 요구사항).
  // clientChangedIds 가 없으면(=diff 없음)
  // versionSnapshot 을 아예 조회하지 않았으므로 이 블록은 자연히 skip 된다.
  // fail-safe: 스냅샷을 못 얻으면(레거시 versionId=null, 버전 행 삭제 등) 재계산을 건너뛰고
  // 기존 값을 그대로 유지한다 — 운영자의 정당한 수정이 서버 오류로 통째로 실패해선 안 된다.
  // 결과는 questionResponses 를 직접 mutate 하지 않고 finalResponses 로 따로 들고 있는다 —
  // input.questionResponses 를 in-place 로 건드리면 이후 호출부가 원본 input 을 재사용/로깅할
  // 때 조용히 값이 달라져 있는 사고를 유발할 수 있다.
  let finalResponses = questionResponses;
  if (versionSnapshot) {
    // contracts/survey 의 SurveyVersionSnapshot 은 questions/lookups 필드 값이 항상 채워져 있다는
    // 보장이 타입 레벨엔 없다(questions 는 필수로 선언돼 있지만 손상된 스냅샷 행이 들어오면
    // undefined/비배열일 수 있음, lookups 는 아예 타입에 없음) — buildChangedQuestions
    // (response-edit-diff.ts:40, `snapshot?.questions ?? []`)와 동일하게 방어적으로 읽는다.
    // lookups 는 buildSurveySnapshot(lib/versioning/snapshot-builder.ts) 이 publish 시 항상
    // 함께 freeze 해 넣지만(survey-read.service.ts 의 snapshot.lookups 사용과 동일 근거)
    // 타입에 없으므로 안전 단언 캐스팅.
    const rawSnapshotForCalc = versionSnapshot as unknown as {
      questions?: unknown;
      lookups?: unknown;
    };
    // JSONB 스키마 드리프트 방어 — questions/lookups 가 비배열(객체·문자열)이면
    // withCalcValues 순회나 lookup find 에서 크래시해 운영자 수정 전체가 실패한다.
    // Array.isArray 로 걸러 손상 스냅샷에서도 재계산만 조용히 스킵되게 한다.
    const snapshotForCalc = {
      questions: Array.isArray(rawSnapshotForCalc.questions)
        ? (rawSnapshotForCalc.questions as Question[])
        : [],
      lookups: Array.isArray(rawSnapshotForCalc.lookups)
        ? (rawSnapshotForCalc.lookups as SurveyLookup[])
        : [],
    };

    let contactAttrs: Record<string, string | undefined> = {};
    if (existing.contactTargetId) {
      const [target] = await db
        .select({ attrs: contactTargets.attrs })
        .from(contactTargets)
        .where(eq(contactTargets.id, existing.contactTargetId))
        .limit(1);
      contactAttrs = (target?.attrs ?? {}) as Record<string, string | undefined>;
    }

    // 게이팅 strip → calc 재계산 순서 — 운영자 수정도 응답자 플로우와 같은 신뢰 경계:
    // 비활성 셀에 실려온 값은 저장하지 않고, 수식은 지워진 값 기준으로 계산한다.
    const strippedResponses = stripDisabledCellValues(
      snapshotForCalc.questions ?? [],
      questionResponses,
    );
    finalResponses = withCalcValues(strippedResponses, {
      questions: snapshotForCalc.questions ?? [],
      responses: strippedResponses,
      lookups: snapshotForCalc.lookups ?? [],
      contactAttrs,
    });
  }

  // 변경 질문 확정 (audit 용). 재계산이 실제로 일어난 경우(versionSnapshot 이 있는 경우)엔
  // prevResponses ↔ finalResponses(재계산 이후) 를 다시 diff 한다 — withCalcValues 는
  // ctx.questions 전체를 순회해 calc 셀이 있는 모든 질문을 다시 계산하므로, 클라가 직접
  // 건드리지 않은 질문(다른 질문 값 변경으로 트리거된 cross-question 수식, 혹은 payload 에
  // 아예 없다가 새로 채워진 calc 질문)도 DB 값이 바뀔 수 있다 — clientChangedIds 만 쓰면
  // 그 변경이 edit log 에서 누락된다. finalResponses 는 클라의 명시적 변경분을 그대로 포함한
  // 상위집합이므로 이 diff 하나로 "운영자가 고친 것" + "재계산으로 바뀐 것"을 함께 잡는다.
  // (재계산이 없었던 경우, 즉 versionSnapshot 이 null 이면 clientChangedIds 를 그대로 쓴다.)
  const changedIds = versionSnapshot
    ? diffQuestionResponses(prevResponses, finalResponses)
    : clientChangedIds;
  const changedQuestions = buildChangedQuestions(changedIds, versionSnapshot);

  // 저장은 재암호화 — 판단 기준은 응답의 versionId 스냅샷(레거시 null 은 questions 폴백).
  const piiIds = await loadPiiQuestionIds(effectiveVersionId, surveyId);
  const storedResponses =
    piiIds.size > 0 ? encryptResponsesForStorage(finalResponses, piiIds) : finalResponses;

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
        // 이탈 응답 완료 전환 (상단 docstring 예외 참조) — 그 외 상태는 보존.
        ...(completesDrop
          ? { status: 'completed' as const, isCompleted: true, completedAt: now }
          : {}),
        // 구버전 응답 이관 (스펙 결정 5) — versionId 재고정 + 원본 1회 백업.
        // adminEditRollback/migratedFromVersionId 는 COALESCE 로 최초 이관 값을 보존한다
        // (재수정해도 원본 유지). 백업의 questionResponses 는 DB 암호문 그대로 —
        // 평문 PII 를 metadata 에 남기지 않는다.
        ...(migrating
          ? {
              versionId: input.versionId,
              metadata: buildMigrationMetadataSql({
                versionId: existing.versionId,
                questionResponses: existing.questionResponses ?? {},
                savedAt: now.toISOString(),
              }),
            }
          : {}),
      })
      .where(
        and(
          eq(surveyResponses.id, responseId),
          eq(surveyResponses.surveyId, surveyId),
          eq(surveyResponses.isTest, isTest),
          isNull(surveyResponses.deletedAt),
        ),
      )
      .returning({ id: surveyResponses.id });

    if (updated.length === 0) {
      throw new ResponseEditError('response_deleted');
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
