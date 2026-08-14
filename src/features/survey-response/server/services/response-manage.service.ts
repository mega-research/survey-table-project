import 'server-only';

import { and, eq, isNull } from 'drizzle-orm';

import { db } from '@/db';
import {
  contactTargets,
  responseEditLogs,
  surveyResponses,
  surveys,
  surveyVersions,
} from '@/db/schema';
import { SurveyOwnershipError } from '@/lib/auth/require-survey-ownership';

import type {
  AllowReeditResponseInput,
  HardResetResponseInput,
  RestoreResponseInput,
  SoftDeleteResponseInput,
} from '../../domain/response-manage';

export { SurveyOwnershipError };

/** 재응답 허용 불가 사유 — 설문이 응답을 받을 수 없는 상태. */
export class ReeditUnavailableError extends Error {
  constructor(
    public readonly reason: 'status_not_published' | 'survey_paused' | 'end_date_passed',
  ) {
    super(`reedit_unavailable:${reason}`);
    this.name = 'ReeditUnavailableError';
  }
}

/**
 * 응답의 컨택 앵커 해석 — 양방향 링크를 모두 본다.
 * 신형 데이터는 survey_responses.contact_target_id, 레거시는
 * contact_targets.response_id 한쪽만 연결된 경우가 있어 역방향도 조회한다.
 */
async function resolveContactAnchor(
  tx: Pick<typeof db, 'select'>,
  surveyId: string,
  responseId: string,
  forwardContactTargetId: string | null,
): Promise<string | null> {
  if (forwardContactTargetId) return forwardContactTargetId;
  const [ct] = await tx
    .select({ id: contactTargets.id })
    .from(contactTargets)
    .where(
      and(
        eq(contactTargets.responseId, responseId),
        eq(contactTargets.surveyId, surveyId),
      ),
    )
    .limit(1);
  return ct?.id ?? null;
}

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
 *
 * 컨택 매칭 응답이면 같은 트랜잭션에서 초기화 마커(action:'reset')를
 * contact_target_id 앵커로 남긴다 — 응답 행 삭제로 일반 수정 로그는 cascade
 * 소멸하지만 마커는 컨택 단건 편집의 수정/편집 현황에 계속 보인다.
 */
export async function hardResetResponse(
  input: HardResetResponseInput,
  editor?: { id: string | null; email: string | null },
): Promise<{ ok: true }> {
  const { surveyId, responseId } = input;
  await assertSurveyExists(surveyId);
  // contactTargets.responseId 는 onDelete:'set null' 이지만 respondedAt 은
  // cascade 대상이 아니다 — hardReset 의도는 "응답 이력 자체를 지움" 이므로
  // 명시적으로 둘 다 초기화한다.
  await db.transaction(async (tx) => {
    // 삭제 전에 컨택 매칭을 읽어야 마커 앵커를 잃지 않는다.
    const [row] = await tx
      .select({ contactTargetId: surveyResponses.contactTargetId })
      .from(surveyResponses)
      .where(
        and(
          eq(surveyResponses.id, responseId),
          eq(surveyResponses.surveyId, surveyId),
        ),
      )
      .limit(1);
    // 앵커는 unlink(responseId null 세팅) 전에 양방향으로 해석해야 잃지 않는다.
    const anchorId = row
      ? await resolveContactAnchor(tx, surveyId, responseId, row.contactTargetId)
      : null;
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
    if (anchorId) {
      await tx.insert(responseEditLogs).values({
        responseId: null,
        contactTargetId: anchorId,
        action: 'reset',
        surveyId,
        editedBy: editor?.id ?? null,
        editorEmail: editor?.email ?? null,
        changedQuestions: [],
        changedCount: 0,
      });
    }
  });
  return { ok: true as const };
}

/**
 * 재응답 허용 — 완료 응답을 답변 보존한 채 진행중으로 되돌린다.
 *
 * 응답자가 관리자에게 "다시 수정하고 싶다"고 요청했을 때 사용한다. 완료 응답을
 * in_progress 로 되돌리고 컨택의 완료 링크(respondedAt/responseId)를 해제하면,
 * 응답자는 기존 초대 링크로 재진입해 기존 답변이 채워진 채 수정·재제출할 수 있다
 * (Track A 의 token_already_used 차단과 컨택 재사용·prefill·완료 재링크가 모두
 * 기존 기계 그대로 동작한다). 재제출하면 다시 완료로 기록된다.
 *
 * 완료 상태가 아니면 변경 0행 no-op (fail-soft, manage 공통 의미론).
 * 잠금 순서는 hardReset 과 동일하게 target → response 를 지킨다.
 *
 * 가드: 설문이 응답을 받을 수 없는 상태(미배포·중단·마감)면 되돌리기 전에
 * ReeditUnavailableError 로 거부한다 — 강등만 되고 재제출이 막히는 고아 상태 방지.
 * 실응답에만 적용하고 테스트 응답은 면제한다(중단 중 테스트 허용 정책과 정합).
 * maxResponses 는 검사하지 않는다 — 되돌리기 자체가 완료 슬롯 하나를 비우므로
 * 재완료는 자기 슬롯을 되찾는 동작이고, 그 사이 다른 응답이 채우는 경합은 기존
 * complete 하드체크의 문서화된 잔여 window 와 동일하게 수용한다.
 */
export async function allowReeditResponse(
  input: AllowReeditResponseInput,
  editor?: { id: string | null; email: string | null },
): Promise<{ ok: true }> {
  const { surveyId, responseId } = input;
  await assertSurveyExists(surveyId);
  const now = new Date();
  await db.transaction(async (tx) => {
    const [row] = await tx
      .select({
        contactTargetId: surveyResponses.contactTargetId,
        isCompleted: surveyResponses.isCompleted,
        isTest: surveyResponses.isTest,
      })
      .from(surveyResponses)
      .where(
        and(
          eq(surveyResponses.id, responseId),
          eq(surveyResponses.surveyId, surveyId),
          isNull(surveyResponses.deletedAt),
        ),
      )
      .limit(1);
    if (!row || !row.isCompleted) return;

    if (!row.isTest) {
      const [gate] = await tx
        .select({
          status: surveys.status,
          isPaused: surveys.isPaused,
          endDate: surveys.endDate,
          currentVersionId: surveys.currentVersionId,
        })
        .from(surveys)
        .where(eq(surveys.id, surveyId))
        .limit(1);
      if (gate) {
        let versionPublished = false;
        if (gate.currentVersionId) {
          const [version] = await tx
            .select({ status: surveyVersions.status })
            .from(surveyVersions)
            .where(eq(surveyVersions.id, gate.currentVersionId))
            .limit(1);
          versionPublished = version?.status === 'published';
        }
        if (gate.status !== 'published' && !versionPublished) {
          throw new ReeditUnavailableError('status_not_published');
        }
        if (gate.isPaused) throw new ReeditUnavailableError('survey_paused');
        if (gate.endDate != null && gate.endDate.getTime() <= Date.now()) {
          throw new ReeditUnavailableError('end_date_passed');
        }
      }
    }

    // 앵커는 unlink 전에 양방향으로 해석한다 (레거시: contact_targets.response_id 만 연결).
    const anchorId = await resolveContactAnchor(
      tx,
      surveyId,
      responseId,
      row.contactTargetId,
    );
    if (anchorId) {
      await tx
        .update(contactTargets)
        .set({ respondedAt: null, responseId: null, updatedAt: now })
        .where(
          and(
            eq(contactTargets.id, anchorId),
            eq(contactTargets.surveyId, surveyId),
          ),
        );
    }
    const reverted = await tx
      .update(surveyResponses)
      .set({
        isCompleted: false,
        status: 'in_progress',
        completedAt: null,
        lastActivityAt: now,
        // 레거시(역방향만 연결) 행은 여기서 정방향 링크를 백필해야 재진입 시
        // findActiveResponseByContact 가 이 행을 찾아 이어가기로 재사용한다.
        contactTargetId: anchorId ?? row.contactTargetId,
      })
      .where(
        and(
          eq(surveyResponses.id, responseId),
          eq(surveyResponses.surveyId, surveyId),
          eq(surveyResponses.isCompleted, true),
        ),
      )
      .returning({ id: surveyResponses.id });
    if (reverted.length > 0 && anchorId) {
      await tx.insert(responseEditLogs).values({
        responseId,
        contactTargetId: anchorId,
        action: 'reedit_allow',
        surveyId,
        editedBy: editor?.id ?? null,
        editorEmail: editor?.email ?? null,
        changedQuestions: [],
        changedCount: 0,
      });
    }
  });
  return { ok: true as const };
}
