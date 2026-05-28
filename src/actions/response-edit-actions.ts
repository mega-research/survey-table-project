'use server';

import 'server-only';

import { revalidatePath } from 'next/cache';
import { and, eq } from 'drizzle-orm';

import { db } from '@/db';
import { surveyResponses } from '@/db/schema';
import { requireSurveyOwnership } from '@/lib/auth/require-survey-ownership';
import { replaceResponseAnswers } from '@/actions/response-answers-replace';
import { calculateProgressPct } from '@/lib/operations/response-progress';
import { getProgressSnapshot } from '@/lib/operations/response-progress.server';

function revalidate(surveyId: string) {
  revalidatePath(`/admin/surveys/${surveyId}/operations/profiles`);
}

/**
 * 어드민 응답 수정 저장.
 *
 * - questionResponses (JSONB) 와 response_answers 정규화 행을 일괄 갱신.
 * - completedAt / status / startedAt / totalSeconds 는 명시적으로 set 하지 않아 보존됨.
 * - lastEditedAt / lastActivityAt 은 갱신, currentStepId 는 null 로 초기화.
 * - 삭제(soft delete)된 응답은 거부.
 * - progress_pct: status='completed' 면 100 유지, 그 외는 questionResponses 키 → snapshot
 *   position 매핑으로 재계산. 답변 0개면 NULL 로 reset.
 * - snapshot 은 트랜잭션 바깥에서 조회 — 동시 버전 publish 시 progress_pct 가 일시적으로
 *   구버전 기준이 될 수 있음. 다음 답변/완료 시 재계산되므로 데이터 손실은 없음.
 *
 * spread 사용 금지 — 명시적 set 만.
 */
export interface SaveAdminEditPayload {
  questionResponses: Record<string, unknown>;
}

export async function saveAdminEdit(
  surveyId: string,
  responseId: string,
  payload: SaveAdminEditPayload,
) {
  await requireSurveyOwnership(surveyId);

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

  // progress_pct 재계산: completed 는 100 유지, 그 외는 snapshot 기반 재계산.
  // status 기준 분기 (progressPct === 100 가 아님) — 99% drop 이 우연히 100 으로 반올림된 경우를
  // completed 로 오분류하지 않기 위해.
  let nextProgressPct: number | null;
  if (existing.status === 'completed') {
    nextProgressPct = 100;
  } else {
    const { positionMap, totalQuestions } = await getProgressSnapshot(existing.versionId);
    nextProgressPct = calculateProgressPct(
      Object.keys(payload.questionResponses),
      positionMap,
      totalQuestions,
    );
  }

  await db.transaction(async (tx) => {
    await tx
      .update(surveyResponses)
      .set({
        questionResponses: payload.questionResponses,
        lastEditedAt: now,
        lastActivityAt: now,
        currentStepId: null,
        progressPct: nextProgressPct,
      })
      .where(
        and(
          eq(surveyResponses.id, responseId),
          eq(surveyResponses.surveyId, surveyId),
        ),
      );

    await replaceResponseAnswers(
      tx,
      responseId,
      surveyId,
      payload.questionResponses,
    );
  });

  revalidate(surveyId);
  return { ok: true as const };
}
