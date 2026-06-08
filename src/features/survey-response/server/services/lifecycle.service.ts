import 'server-only';

import { and, eq, sql } from 'drizzle-orm';

import { db } from '@/db';
import { surveyResponses } from '@/db/schema';
import { findContactByInviteToken } from '@/lib/duplicate-detection/invite-lookup';

import type {
  RecordStepVisitInput,
  RecordVisibilitySegmentInput,
  ResumeOrCreateResponseInput,
  ResumeOrCreateResponseOutput,
} from '../../domain/lifecycle';

// ========================
// 응답 라이프사이클 service (pub)
// ========================

// 아래 함수들은 설문 응답자용이므로 인증 체크하지 않음(pub 미들웨어):
// - recordStepVisit
// - recordVisibilitySegment
// - resumeOrCreateResponse

/**
 * 페이지 이동(스텝 전환) 기록.
 *
 * - 동일 stepId면 no-op (React 더블 이펙트, 네비게이션 레이스 방어)
 * - 그 외 단일 UPDATE로 원자적 처리:
 *   - 이전 마지막 pageVisits 항목의 leftAt을 now()로 (NULL일 때만 — 뒤로갔다 앞으로 시 기존 leftAt 보존)
 *   - 새 항목을 pageVisits 끝에 append
 *   - currentStepId, lastActivityAt 갱신
 *
 * @throws 행이 없으면 에러 — 호출자(T5)는 catch & log하되 사용자 흐름은 막지 않는다
 */
export async function recordStepVisit(input: RecordStepVisitInput): Promise<void> {
  const { responseId, nextStepId, visibleStepIndex, visibleStepTotal } = input;

  // 단일 UPDATE: WHERE 절에서 currentStepId !== nextStepId 조건으로 멱등성 보장
  // jsonb_set은 마지막 항목의 leftAt이 NULL일 때만 갱신, 그 후 || 로 새 항목 append.
  // visible step 진척은 step 이동과 함께 갱신 (동일 step no-op 시엔 미갱신 — 마지막 이동 시점 기준).
  const result = await db
    .update(surveyResponses)
    .set({
      currentStepId: nextStepId,
      visibleStepIndex: visibleStepIndex ?? null,
      visibleStepTotal: visibleStepTotal ?? null,
      lastActivityAt: new Date(),
      pageVisits: sql`(
        CASE
          WHEN jsonb_array_length(COALESCE(${surveyResponses.pageVisits}, '[]'::jsonb)) > 0
           AND (COALESCE(${surveyResponses.pageVisits}, '[]'::jsonb) -> -1 ->> 'leftAt') IS NULL
          THEN jsonb_set(
                 COALESCE(${surveyResponses.pageVisits}, '[]'::jsonb),
                 ARRAY[(jsonb_array_length(COALESCE(${surveyResponses.pageVisits}, '[]'::jsonb)) - 1)::text, 'leftAt'],
                 to_jsonb(now())
               )
          ELSE COALESCE(${surveyResponses.pageVisits}, '[]'::jsonb)
        END
      ) || jsonb_build_array(
        jsonb_build_object(
          'stepId', ${nextStepId}::text,
          'enteredAt', to_jsonb(now())
        )
      )`,
    })
    .where(
      and(
        eq(surveyResponses.id, responseId),
        // 동일 스텝이면 UPDATE 자체를 건너뛴다 (no-op idempotency)
        sql`COALESCE(${surveyResponses.currentStepId}, '') <> ${nextStepId}`,
      ),
    )
    .returning({ id: surveyResponses.id });

  if (result.length === 0) {
    // 행이 없거나 이미 같은 스텝인 경우. 같은 스텝은 no-op이므로 통과해야 함.
    // → 행 존재 여부를 확인해 행이 없을 때만 throw.
    const exists = await db
      .select({ id: surveyResponses.id })
      .from(surveyResponses)
      .where(eq(surveyResponses.id, responseId))
      .limit(1);

    if (exists.length === 0) {
      throw new Error('응답을 찾을 수 없습니다.');
    }
    // 같은 스텝이면 그냥 통과 (no-op)
  }
}

/**
 * Page Visibility 세그먼트 기록 (sendBeacon 대상).
 *
 * - hide: 마지막 visit의 leftAt이 NULL이면 now()로 닫는다. lastActivityAt은 건드리지 않는다
 *   (떠난 시점 기준으로 3h sweep 타이머가 돌도록).
 * - show: 마지막 visit이 닫혀 있으면(또는 빈 배열) currentStepId로 새 visit을 append.
 *   lastActivityAt을 갱신한다(복귀 = 활동).
 * - 둘 다 단일 UPDATE문 — 동시 hide/show 경합 시 PG 행 잠금으로 직렬화(lost update 방지).
 * - status='in_progress' 가드 — 공개 엔드포인트 IDOR 영향 제한 + 완료 후 늦은 beacon no-op.
 */
export async function recordVisibilitySegment(
  input: RecordVisibilitySegmentInput,
): Promise<void> {
  const { responseId, action } = input;

  if (action === 'hide') {
    await db
      .update(surveyResponses)
      .set({
        pageVisits: sql`jsonb_set(
          COALESCE(${surveyResponses.pageVisits}, '[]'::jsonb),
          ARRAY[(jsonb_array_length(COALESCE(${surveyResponses.pageVisits}, '[]'::jsonb)) - 1)::text, 'leftAt'],
          to_jsonb(now())
        )`,
      })
      .where(
        and(
          eq(surveyResponses.id, responseId),
          eq(surveyResponses.status, 'in_progress'),
          sql`jsonb_array_length(COALESCE(${surveyResponses.pageVisits}, '[]'::jsonb)) > 0`,
          sql`(${surveyResponses.pageVisits} -> -1 ->> 'leftAt') IS NULL`,
        ),
      );
    return;
  }

  // action === 'show'
  await db
    .update(surveyResponses)
    .set({
      lastActivityAt: new Date(),
      pageVisits: sql`COALESCE(${surveyResponses.pageVisits}, '[]'::jsonb) || jsonb_build_array(
        jsonb_build_object('stepId', ${surveyResponses.currentStepId}, 'enteredAt', to_jsonb(now()))
      )`,
    })
    .where(
      and(
        eq(surveyResponses.id, responseId),
        eq(surveyResponses.status, 'in_progress'),
        sql`${surveyResponses.currentStepId} IS NOT NULL`,
        sql`(
          jsonb_array_length(COALESCE(${surveyResponses.pageVisits}, '[]'::jsonb)) = 0
          OR (${surveyResponses.pageVisits} -> -1 ->> 'leftAt') IS NOT NULL
        )`,
      ),
    );
}

/**
 * 같은 (surveyId, sessionId) 조합으로 기존 응답이 있으면 회복, 없으면 null 반환.
 *
 * - drop 상태면 in_progress 로 UPDATE + lastActivityAt 갱신
 * - in_progress 면 그대로 (lastActivityAt만 갱신해 stale 방지)
 * - completed/screened_out/quotaful_out/bad 면 그대로 반환 — 호출자가 "이미 끝남" UX 처리
 *
 * 반환 null 이면 첫 진입 — 호출자는 평소대로 createResponseWithFirstAnswer 흐름.
 */
export async function resumeOrCreateResponse(
  input: ResumeOrCreateResponseInput,
): Promise<ResumeOrCreateResponseOutput> {
  const { surveyId, sessionId, inviteToken } = input;

  // 컨택 매칭 우선순위: 유효한 inviteToken 이 있으면 같은 컨택의 in_progress 응답 우선 resume.
  // - 유효 토큰 + in_progress 행 존재 → 그 행 resume (sessionId 무시)
  // - 유효 토큰 + in_progress 행 없음 → null (호출자가 새 응답 생성)
  // - 무효 토큰 → silent fallback, 일반 sessionId 흐름 진행
  if (inviteToken) {
    const lookup = await findContactByInviteToken(surveyId, inviteToken);
    // excluded 도 valid 외 = null 로 fallback (anonymous sessionId 흐름으로 자연 처리).
    // excluded race 차단은 saveResponse 시점의 checkTrackA 가 별도로 책임.
    const target = lookup.kind === 'valid'
      ? { id: lookup.contactTargetId }
      : null;
    if (target) {
      const [existingByContact] = await db
        .select({
          id: surveyResponses.id,
          status: surveyResponses.status,
        })
        .from(surveyResponses)
        .where(
          and(
            eq(surveyResponses.contactTargetId, target.id),
            eq(surveyResponses.isCompleted, false),
          ),
        )
        .limit(1);

      if (existingByContact) {
        const now = new Date();
        if (existingByContact.status === 'drop') {
          await db
            .update(surveyResponses)
            .set({ status: 'in_progress', lastActivityAt: now })
            .where(eq(surveyResponses.id, existingByContact.id));
          return { id: existingByContact.id, status: 'in_progress', resumed: true };
        }
        if (existingByContact.status === 'in_progress') {
          await db
            .update(surveyResponses)
            .set({ lastActivityAt: now })
            .where(eq(surveyResponses.id, existingByContact.id));
          return { id: existingByContact.id, status: 'in_progress', resumed: false };
        }
        // isCompleted=false 인데 in_progress/drop 도 아닌 알 수 없는 status → fallback
      }
      // 유효 토큰이지만 매칭되는 in_progress 응답 없음 → 새 응답 흐름
      return null;
    }
    // 토큰 무효 → 일반 sessionId 흐름 fallback
  }

  const [existing] = await db
    .select({
      id: surveyResponses.id,
      status: surveyResponses.status,
    })
    .from(surveyResponses)
    .where(
      and(eq(surveyResponses.surveyId, surveyId), eq(surveyResponses.sessionId, sessionId)),
    )
    .limit(1);

  if (!existing) return null;

  const now = new Date();

  if (existing.status === 'drop') {
    // 회복 — drop → in_progress, lastActivityAt 새로 박는다
    await db
      .update(surveyResponses)
      .set({ status: 'in_progress', lastActivityAt: now })
      .where(eq(surveyResponses.id, existing.id));
    return { id: existing.id, status: 'in_progress', resumed: true };
  }

  if (existing.status === 'in_progress') {
    // stale 방지용 lastActivityAt 터치
    await db
      .update(surveyResponses)
      .set({ lastActivityAt: now })
      .where(eq(surveyResponses.id, existing.id));
    return { id: existing.id, status: 'in_progress', resumed: false };
  }

  // 종결 상태 — 알려진 값만 통과시키고 알 수 없으면 null 로 fallback
  const concludedStatuses = ['completed', 'screened_out', 'quotaful_out', 'bad'] as const;
  type ConcludedStatus = (typeof concludedStatuses)[number];
  if ((concludedStatuses as readonly string[]).includes(existing.status)) {
    return {
      id: existing.id,
      status: existing.status as ConcludedStatus,
      resumed: false,
    };
  }
  // 알 수 없는 status — 호출자가 새 응답 흐름으로 가도록 null 반환
  console.warn(
    `[resumeOrCreateResponse] 알 수 없는 status 발견: ${existing.status} (id=${existing.id})`,
  );
  return null;
}
