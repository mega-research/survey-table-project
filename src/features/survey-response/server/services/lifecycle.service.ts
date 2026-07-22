import 'server-only';

import { and, eq, isNull, sql } from 'drizzle-orm';

import { db } from '@/db';
import { surveyResponses } from '@/db/schema';
import { findContactByInviteToken } from '@/lib/duplicate-detection/invite-lookup';
import { getSurveyControlFlags, isValidTestToken } from '@/lib/survey-control';

import type {
  RecordStepVisitInput,
  RecordVisibilitySegmentInput,
  ResumeOrCreateResponseInput,
  ResumeOrCreateResponseOutput,
} from '../../domain/lifecycle';
import { SurveyNotAcceptingResponsesError } from './response.service';

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
 *
 * 중단 모드 게이트(스펙 5절): 설문이 isPaused 면 drop 회복 및 in_progress 터치를 거부한다.
 * 단, 행이 이미 isTest 이거나 유효한 testToken 으로 재진입한 경우는 예외(운영자 QA 목적).
 * 종결 상태 반환과 null 반환(첫 진입)은 게이트 대상이 아니다 — 종결은 이미 끝난 응답이고,
 * 첫 진입은 create 경로(Task 5)가 별도로 게이트한다.
 */
export async function resumeOrCreateResponse(
  input: ResumeOrCreateResponseInput,
): Promise<ResumeOrCreateResponseOutput> {
  const { surveyId, sessionId, inviteToken, testToken } = input;

  if (inviteToken != null && testToken != null) {
    throw new SurveyNotAcceptingResponsesError('invalid_test_token');
  }

  // 중단 모드 게이트(스펙 5절): 함수 진입부에서 1회만 조회해 아래 두 분기(컨택/세션)에서
  // 재사용한다. isPaused=false 인 정상 케이스가 압도적으로 많으므로, 이 조회 자체가
  // 추가 오버헤드지만 게이트 판정에 필수라 트레이드오프로 감수한다.
  const flags = await getSurveyControlFlags(surveyId);
  const isTestSession = flags ? isValidTestToken(flags, testToken) : false;

  // 컨택 매칭 우선순위: 유효한 inviteToken 이 있으면 같은 컨택의 in_progress 응답 우선 resume.
  // - 유효 토큰 + in_progress 행 존재 → 그 행 resume (sessionId 무시)
  // - 유효 토큰 + in_progress 행 없음 → null (호출자가 새 응답 생성)
  // - 무효 토큰 → silent fallback, 일반 sessionId 흐름 진행
  if (inviteToken) {
    const lookup = await findContactByInviteToken(surveyId, inviteToken);
    if (lookup.kind === 'invalid_test') {
      throw new SurveyNotAcceptingResponsesError('invalid_test_token');
    }
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
          isTest: surveyResponses.isTest,
        })
        .from(surveyResponses)
        .where(
          and(
            eq(surveyResponses.contactTargetId, target.id),
            eq(surveyResponses.isCompleted, false),
            // soft-delete 제외 — findActiveResponseByContact 와 동일 가드.
            // 관리자가 진행중 응답을 soft-delete 한 뒤 컨택이 재진입해도 삭제 행을 되살리지 않음.
            isNull(surveyResponses.deletedAt),
          ),
        )
        .limit(1);

      if (existingByContact) {
        const now = new Date();
        if (existingByContact.status === 'drop') {
          // 중단 모드: 행이 isTest 이거나 유효한 테스트 링크로 재진입한 경우만 예외
          if (flags?.isPaused && !existingByContact.isTest && !isTestSession) {
            throw new SurveyNotAcceptingResponsesError('survey_paused');
          }
          await db
            .update(surveyResponses)
            .set({ status: 'in_progress', lastActivityAt: now })
            .where(eq(surveyResponses.id, existingByContact.id));
          return { id: existingByContact.id, status: 'in_progress', resumed: true };
        }
        if (existingByContact.status === 'in_progress') {
          // 중단 모드: 행이 isTest 이거나 유효한 테스트 링크로 재진입한 경우만 예외
          if (flags?.isPaused && !existingByContact.isTest && !isTestSession) {
            throw new SurveyNotAcceptingResponsesError('survey_paused');
          }
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
      isTest: surveyResponses.isTest,
    })
    .from(surveyResponses)
    .where(
      and(
        eq(surveyResponses.surveyId, surveyId),
        eq(surveyResponses.sessionId, sessionId),
        // soft-delete 제외 — 삭제된 응답을 sessionId 재진입으로 되살리지 않음.
        // (completed 등 종결 상태는 그대로 통과시켜야 하므로 isCompleted 필터는 두지 않음.)
        isNull(surveyResponses.deletedAt),
      ),
    )
    .limit(1);

  if (!existing) return null;

  const now = new Date();

  if (existing.status === 'drop') {
    // 중단 모드: 행이 isTest 이거나 유효한 테스트 링크로 재진입한 경우만 예외
    if (flags?.isPaused && !existing.isTest && !isTestSession) {
      throw new SurveyNotAcceptingResponsesError('survey_paused');
    }
    // 회복 — drop → in_progress, lastActivityAt 새로 박는다
    await db
      .update(surveyResponses)
      .set({ status: 'in_progress', lastActivityAt: now })
      .where(eq(surveyResponses.id, existing.id));
    return { id: existing.id, status: 'in_progress', resumed: true };
  }

  if (existing.status === 'in_progress') {
    // 중단 모드: 행이 isTest 이거나 유효한 테스트 링크로 재진입한 경우만 예외
    if (flags?.isPaused && !existing.isTest && !isTestSession) {
      throw new SurveyNotAcceptingResponsesError('survey_paused');
    }
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
