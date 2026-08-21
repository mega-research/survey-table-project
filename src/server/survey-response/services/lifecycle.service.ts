import { and, eq, isNull, sql } from 'drizzle-orm';
import 'server-only';

import { db } from '@/db';
import { surveyResponses, surveyVersions } from '@/db/schema';
import { decryptQuestionResponses } from '@/lib/crypto/response-pii';
import { findContactByInviteToken } from '@/server/shared/invite-lookup';
import { logger } from '@/lib/logger';
import { normalizeQuestions } from '@/lib/question/normalize';
import { toFlatQuestion } from '@/lib/question/variants';
import { getSurveyControlFlags, isValidTestToken } from '@/server/shared/survey-control';
import { applyStructuralSurvival } from '@/lib/survey-response/structural-survival';
import {
  isResumableTestStatus,
  lockAndAssertResponseMutation,
} from './test-target-attempt.server';
import {
  isConcludedResponseStatus,
  isOpenResponseStatus,
} from '@/shared/contracts/survey-response';

import { ongoingResponseDenial } from '../domain/acceptance';
import type {
  RecordStepVisitInput,
  RecordStepVisitOutput,
  RecordVisibilitySegmentInput,
  ResumeOrCreateResponseInput,
  ResumeOrCreateResponseOutput,
} from '../domain/lifecycle';
import { SurveyNotAcceptingResponsesError, extractDraftSeq } from './response.service';

// ========================
// 응답 라이프사이클 service (pub)
// ========================

// 아래 함수들은 설문 응답자용이므로 인증 체크하지 않음(pub 미들웨어):
// - recordStepVisit
// - recordVisibilitySegment
// - resumeOrCreateResponse

interface ResumedRowMigration {
  /** 구조 생존 판정을 통과해 저장된 답변 맵 (저장 형태 — PII 는 암호문 그대로) */
  survivingResponses: Record<string, unknown>;
  /** 답이 폐기·부분 제거된 질문 ID — 클라이언트 재개 위치 롤백의 입력 */
  affectedQuestionIds: string[];
}

/**
 * 응답 버전 이관 (response version migration, ADR-0014) — 재개 시점의 versionId 재고정.
 *
 * 구버전에 고정된 미완료 응답을 현재 발행 버전으로 재고정하고, 기존 답변을
 * 구조 생존 판정으로 걸러 얹는다. 원 버전은 metadata.migratedFromVersionId 로
 * 보존한다 (jsonb_set 부분 갱신 — draftSeq 등 기존 키 불변, 최초 이관 출처 우선).
 *
 * 이관하지 않는 경우(null 반환 — 호출자는 기존 재개 동작 유지):
 * - versionId 미연결(레거시) 행 또는 현재 버전과 일치
 * - 현재 버전 스냅샷 부재·훼손(questions 비배열) — 응답자를 막지 않는다
 * - UPDATE 경합 0행 (동시 이관·재핀) — 이번 재개는 기존 동작으로 폴백
 *
 * 주의: questionResponses 는 통 교체다. 재개는 페이지 로드 직후라 이 세션의 draft 와
 * 경합하지 않지만, 타 탭 draft 가 SELECT~UPDATE 사이에 끼면 그 배치는 유실될 수 있는
 * 잔여 window 다 (WHERE version_id 낙관 가드는 동시 "이관"만 차단).
 */
async function migrateResumedRowIfStale(input: {
  responseId: string;
  rowVersionId: string | null | undefined;
  currentVersionId: string | null | undefined;
  storedResponses: Record<string, unknown>;
  reviveFromDrop: boolean;
  now: Date;
}): Promise<ResumedRowMigration | null> {
  const { responseId, rowVersionId, currentVersionId, storedResponses, reviveFromDrop, now } =
    input;
  if (rowVersionId == null || currentVersionId == null || rowVersionId === currentVersionId) {
    return null;
  }

  const [versionRow] = await db
    .select({ snapshot: surveyVersions.snapshot })
    .from(surveyVersions)
    .where(eq(surveyVersions.id, currentVersionId))
    .limit(1);
  const snap = versionRow?.snapshot as { questions?: unknown } | null | undefined;
  if (!Array.isArray(snap?.questions)) return null;

  const questions = normalizeQuestions(snap.questions, 'preserve').map(toFlatQuestion);
  const survival = applyStructuralSurvival(storedResponses, questions);

  const [updated] = await db
    .update(surveyResponses)
    .set({
      versionId: currentVersionId,
      // jsonb 컬럼 — 객체 그대로 바인딩 (JSON.stringify 금지: 이중 인코딩)
      questionResponses: survival.survivingResponses,
      metadata: sql`jsonb_set(
        COALESCE(${surveyResponses.metadata}, '{}'::jsonb),
        '{migratedFromVersionId}',
        COALESCE(${surveyResponses.metadata}->'migratedFromVersionId', to_jsonb(${rowVersionId}::text)),
        true
      )`,
      lastActivityAt: now,
      ...(reviveFromDrop ? { status: 'in_progress' } : {}),
    })
    .where(and(eq(surveyResponses.id, responseId), eq(surveyResponses.versionId, rowVersionId)))
    .returning({ id: surveyResponses.id });
  if (!updated) return null;

  return {
    survivingResponses: survival.survivingResponses,
    affectedQuestionIds: survival.affectedQuestionIds,
  };
}

/**
 * 재개 시 행 터치 — 되살리기(drop → in_progress) 또는 stale 방지용 lastActivityAt 갱신.
 *
 * 세 재개 분기(테스트 대상 컨택·비-테스트 컨택·세션)가 같은 UPDATE 를 쓴다. WHERE 가 id 뿐인
 * 것은 종전 그대로다 — status 가드로 되살리기 경합을 감지하는 쪽은 response.service 의
 * reviveDroppedResponse(첫 답변 INSERT 경로) 이고, 이 경로는 판정 직후의 무조건 UPDATE 다.
 */
async function touchOrReviveResponse(
  responseId: string,
  opts: { revive: boolean; now: Date },
): Promise<void> {
  await db
    .update(surveyResponses)
    .set(
      opts.revive
        ? { status: 'in_progress', lastActivityAt: opts.now }
        : { lastActivityAt: opts.now },
    )
    .where(eq(surveyResponses.id, responseId));
}

/**
 * 페이지 이동(스텝 전환) 기록.
 *
 * - 동일 stepId면 no-op (React 더블 이펙트, 네비게이션 레이스 방어)
 * - 그 외 단일 UPDATE로 원자적 처리:
 *   - 이전 마지막 pageVisits 항목의 leftAt을 now()로 (NULL일 때만 — 뒤로갔다 앞으로 시 기존 leftAt 보존)
 *   - 새 항목을 pageVisits 끝에 append
 *   - currentStepId, lastActivityAt 갱신
 *
 * 부수적으로 중단(survey_paused) 판정을 함께 반환한다 — 스텝 전환은 이미 매번 이 경로를
 * 지나므로 별도 왕복 없이 세션 도중 중단을 응답자에게 알릴 수 있다. 기록 자체는 중단
 * 여부와 무관하게 그대로 수행한다.
 *
 * @throws 행이 없으면 에러 — 호출자(T5)는 catch & log하되 사용자 흐름은 막지 않는다
 */
export async function recordStepVisit(
  input: RecordStepVisitInput,
): Promise<Pick<RecordStepVisitOutput, 'denial' | 'pausedMessage'>> {
  const { responseId, nextStepId, visibleStepIndex, visibleStepTotal } = input;

  // 단일 UPDATE: WHERE 절에서 currentStepId !== nextStepId 조건으로 멱등성 보장
  // jsonb_set은 마지막 항목의 leftAt이 NULL일 때만 갱신, 그 후 || 로 새 항목 append.
  // visible step 진척은 step 이동과 함께 갱신 (동일 step no-op 시엔 미갱신 — 마지막 이동 시점 기준).
  const row = await db.transaction(async (tx) => {
    const response = await lockAndAssertResponseMutation(tx, {
      responseId,
      attemptId: input.attemptId,
      sessionId: input.sessionId,
    });
    if (!response) {
      throw new Error('응답을 찾을 수 없습니다.');
    }
    await tx
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
      );
    return response;
  });

  // 중단 판정은 UPDATE 와 분리해 트랜잭션 밖에서 읽는다 — 기록은 중단 여부와 무관하게
  // 그대로 남기고(운영 콘솔 현황 유지), 판정만 호출자에게 실어 보낸다.
  // isTest 행은 flags 조회 자체를 skip 하고, flags 미조회(설문 삭제 등)는 fail-open —
  // assertSurveyNotPaused 와 동일한 규약이다. 판정 본체는 domain 이 진다.
  if (row.isTest) return { denial: null, pausedMessage: null };
  const flags = await getSurveyControlFlags(row.surveyId);
  const denial = flags ? ongoingResponseDenial(flags, { isTest: row.isTest }) : null;
  return { denial, pausedMessage: denial ? (flags?.pausedMessage ?? null) : null };
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
export async function recordVisibilitySegment(input: RecordVisibilitySegmentInput): Promise<void> {
  const { responseId, action } = input;

  await db.transaction(async (tx) => {
    await lockAndAssertResponseMutation(tx, {
      responseId,
      attemptId: input.attemptId,
      sessionId: input.sessionId,
    });

    if (action === 'hide') {
      await tx
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
    await tx
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
  });
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
    const target = lookup.kind === 'valid' ? { id: lookup.contactTargetId } : null;
    const isTestTarget = lookup.kind === 'valid' && lookup.isTest;
    if (target) {
      const [existingByContact] = await db
        .select({
          id: surveyResponses.id,
          status: surveyResponses.status,
          isTest: surveyResponses.isTest,
          versionId: surveyResponses.versionId,
          questionResponses: surveyResponses.questionResponses,
          currentStepId: surveyResponses.currentStepId,
          metadata: surveyResponses.metadata,
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
        const draftSeq = extractDraftSeq(existingByContact.metadata);
        if (isTestTarget) {
          // 대상자 테스트 판정표 — in_progress·drop 은 이어하기, 그 외(종결·알 수 없는 값)는
          // null 을 돌려주고 첫 입력의 acquireTestTargetResponse 가 제자리 초기화한다.
          // 두 지점이 같은 판정 함수(isResumableTestStatus)를 쓴다 — 갈라지면 진입에서 복원한 답을
          // 첫 입력이 지우는 조용한 유실이 된다.
          //
          // 버전 불일치는 이탈 여부와 무관한 별개의 안전장치다 — 재배포로 구조가 바뀐 구버전 답을
          // 주입하면 유령 답과 필수 검증 우회가 생기므로 status 와 무관하게 복원하지 않는다.
          const versionMatched = existingByContact.versionId === flags?.currentVersionId;
          if (!versionMatched || !isResumableTestStatus(existingByContact.status)) return null;

          const restored = {
            id: existingByContact.id,
            status: 'in_progress' as const,
            questionResponses: decryptQuestionResponses(existingByContact.questionResponses ?? {}, {
              responseId: existingByContact.id,
            }),
            currentStepId: existingByContact.currentStepId,
            ...(draftSeq !== undefined ? { draftSeq } : {}),
          };
          if (existingByContact.status === 'drop') {
            // 중도 이탈 되살리기 — 아래 비-테스트 컨택 경로와 동일한 UPDATE.
            // 중단 모드 게이트는 두지 않는다: 이 분기의 행은 isTest 라 비-테스트 경로에서도
            // 게이트 예외 대상이며, 운영자 QA 를 막지 않는 것이 기존 동작이다.
            await touchOrReviveResponse(existingByContact.id, { revive: true, now: new Date() });
            return { ...restored, resumed: true };
          }
          return { ...restored, resumed: false };
        }
        const now = new Date();
        // 열림(in_progress·drop) 판정 — contracts 의 isOpenResponseStatus 가 SSOT.
        // 종결·알 수 없는 값은 종전대로 아래 null 로 흘러 첫 답변 경로(decideResponseReuse)가 차단한다.
        if (isOpenResponseStatus(existingByContact.status)) {
          // 중단 모드: 행이 isTest 이거나 유효한 테스트 링크로 재진입한 경우만 예외.
          // 두 면제 갈래를 OR 로 합쳐 domain 의 단일 isTest 면제 규칙에 넘긴다.
          // flags 미조회(설문 삭제 등)는 종전대로 fail-open.
          const contactPausedDenial = flags
            ? ongoingResponseDenial(flags, {
                isTest: existingByContact.isTest || isTestSession,
              })
            : null;
          if (contactPausedDenial) {
            throw new SurveyNotAcceptingResponsesError(contactPausedDenial);
          }
          const reviveFromDrop = existingByContact.status === 'drop';
          // 답·스텝 복원 — invite 토큰 소지 = 이어가기 권한 (2026-08-12 제품 결정):
          // 초대 링크는 컨택별 개인 발송이므로 토큰 소지 자체를 소유 증명으로 보고,
          // 다른 기기·시크릿탭 재진입에도 복호화 답과 진행 위치를 복원한다. 링크 유출 시
          // 제3자가 입력된 답을 열람할 수 있는 트레이드오프는 명시적으로 수용했다 —
          // 과거의 세션 일치 가드(원 브라우저에만 복원)는 이 결정으로 제거됨.
          // - 버전 불일치: 응답 버전 이관으로 현재 버전에 얹어 복원한다. 이관 불능(현재
          //   스냅샷 훼손·경합)이면 복원하지 않는다 — 구버전 답을 신버전 UI 에 그대로
          //   주입하는 유령 답 문제를 되살리지 않기 위함.
          const versionMatches = existingByContact.versionId === flags?.currentVersionId;
          const migration = !versionMatches
            ? await migrateResumedRowIfStale({
                responseId: existingByContact.id,
                rowVersionId: existingByContact.versionId,
                currentVersionId: flags?.currentVersionId,
                storedResponses: existingByContact.questionResponses ?? {},
                reviveFromDrop,
                now,
              })
            : null;
          if (!migration) {
            await touchOrReviveResponse(existingByContact.id, { revive: reviveFromDrop, now });
          }
          const restorePayload =
            versionMatches || migration
              ? {
                  questionResponses: decryptQuestionResponses(
                    migration?.survivingResponses ?? existingByContact.questionResponses ?? {},
                    { responseId: existingByContact.id },
                  ),
                  currentStepId: existingByContact.currentStepId,
                  ...(migration && migration.affectedQuestionIds.length > 0
                    ? { affectedQuestionIds: migration.affectedQuestionIds }
                    : {}),
                }
              : {};
          return {
            id: existingByContact.id,
            status: 'in_progress',
            resumed: reviveFromDrop,
            ...restorePayload,
            ...(draftSeq !== undefined ? { draftSeq } : {}),
            // 재응답 허용으로 되돌린 행 — 상단 안내 배너("끝까지 제출해야 반영") 트리거.
            ...(existingByContact.metadata?.['reeditPendingSince'] ? { reeditPending: true } : {}),
          };
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
      versionId: surveyResponses.versionId,
      questionResponses: surveyResponses.questionResponses,
      currentStepId: surveyResponses.currentStepId,
      metadata: surveyResponses.metadata,
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
  const draftSeq = extractDraftSeq(existing.metadata);

  // 열림(in_progress·drop) 판정 — contracts 의 isOpenResponseStatus 가 SSOT.
  if (isOpenResponseStatus(existing.status)) {
    // 중단 모드: 행이 isTest 이거나 유효한 테스트 링크로 재진입한 경우만 예외.
    // 두 면제 갈래를 OR 로 합쳐 domain 의 단일 isTest 면제 규칙에 넘긴다.
    // flags 미조회(설문 삭제 등)는 종전대로 fail-open.
    const sessionPausedDenial = flags
      ? ongoingResponseDenial(flags, { isTest: existing.isTest || isTestSession })
      : null;
    if (sessionPausedDenial) {
      throw new SurveyNotAcceptingResponsesError(sessionPausedDenial);
    }
    const reviveFromDrop = existing.status === 'drop';
    // 응답 버전 이관 — 구버전 행이면 현재 버전으로 재고정 (실패·불필요 시 null → 기존 동작)
    const migration = await migrateResumedRowIfStale({
      responseId: existing.id,
      rowVersionId: existing.versionId,
      currentVersionId: flags?.currentVersionId,
      storedResponses: existing.questionResponses ?? {},
      reviveFromDrop,
      now,
    });
    if (!migration) {
      // 기존 동작: drop 회복(status 전환) 또는 stale 방지용 lastActivityAt 터치
      await touchOrReviveResponse(existing.id, { revive: reviveFromDrop, now });
    }
    const rawResponses = migration?.survivingResponses ?? existing.questionResponses ?? {};
    return {
      id: existing.id,
      status: 'in_progress',
      resumed: reviveFromDrop,
      questionResponses: decryptQuestionResponses(rawResponses, { responseId: existing.id }),
      currentStepId: existing.currentStepId,
      ...(migration && migration.affectedQuestionIds.length > 0
        ? { affectedQuestionIds: migration.affectedQuestionIds }
        : {}),
      ...(draftSeq !== undefined ? { draftSeq } : {}),
    };
  }

  // 종결 상태 — 알려진 값만 통과시키고 알 수 없으면 null 로 fallback
  // (종결 화이트리스트는 contracts 의 concludedResponseStatusValues 가 SSOT)
  if (isConcludedResponseStatus(existing.status)) {
    return {
      id: existing.id,
      status: existing.status,
      resumed: false,
    };
  }
  // 알 수 없는 status — 호출자가 새 응답 흐름으로 가도록 null 반환
  logger.warn(
    { surveyId, responseId: existing.id, status: existing.status },
    '[resumeOrCreateResponse] 알 수 없는 status 발견 — 새 응답 흐름 fallback',
  );
  return null;
}
