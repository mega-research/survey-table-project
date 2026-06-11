import 'server-only';

import { and, eq, isNull } from 'drizzle-orm';

import { db } from '@/db';
import { surveyResponses, surveys, surveyVersions, responseEditLogs } from '@/db/schema';
import type { SurveyVersionSnapshot } from '@/db/schema/schema-types';
import { replaceResponseAnswers } from './response-answers.service';
import { calculateProgressPct } from '@/lib/operations/response-progress';
import { getProgressSnapshot } from '@/lib/operations/response-progress.server';
import {
  buildChangedQuestions,
  diffQuestionResponses,
} from '@/lib/operations/response-edit-diff';
import { SurveyOwnershipError } from '@/lib/auth/require-survey-ownership';

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
  const prevResponses = (existing.questionResponses ?? {}) as Record<string, unknown>;
  const changedIds = diffQuestionResponses(prevResponses, questionResponses);
  let changedQuestions: ReturnType<typeof buildChangedQuestions> = [];
  if (changedIds.length > 0) {
    const [verRow] = existing.versionId
      ? await db
          .select({ snapshot: surveyVersions.snapshot })
          .from(surveyVersions)
          .where(eq(surveyVersions.id, existing.versionId))
          .limit(1)
      : [];
    const snapshot = (verRow?.snapshot ?? null) as SurveyVersionSnapshot | null;
    changedQuestions = buildChangedQuestions(changedIds, snapshot);
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

  await db.transaction(async (tx) => {
    // deletedAt 검사(line 61)와 이 UPDATE 사이에 동시 softDeleteResponse 가 deletedAt 을
    // 세팅하는 TOCTOU 를 차단한다. WHERE 에 isNull(deletedAt) 를 추가하고 .returning() 으로
    // 영향 행 수를 확인 — 0행이면 경합에서 삭제가 이겼으므로 throw 해 트랜잭션 전체(answers
    // 재작성·edit log)를 롤백한다 (BAD_REQUEST 로 매핑됨).
    const updated = await tx
      .update(surveyResponses)
      .set({
        questionResponses: questionResponses,
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
      questionResponses,
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
