import 'server-only';

import { and, eq, isNull } from 'drizzle-orm';

import { db } from '@/db';
import {
  surveyResponses,
  surveys,
  surveyVersions,
  responseEditLogs,
  contactTargets,
} from '@/db/schema';
import type { SurveyVersionSnapshot } from '@/db/schema/schema-types';
import { replaceResponseAnswers } from './response-answers.service';
import { calculateProgressPct } from '@/lib/operations/response-progress';
import { getProgressSnapshot } from '@/lib/operations/response-progress.server';
import {
  buildChangedQuestions,
  diffQuestionResponses,
} from '@/lib/operations/response-edit-diff';
import { SurveyOwnershipError } from '@/lib/auth/require-survey-ownership';
import { decryptQuestionResponses, encryptResponsesForStorage } from '@/lib/crypto/response-pii';
import { withCalcValues } from '@/lib/survey/cell-formula';
import { loadPiiQuestionIds } from './response.service';

import type { Question, SurveyLookup } from '@/types/survey';
import type { SaveAdminEditInput } from '../../domain/response-edit';

// 'Response not found' / 'Cannot edit deleted response' throw 메시지는 그대로 두고
// procedure 가 ORPCError 로 매핑한다.
export { SurveyOwnershipError };

/**
 * 어드민 응답 수정 저장.
 *
 * - questionResponses (JSONB) 와 response_answers 정규화 행을 일괄 갱신.
 * - completedAt / status / startedAt / totalSeconds 는 명시적으로 set 하지 않아 보존됨.
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
 */
export async function saveAdminEdit(
  input: SaveAdminEditInput,
  editor: { id: string | null; email: string | null },
): Promise<{ ok: true }> {
  const { surveyId, responseId, questionResponses } = input;

  // 소유권 검증 — surveys row 존재 확인 (require-survey-ownership.ts 패턴 인라인 복제)
  const ownerRow = await db.query.surveys.findFirst({
    where: eq(surveys.id, surveyId),
    columns: { id: true },
  });
  if (!ownerRow) throw new SurveyOwnershipError('not_found');

  const existing = await db.query.surveyResponses.findFirst({
    where: and(
      eq(surveyResponses.id, responseId),
      eq(surveyResponses.surveyId, surveyId),
    ),
  });
  if (!existing) throw new Error('Response not found');
  if (existing.deletedAt !== null) {
    throw new Error('Cannot edit deleted response');
  }

  const now = new Date();

  // 바뀐 질문 추출 (audit 용). 변경 0개면 audit 행 미생성.
  // diff 는 평문끼리 비교한다 — DB 의 암호문 prev 와 입력 평문을 그대로 비교하면
  // 손대지 않은 PII 문항도 매번 "변경됨"으로 edit log 에 남는다.
  const prevResponses = decryptQuestionResponses(
    (existing.questionResponses ?? {}) as Record<string, unknown>,
    { responseId },
  );
  const changedIds = diffQuestionResponses(prevResponses, questionResponses);
  let changedQuestions: ReturnType<typeof buildChangedQuestions> = [];
  // calc 셀 재계산(아래)에서도 재사용 — 변경이 없으면(=재계산 대상도 없음) 조회 자체를 skip.
  let versionSnapshot: SurveyVersionSnapshot | null = null;
  if (changedIds.length > 0) {
    const [verRow] = existing.versionId
      ? await db
          .select({ snapshot: surveyVersions.snapshot })
          .from(surveyVersions)
          .where(eq(surveyVersions.id, existing.versionId))
          .limit(1)
      : [];
    versionSnapshot = (verRow?.snapshot ?? null) as SurveyVersionSnapshot | null;
    changedQuestions = buildChangedQuestions(changedIds, versionSnapshot);
  }

  // progress_pct 재계산: completed 는 100 유지, 그 외는 snapshot 기반 재계산.
  // status 기준 분기 (progressPct === 100 가 아님) — 99% drop 이 우연히 100 으로 반올림된 경우를
  // completed 로 오분류하지 않기 위해.
  let nextProgressPct: number | null;
  if (existing.status === 'completed') {
    nextProgressPct = 100;
  } else {
    const { positionMap, totalQuestions } = await getProgressSnapshot(existing.versionId);
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
  // 재계산은 응답이 답해진 시점의 버전 스냅샷 기준이다 — 빌더가 이후 수식을 바꿔도 이미
  // 수집된 이 응답에는 적용되지 않는다(스펙 요구사항). changedIds 가 없으면(=diff 없음)
  // versionSnapshot 을 아예 조회하지 않았으므로 이 블록은 자연히 skip 된다.
  // fail-safe: 스냅샷을 못 얻으면(레거시 versionId=null, 버전 행 삭제 등) 재계산을 건너뛰고
  // 기존 값을 그대로 유지한다 — 운영자의 정당한 수정이 서버 오류로 통째로 실패해선 안 된다.
  if (versionSnapshot) {
    // schema-types.SurveyVersionSnapshot 은 lookups 필드를 타입에 선언하지 않지만
    // buildSurveySnapshot(lib/versioning/snapshot-builder.ts) 이 publish 시 항상 함께
    // freeze 해 넣는다(survey-read.service.ts 의 snapshot.lookups 사용과 동일 근거) — 안전 단언.
    const snapshotForCalc = versionSnapshot as unknown as {
      questions: Question[];
      lookups?: SurveyLookup[];
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

    const recomputed = withCalcValues(questionResponses, {
      questions: snapshotForCalc.questions,
      responses: questionResponses,
      lookups: snapshotForCalc.lookups ?? [],
      contactAttrs,
    });
    Object.assign(questionResponses, recomputed);
  }

  // 저장은 재암호화 — 판단 기준은 응답의 versionId 스냅샷(레거시 null 은 questions 폴백).
  const piiIds = await loadPiiQuestionIds(existing.versionId, surveyId);
  const storedResponses =
    piiIds.size > 0
      ? encryptResponsesForStorage(questionResponses, piiIds)
      : questionResponses;

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
      })
      .where(
        and(
          eq(surveyResponses.id, responseId),
          eq(surveyResponses.surveyId, surveyId),
          isNull(surveyResponses.deletedAt),
        ),
      )
      .returning({ id: surveyResponses.id });

    if (updated.length === 0) {
      throw new Error('Cannot edit deleted response');
    }

    await replaceResponseAnswers(
      tx,
      responseId,
      surveyId,
      storedResponses,
    );

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

  return { ok: true as const };
}
