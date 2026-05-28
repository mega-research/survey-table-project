'use server';

import 'server-only';

import { revalidatePath } from 'next/cache';
import { and, eq } from 'drizzle-orm';

import { db } from '@/db';
import { contactTargets, surveyResponses } from '@/db/schema';
import { requireSurveyOwnership } from '@/lib/auth/require-survey-ownership';

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
 * 응답 행을 물리적으로 삭제한다.
 * deletedAt 상태와 무관하게 물리 삭제 (active/휴지통 양쪽에서 호출 가능).
 */
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
