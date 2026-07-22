import { and, eq, isNull, ne, sql } from 'drizzle-orm';
import 'server-only';

import { db } from '@/db';
import {
  contactTargets,
  responseAnswers,
  responseEditLogs,
  surveyResponses,
  surveys,
  testResponseAttempts,
} from '@/db/schema';
import type { PageVisit } from '@/db/schema/schema-types';

type DbTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

export interface TestAttemptIdentity {
  attemptId?: string | undefined;
  sessionId?: string | undefined;
}

export interface AcquireTestTargetResponseInput {
  surveyId: string;
  contactTargetId: string;
  sessionId: string;
  attemptId: string;
  versionId: string | null;
  currentStepId: string;
  visibleStepIndex?: number | null | undefined;
  visibleStepTotal?: number | null | undefined;
  userAgent?: string | null;
  ipHash?: string | null;
  fpHash?: string | null;
  deviceId?: string | null;
  platform?: string | null;
  browser?: string | null;
}

export async function assertAnonymousTestSession(
  tx: DbTransaction,
  input: { surveyId: string; testToken: string },
): Promise<void> {
  const [survey] = await tx
    .select({ id: surveys.id })
    .from(surveys)
    .where(
      and(
        eq(surveys.id, input.surveyId),
        eq(surveys.testModeEnabled, true),
        eq(surveys.testToken, input.testToken),
      ),
    )
    .for('share')
    .limit(1);
  if (!survey) {
    throw new Error('테스트 링크가 더 이상 유효하지 않습니다');
  }

  const [count] = await tx
    .select({ total: sql<number>`count(*)::int` })
    .from(contactTargets)
    .where(and(eq(contactTargets.surveyId, input.surveyId), eq(contactTargets.isTest, true)));
  if ((count?.total ?? 0) > 0) {
    throw new Error('테스트 링크가 더 이상 유효하지 않습니다');
  }
}

async function resetTestTargetResponse(
  tx: DbTransaction,
  responseId: string,
  input: AcquireTestTargetResponseInput,
  fixedVersionId: string | null,
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
      versionId: fixedVersionId,
      currentStepId: input.currentStepId,
      pageVisits: [],
      totalSeconds: null,
      progressPct: null,
      visibleStepIndex: input.visibleStepIndex ?? null,
      visibleStepTotal: input.visibleStepTotal ?? null,
      userAgent: input.userAgent ?? null,
      ipHash: input.ipHash ?? null,
      fpHash: input.fpHash ?? null,
      deviceId: input.deviceId ?? null,
      platform: input.platform ?? null,
      browser: input.browser ?? null,
      metadata: null,
      lastEditedAt: null,
      sessionId: input.sessionId,
    })
    .where(eq(surveyResponses.id, responseId));
  await tx.delete(responseAnswers).where(eq(responseAnswers.responseId, responseId));
  await tx.delete(responseEditLogs).where(eq(responseEditLogs.responseId, responseId));
}

export async function acquireTestTargetResponse(
  tx: DbTransaction,
  input: AcquireTestTargetResponseInput,
): Promise<{ responseId: string; reset: boolean }> {
  const [survey] = await tx
    .select({ id: surveys.id, currentVersionId: surveys.currentVersionId })
    .from(surveys)
    .where(and(eq(surveys.id, input.surveyId), eq(surveys.testModeEnabled, true)))
    .for('share')
    .limit(1);
  if (!survey) {
    throw new Error('테스트 링크가 더 이상 유효하지 않습니다');
  }
  const [liveTarget] = await tx
    .select({ id: contactTargets.id })
    .from(contactTargets)
    .where(
      and(
        eq(contactTargets.id, input.contactTargetId),
        eq(contactTargets.surveyId, input.surveyId),
        eq(contactTargets.isTest, true),
      ),
    )
    .for('update')
    .limit(1);
  if (!liveTarget) {
    throw new Error('테스트 링크가 더 이상 유효하지 않습니다');
  }

  let [response] = await tx
    .select()
    .from(surveyResponses)
    .where(
      and(
        eq(surveyResponses.contactTargetId, input.contactTargetId),
        eq(surveyResponses.isTest, true),
        isNull(surveyResponses.deletedAt),
      ),
    )
    .for('update')
    .limit(1);

  const [priorAttempt] = await tx
    .select()
    .from(testResponseAttempts)
    .where(eq(testResponseAttempts.id, input.attemptId))
    .limit(1);
  if (
    priorAttempt &&
    (!response ||
      priorAttempt.status !== 'active' ||
      priorAttempt.responseId !== response.id ||
      priorAttempt.sessionId !== input.sessionId)
  ) {
    throw new Error('테스트 세션이 다른 화면에서 시작되었습니다');
  }

  if (!response) {
    const firstVisit: PageVisit = {
      stepId: input.currentStepId,
      enteredAt: new Date().toISOString(),
    };
    const [inserted] = await tx
      .insert(surveyResponses)
      .values({
        surveyId: input.surveyId,
        contactTargetId: input.contactTargetId,
        sessionId: input.sessionId,
        versionId: survey.currentVersionId,
        questionResponses: {},
        isCompleted: false,
        status: 'in_progress',
        isTest: true,
        currentStepId: input.currentStepId,
        visibleStepIndex: input.visibleStepIndex ?? null,
        visibleStepTotal: input.visibleStepTotal ?? null,
        pageVisits: [firstVisit],
        userAgent: input.userAgent ?? null,
        ipHash: input.ipHash ?? null,
        fpHash: input.fpHash ?? null,
        deviceId: input.deviceId ?? null,
        platform: input.platform ?? null,
        browser: input.browser ?? null,
      })
      .onConflictDoNothing()
      .returning();
    response = inserted;
    if (!response) {
      [response] = await tx
        .select()
        .from(surveyResponses)
        .where(
          and(
            eq(surveyResponses.contactTargetId, input.contactTargetId),
            eq(surveyResponses.isTest, true),
            isNull(surveyResponses.deletedAt),
          ),
        )
        .for('update')
        .limit(1);
    }
  }
  if (!response) throw new Error('테스트 응답을 시작할 수 없습니다');

  const reset =
    response.status !== 'in_progress' || response.versionId !== survey.currentVersionId;
  if (reset) {
    if (priorAttempt) {
      throw new Error('새로 연 테스트 화면에서 다시 입력해주세요');
    }
    await resetTestTargetResponse(tx, response.id, input, survey.currentVersionId);
  }

  const now = new Date();
  await tx
    .update(testResponseAttempts)
    .set({ status: 'superseded', supersededAt: now })
    .where(
      and(
        eq(testResponseAttempts.responseId, response.id),
        eq(testResponseAttempts.status, 'active'),
        ne(testResponseAttempts.id, input.attemptId),
      ),
    );
  if (!priorAttempt) {
    await tx.insert(testResponseAttempts).values({
      id: input.attemptId,
      responseId: response.id,
      sessionId: input.sessionId,
      status: 'active',
    });
  }
  await tx
    .update(surveyResponses)
    .set({ sessionId: input.sessionId })
    .where(eq(surveyResponses.id, response.id));
  await tx
    .update(contactTargets)
    .set({
      responseId: response.id,
      ...(reset ? { respondedAt: null } : {}),
      updatedAt: now,
    })
    .where(eq(contactTargets.id, input.contactTargetId));

  return { responseId: response.id, reset };
}

interface TestResponseWritableRow {
  surveyId: string;
  isTest: boolean;
  contactTargetId: string | null;
}

export async function lockAndAssertResponseMutation(
  tx: DbTransaction,
  input: TestAttemptIdentity & { responseId: string },
): Promise<(TestResponseWritableRow & { id: string }) | null> {
  const preflightRows = await tx
    .select({
      id: surveyResponses.id,
      surveyId: surveyResponses.surveyId,
      isTest: surveyResponses.isTest,
      contactTargetId: surveyResponses.contactTargetId,
    })
    .from(surveyResponses)
    .where(eq(surveyResponses.id, input.responseId))
    .limit(1);
  const preflight = Array.isArray(preflightRows) ? preflightRows[0] : undefined;

  // 소유권 검증은 테스트 응답에만 필요하다. 일반 응답은 기존 UPDATE WHERE 가드를
  // 그대로 사용해 불필요한 행 잠금과 쿼리를 피한다. 행이 없는 경우도 실제 mutation의
  // 0행 처리가 기존 에러/멱등 의미를 유지하도록 여기서 선제로 throw하지 않는다.
  if (!preflight?.isTest) {
    return preflight ?? null;
  }

  await assertTestSurveyEnabled(tx, preflight.surveyId);

  if (preflight.contactTargetId == null) {
    const [count] = await tx
      .select({ total: sql<number>`count(*)::int` })
      .from(contactTargets)
      .where(
        and(eq(contactTargets.surveyId, preflight.surveyId), eq(contactTargets.isTest, true)),
      );
    if ((count?.total ?? 0) > 0) {
      throw new Error('테스트 링크가 더 이상 유효하지 않습니다');
    }
  } else {
    const [target] = await tx
      .select({ id: contactTargets.id })
      .from(contactTargets)
      .where(
        and(
          eq(contactTargets.id, preflight.contactTargetId),
          eq(contactTargets.surveyId, preflight.surveyId),
          eq(contactTargets.isTest, true),
        ),
      )
      .for('update')
      .limit(1);
    if (!target) {
      throw new Error('테스트 링크가 더 이상 유효하지 않습니다');
    }
  }

  const [response] = await tx
    .select({
      id: surveyResponses.id,
      surveyId: surveyResponses.surveyId,
      isTest: surveyResponses.isTest,
      contactTargetId: surveyResponses.contactTargetId,
    })
    .from(surveyResponses)
    .where(eq(surveyResponses.id, input.responseId))
    .for('update')
    .limit(1);
  if (!response) throw new Error('응답을 찾을 수 없습니다.');
  if (
    !response.isTest ||
    response.surveyId !== preflight.surveyId ||
    response.contactTargetId !== preflight.contactTargetId
  ) {
    throw new Error('테스트 링크가 더 이상 유효하지 않습니다');
  }
  if (response.contactTargetId != null) {
    await assertTestTargetAttemptOwner(tx, input);
  }
  return response;
}

async function assertTestSurveyEnabled(tx: DbTransaction, surveyId: string): Promise<void> {
  const [survey] = await tx
    .select({ enabled: surveys.testModeEnabled })
    .from(surveys)
    .where(eq(surveys.id, surveyId))
    .for('share')
    .limit(1);
  if (!survey?.enabled) {
    throw new Error('테스트 링크가 더 이상 유효하지 않습니다');
  }
}

async function assertTestResponseTargetScope(
  tx: DbTransaction,
  response: Pick<TestResponseWritableRow, 'surveyId' | 'contactTargetId'>,
): Promise<void> {
  if (response.contactTargetId == null) {
    const [count] = await tx
      .select({ total: sql<number>`count(*)::int` })
      .from(contactTargets)
      .where(and(eq(contactTargets.surveyId, response.surveyId), eq(contactTargets.isTest, true)));
    if ((count?.total ?? 0) > 0) {
      throw new Error('테스트 링크가 더 이상 유효하지 않습니다');
    }
    return;
  }

  const [target] = await tx
    .select({ id: contactTargets.id })
    .from(contactTargets)
    .where(
      and(
        eq(contactTargets.id, response.contactTargetId),
        eq(contactTargets.surveyId, response.surveyId),
        eq(contactTargets.isTest, true),
      ),
    )
    .limit(1);
  if (!target) {
    throw new Error('테스트 링크가 더 이상 유효하지 않습니다');
  }
}

export async function assertTestResponseWritable(
  tx: DbTransaction,
  response: TestResponseWritableRow,
): Promise<void> {
  if (!response.isTest) return;
  await assertTestSurveyEnabled(tx, response.surveyId);
  await assertTestResponseTargetScope(tx, response);
}

export async function assertTestTargetAttemptOwner(
  tx: DbTransaction,
  input: TestAttemptIdentity & { responseId: string },
): Promise<void> {
  if (!input.attemptId || !input.sessionId) {
    throw new Error('테스트 세션이 다른 화면에서 시작되었습니다');
  }

  const [active] = await tx
    .select({ id: testResponseAttempts.id })
    .from(testResponseAttempts)
    .where(
      and(
        eq(testResponseAttempts.id, input.attemptId),
        eq(testResponseAttempts.responseId, input.responseId),
        eq(testResponseAttempts.sessionId, input.sessionId),
        eq(testResponseAttempts.status, 'active'),
      ),
    )
    .limit(1);
  if (!active) {
    throw new Error('테스트 세션이 다른 화면에서 시작되었습니다');
  }
}
