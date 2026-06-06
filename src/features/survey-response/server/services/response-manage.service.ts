import 'server-only';

import { and, eq } from 'drizzle-orm';

import { db } from '@/db';
import { contactTargets, surveyResponses, surveys } from '@/db/schema';
import { SurveyOwnershipError } from '@/lib/auth/require-survey-ownership';

import type {
  HardResetResponseInput,
  RestoreResponseInput,
  SoftDeleteResponseInput,
} from '../../domain/response-manage';

export { SurveyOwnershipError };

// 모든 액션은 (surveyId, responseId) 2중 조건으로 동작한다. 잘못된 조합이
// 들어오면 변경 행 0인 상태로 ok:true 반환 — 단일 admin 환경에서는 UI 가
// 항상 올바른 surveyId 를 전달하므로 별도 throw 가 없다.
//
// 인증은 authed 미들웨어가 담당. 소유권 검증(surveys row 존재 확인)은 인증과
// 별개이므로 service 안에 보존한다. 캐시 갱신(revalidatePath)은 소비처 router.refresh 로 대체.

/** 소유권 검증 — surveys row 존재 확인 (require-survey-ownership.ts 패턴 인라인 복제). */
async function assertSurveyExists(surveyId: string): Promise<void> {
  const row = await db.query.surveys.findFirst({
    where: eq(surveys.id, surveyId),
    columns: { id: true },
  });
  if (!row) throw new SurveyOwnershipError('not_found');
}

export async function softDeleteResponse(
  input: SoftDeleteResponseInput,
): Promise<{ ok: true }> {
  const { surveyId, responseId } = input;
  await assertSurveyExists(surveyId);
  await db
    .update(surveyResponses)
    .set({ deletedAt: new Date() })
    .where(
      and(
        eq(surveyResponses.id, responseId),
        eq(surveyResponses.surveyId, surveyId),
      ),
    );
  return { ok: true as const };
}

export async function restoreResponse(
  input: RestoreResponseInput,
): Promise<{ ok: true }> {
  const { surveyId, responseId } = input;
  await assertSurveyExists(surveyId);
  await db
    .update(surveyResponses)
    .set({ deletedAt: null })
    .where(
      and(
        eq(surveyResponses.id, responseId),
        eq(surveyResponses.surveyId, surveyId),
      ),
    );
  return { ok: true as const };
}

/**
 * 응답 행을 물리적으로 삭제한다.
 * deletedAt 상태와 무관하게 물리 삭제 (active/휴지통 양쪽에서 호출 가능).
 */
export async function hardResetResponse(
  input: HardResetResponseInput,
): Promise<{ ok: true }> {
  const { surveyId, responseId } = input;
  await assertSurveyExists(surveyId);
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
  return { ok: true as const };
}
