'use server';

import 'server-only';

import { revalidatePath } from 'next/cache';
import { and, eq } from 'drizzle-orm';

import { db } from '@/db';
import { surveyResponses } from '@/db/schema';
import { requireSurveyOwnership } from '@/lib/auth/require-survey-ownership';
import { replaceResponseAnswers } from '@/actions/response-answers-replace';

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

  await db.transaction(async (tx) => {
    await tx
      .update(surveyResponses)
      .set({
        questionResponses: payload.questionResponses,
        lastEditedAt: now,
        lastActivityAt: now,
        currentStepId: null,
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
