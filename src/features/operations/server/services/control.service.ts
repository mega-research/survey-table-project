import 'server-only';

import { randomUUID } from 'crypto';
import { and, count, eq, isNull } from 'drizzle-orm';

import { db } from '@/db';
import { surveyResponses, surveys } from '@/db/schema/surveys';

export interface SurveyControlState {
  isPaused: boolean;
  pausedMessage: string | null;
  testModeEnabled: boolean;
  testToken: string | null;
  testResponseCount: number;
}

/** 삭제되지 않은 isTest 응답 수 — 모드 OFF 시 일괄 삭제 확인에 사용. */
async function countTestResponses(surveyId: string): Promise<number> {
  const [row] = await db
    .select({ value: count() })
    .from(surveyResponses)
    .where(
      and(
        eq(surveyResponses.surveyId, surveyId),
        eq(surveyResponses.isTest, true),
        isNull(surveyResponses.deletedAt),
      ),
    );
  return row?.value ?? 0;
}

export async function getControlState(surveyId: string): Promise<SurveyControlState> {
  const row = await db.query.surveys.findFirst({
    where: and(eq(surveys.id, surveyId), isNull(surveys.deletedAt)),
    columns: {
      isPaused: true,
      pausedMessage: true,
      testModeEnabled: true,
      testToken: true,
    },
  });
  if (!row) throw new Error('설문을 찾을 수 없습니다.');
  return { ...row, testResponseCount: await countTestResponses(surveyId) };
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
}): Promise<{ testModeEnabled: boolean; testToken: string | null }> {
  const row = await db.query.surveys.findFirst({
    where: and(eq(surveys.id, input.surveyId), isNull(surveys.deletedAt)),
    columns: { testToken: true },
  });
  if (!row) throw new Error('설문을 찾을 수 없습니다.');
  // 토큰은 최초 ON 때 한 번 생성 후 재사용 (rotate 없음 — 스펙 11절)
  const testToken = row.testToken ?? randomUUID();
  const [updated] = await db
    .update(surveys)
    .set({ testModeEnabled: input.enabled, testToken, updatedAt: new Date() })
    .where(eq(surveys.id, input.surveyId))
    .returning({
      testModeEnabled: surveys.testModeEnabled,
      testToken: surveys.testToken,
    });
  if (!updated) throw new Error('테스트 모드 저장에 실패했습니다.');
  return updated;
}

/** isTest 응답 일괄 soft delete — response-manage.service 의 softDeleteResponse 와 동일 방식. */
export async function deleteTestResponses(
  surveyId: string,
): Promise<{ deletedCount: number }> {
  // "삭제 후 끄기"는 하드 딜리트 — 다이얼로그가 "복구할 수 없음"을 안내하므로 행을 실제로
  // 제거한다. response_answers/response_edit_logs 는 FK CASCADE, contact_targets.response_id
  // 는 ON DELETE SET NULL 이라 추가 정리가 필요 없다. 과거 soft delete 로 "삭제된 응답"에
  // 남아 있던 테스트 행도 함께 제거한다 (deleted_at 무관 — 테스트 데이터 전체 정리).
  const deleted = await db
    .delete(surveyResponses)
    .where(
      and(
        eq(surveyResponses.surveyId, surveyId),
        eq(surveyResponses.isTest, true),
      ),
    )
    .returning({ id: surveyResponses.id });
  return { deletedCount: deleted.length };
}
