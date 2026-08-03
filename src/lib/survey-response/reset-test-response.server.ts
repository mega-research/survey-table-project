import { eq } from 'drizzle-orm';
import 'server-only';

import { db } from '@/db';
import { responseAnswers, responseEditLogs, surveyResponses } from '@/db/schema';
import type { PageVisit } from '@/db/schema/schema-types';

type DbTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * 테스트 응답 행을 제자리에서 초기화할 때 새 시도(attempt)의 값으로 덮어쓸 필드.
 *
 * 테스트 응답은 유니크 인덱스 제약으로 "새 행 INSERT" 가 불가능하다
 * (익명은 (survey_id, session_id), 대상자는 survey_responses_test_target_active_unique).
 * 그래서 "처음부터 다시" 는 항상 같은 행의 제자리 리셋으로 구현한다.
 */
export interface TestResponseResetFields {
  sessionId: string;
  versionId: string | null;
  currentStepId: string | null;
  pageVisits: PageVisit[];
  visibleStepIndex?: number | null | undefined;
  visibleStepTotal?: number | null | undefined;
  userAgent?: string | null | undefined;
  ipHash?: string | null | undefined;
  fpHash?: string | null | undefined;
  deviceId?: string | null | undefined;
  platform?: string | null | undefined;
  browser?: string | null | undefined;
}

/**
 * 테스트 응답 행을 새 시도 시작 상태로 되돌린다.
 *
 * 컬럼 집합의 SSOT — 대상자 테스트(resetTestTargetResponse)와 익명 테스트(settleReuseCandidate)가
 * 같은 목록을 공유한다. 하나라도 빠지면 "완료 화면이 다시 뜬다"·"진행률이 남아 있다" 류의
 * 증상이 되므로 새 컬럼 추가 시 이 함수만 고친다.
 *
 * 컨택(contact_targets.respondedAt 되돌림)·시도 장부(test_response_attempts) 정리는
 * 대상자 전용 관심사라 여기 포함하지 않는다 — 호출부가 담당한다.
 */
export async function resetTestResponseRow(
  tx: DbTransaction,
  responseId: string,
  fields: TestResponseResetFields,
): Promise<void> {
  const now = new Date();
  await tx
    .update(surveyResponses)
    .set({
      questionResponses: {},
      isCompleted: false,
      status: 'in_progress',
      completedAt: null,
      startedAt: now,
      lastActivityAt: now,
      versionId: fields.versionId,
      currentStepId: fields.currentStepId,
      pageVisits: fields.pageVisits,
      totalSeconds: null,
      progressPct: null,
      visibleStepIndex: fields.visibleStepIndex ?? null,
      visibleStepTotal: fields.visibleStepTotal ?? null,
      userAgent: fields.userAgent ?? null,
      ipHash: fields.ipHash ?? null,
      fpHash: fields.fpHash ?? null,
      deviceId: fields.deviceId ?? null,
      platform: fields.platform ?? null,
      browser: fields.browser ?? null,
      metadata: null,
      lastEditedAt: null,
      sessionId: fields.sessionId,
    })
    .where(eq(surveyResponses.id, responseId));
  await tx.delete(responseAnswers).where(eq(responseAnswers.responseId, responseId));
  await tx.delete(responseEditLogs).where(eq(responseEditLogs.responseId, responseId));
}
