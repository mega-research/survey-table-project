import { and, eq, isNull, sql } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import 'server-only';

import { db } from '@/db';
import { surveys } from '@/db/schema/surveys';
import { getSurveyAccessIdentifier } from '@/lib/survey-url';

export { disableTestWorkspace } from './test-workspace.service';

export interface SurveyControlState {
  isPaused: boolean;
  pausedMessage: string | null;
  testModeEnabled: boolean;
  testToken: string | null;
  accessIdentifier: string;
  testResponseCount: number;
  testTargetCount: number;
  firstTestInviteCode: string | null;
}

export async function getControlState(surveyId: string): Promise<SurveyControlState> {
  // mode와 두 count, 첫 invite를 한 SQL statement snapshot에서 읽어 대상자 생성/삭제나
  // 다른 관리자의 OFF가 query 사이에 끼어드는 혼합 상태를 반환하지 않는다.
  const [row] = await db
    .select({
      isPaused: surveys.isPaused,
      pausedMessage: surveys.pausedMessage,
      testModeEnabled: surveys.testModeEnabled,
      testToken: surveys.testToken,
      id: surveys.id,
      slug: surveys.slug,
      privateToken: surveys.privateToken,
      isPublic: surveys.isPublic,
      testResponseCount: sql<number>`(
        SELECT count(*)::int
        FROM survey_responses AS test_response_scope
        WHERE test_response_scope.survey_id = surveys.id
          AND test_response_scope.is_test = true
          AND test_response_scope.deleted_at IS NULL
      )`.mapWith(Number),
      testTargetCount: sql<number>`(
        SELECT count(*)::int
        FROM contact_targets AS test_target_scope
        WHERE test_target_scope.survey_id = surveys.id
          AND test_target_scope.is_test = true
      )`.mapWith(Number),
      firstTestInviteCode: sql<string | null>`(
        SELECT first_test_target.invite_code
        FROM contact_targets AS first_test_target
        WHERE first_test_target.survey_id = surveys.id
          AND first_test_target.is_test = true
        ORDER BY first_test_target.resid ASC, first_test_target.id ASC
        LIMIT 1
      )`,
    })
    .from(surveys)
    .where(and(eq(surveys.id, surveyId), isNull(surveys.deletedAt)))
    .limit(1);
  if (!row) throw new Error('설문을 찾을 수 없습니다.');
  return {
    isPaused: row.isPaused,
    pausedMessage: row.pausedMessage,
    testModeEnabled: row.testModeEnabled,
    testToken: row.testToken,
    accessIdentifier: getSurveyAccessIdentifier(row),
    testResponseCount: row.testResponseCount,
    testTargetCount: row.testTargetCount,
    firstTestInviteCode: row.firstTestInviteCode,
  };
}

export async function setPaused(input: {
  surveyId: string;
  isPaused: boolean;
  pausedMessage?: string | null;
}): Promise<{ isPaused: boolean; pausedMessage: string | null }> {
  const [updated] = await db
    .update(surveys)
    .set({
      isPaused: input.isPaused,
      // 중단 시에만 문구 갱신 — 재개 시 문구는 보존해 다음 중단 프리필로 쓴다
      ...(input.pausedMessage !== undefined ? { pausedMessage: input.pausedMessage } : {}),
      updatedAt: new Date(),
    })
    .where(eq(surveys.id, input.surveyId))
    .returning({ isPaused: surveys.isPaused, pausedMessage: surveys.pausedMessage });
  if (!updated) throw new Error('설문 중단 상태 저장에 실패했습니다.');
  return updated;
}

export async function setTestMode(input: {
  surveyId: string;
  enabled: boolean;
}): Promise<SurveyControlState> {
  if (!input.enabled) {
    throw new Error('테스트 모드 OFF는 disableTestWorkspace를 사용해야 합니다.');
  }
  const row = await db.query.surveys.findFirst({
    where: and(eq(surveys.id, input.surveyId), isNull(surveys.deletedAt)),
    columns: { id: true, slug: true, privateToken: true, isPublic: true, testToken: true },
  });
  if (!row) throw new Error('설문을 찾을 수 없습니다.');
  // 토큰은 최초 ON 때 한 번 생성 후 재사용 (rotate 없음 — 스펙 11절). 신규는 짧은 nanoid.
  const testToken = row.testToken ?? nanoid(8);
  const [updated] = await db
    .update(surveys)
    .set({ testModeEnabled: input.enabled, testToken, updatedAt: new Date() })
    .where(eq(surveys.id, input.surveyId))
    .returning({
      testModeEnabled: surveys.testModeEnabled,
      testToken: surveys.testToken,
    });
  if (!updated) throw new Error('테스트 모드 저장에 실패했습니다.');
  return getControlState(input.surveyId);
}
