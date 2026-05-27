'use server';

import 'server-only';

import { revalidatePath } from 'next/cache';
import { and, eq } from 'drizzle-orm';

import { db } from '@/db';
import { contactTargets, surveyResponses } from '@/db/schema';
import { requireSurveyOwnership } from '@/lib/auth/require-survey-ownership';
import { replaceResponseAnswers } from '@/actions/response-answers-replace';

// 모든 액션은 (surveyId, responseId) 2중 조건으로 동작한다. 잘못된 조합이
// 들어오면 변경 행 0인 상태로 ok:true 반환 — 단일 admin 환경에서는 UI 가
// 항상 올바른 surveyId 를 전달하므로 별도 throw 가 없다.

function revalidate(surveyId: string) {
  revalidatePath(`/admin/surveys/${surveyId}/operations/profiles`);
}

export async function softDeleteResponse(surveyId: string, responseId: string) {
  await requireSurveyOwnership(surveyId);
  await db
    .update(surveyResponses)
    .set({ deletedAt: new Date() })
    .where(
      and(
        eq(surveyResponses.id, responseId),
        eq(surveyResponses.surveyId, surveyId),
      ),
    );
  revalidate(surveyId);
  return { ok: true as const };
}

export async function restoreResponse(surveyId: string, responseId: string) {
  await requireSurveyOwnership(surveyId);
  await db
    .update(surveyResponses)
    .set({ deletedAt: null })
    .where(
      and(
        eq(surveyResponses.id, responseId),
        eq(surveyResponses.surveyId, surveyId),
      ),
    );
  revalidate(surveyId);
  return { ok: true as const };
}

/**
 * 어드민 응답 수정 저장.
 *
 * - questionResponses (JSONB) 와 response_answers 정규화 행을 일괄 갱신.
 * - completedAt / status / startedAt 은 명시적으로 set 하지 않아 보존됨.
 * - lastEditedAt / lastActivityAt 은 갱신, currentStepId 는 null 로 초기화.
 * - totalSeconds 는 startedAt~completedAt 차이로 재계산 (변경 가능성 없으나 명시).
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
  const totalSeconds = existing.completedAt
    ? Math.floor(
        (existing.completedAt.getTime() - existing.startedAt.getTime()) / 1000,
      )
    : null;

  await db.transaction(async (tx) => {
    await tx
      .update(surveyResponses)
      .set({
        questionResponses: payload.questionResponses,
        lastEditedAt: now,
        lastActivityAt: now,
        currentStepId: null,
        totalSeconds,
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

export async function hardResetResponse(surveyId: string, responseId: string) {
  await requireSurveyOwnership(surveyId);
  // contactTargets.responseId 는 onDelete:'set null' 이지만 respondedAt 은
  // cascade 대상이 아니다 — hardReset 의도는 "응답 이력 자체를 지움" 이므로
  // 명시적으로 둘 다 초기화한다.
  await db.transaction(async (tx) => {
    await tx
      .update(contactTargets)
      .set({ responseId: null, respondedAt: null })
      .where(eq(contactTargets.responseId, responseId));
    await tx
      .delete(surveyResponses)
      .where(
        and(
          eq(surveyResponses.id, responseId),
          eq(surveyResponses.surveyId, surveyId),
        ),
      );
  });
  revalidate(surveyId);
  return { ok: true as const };
}
