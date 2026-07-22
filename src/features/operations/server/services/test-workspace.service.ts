import { and, count, eq, inArray, isNull } from 'drizzle-orm';
import 'server-only';

import { db } from '@/db';
import { contactTargets, mailCampaigns, surveyResponses, surveys } from '@/db/schema';
import { type DbTransaction, archiveTestWorkspaceMail } from '@/lib/mail/test-mail-archive.server';

export interface DisableTestWorkspaceResult {
  testModeEnabled: false;
  deletedResponseCount: number;
  deletedTargetCount: number;
  remainingResponseCount: number;
  remainingTargetCount: number;
}

async function countWorkspace(
  tx: DbTransaction,
  surveyId: string,
): Promise<{ responseCount: number; targetCount: number }> {
  const responseRows = await tx
    .select({ total: count() })
    .from(surveyResponses)
    .where(and(eq(surveyResponses.surveyId, surveyId), eq(surveyResponses.isTest, true)));
  const targetRows = await tx
    .select({ total: count() })
    .from(contactTargets)
    .where(and(eq(contactTargets.surveyId, surveyId), eq(contactTargets.isTest, true)));
  return {
    responseCount: responseRows[0]?.total ?? 0,
    targetCount: targetRows[0]?.total ?? 0,
  };
}

/**
 * 테스트 workspace를 끄는 유일한 mutation interface.
 *
 * survey를 먼저 잠가 stale test mutation과 새 campaign 생성을 차단한 뒤, Task 10/11과 같은
 * campaign → contact → recipient 순서로 취소·보관한다.
 */
export async function disableTestWorkspace(input: {
  surveyId: string;
  disposition: 'keep' | 'delete';
}): Promise<DisableTestWorkspaceResult> {
  return db.transaction(async (tx) => {
    const [survey] = await tx
      .select({ id: surveys.id, testModeEnabled: surveys.testModeEnabled })
      .from(surveys)
      .where(eq(surveys.id, input.surveyId))
      .for('update');
    if (!survey) throw new Error('설문을 찾을 수 없습니다.');
    if (!survey.testModeEnabled) {
      throw new Error(
        'TEST_WORKSPACE_DISABLE_STALE: 다른 관리자가 테스트 모드 상태를 변경했습니다.',
      );
    }

    await tx
      .update(surveys)
      .set({ testModeEnabled: false, updatedAt: new Date() })
      .where(eq(surveys.id, input.surveyId));
    await tx
      .update(mailCampaigns)
      .set({ status: 'cancelled', updatedAt: new Date() })
      .where(
        and(
          eq(mailCampaigns.surveyId, input.surveyId),
          eq(mailCampaigns.isTest, true),
          inArray(mailCampaigns.status, ['queued', 'sending']),
          isNull(mailCampaigns.archivedAt),
        ),
      );

    if (input.disposition === 'delete') {
      await archiveTestWorkspaceMail(tx, input.surveyId);
      const deletedResponses = await tx
        .delete(surveyResponses)
        .where(and(eq(surveyResponses.surveyId, input.surveyId), eq(surveyResponses.isTest, true)))
        .returning({ id: surveyResponses.id });
      const deletedTargets = await tx
        .delete(contactTargets)
        .where(and(eq(contactTargets.surveyId, input.surveyId), eq(contactTargets.isTest, true)))
        .returning({ id: contactTargets.id });
      await tx
        .update(surveys)
        .set({ testContactColumns: null, updatedAt: new Date() })
        .where(eq(surveys.id, input.surveyId));
      return {
        testModeEnabled: false as const,
        deletedResponseCount: deletedResponses.length,
        deletedTargetCount: deletedTargets.length,
        remainingResponseCount: 0,
        remainingTargetCount: 0,
      };
    }

    const counts = await countWorkspace(tx, input.surveyId);
    return {
      testModeEnabled: false as const,
      deletedResponseCount: 0,
      deletedTargetCount: 0,
      remainingResponseCount: counts.responseCount,
      remainingTargetCount: counts.targetCount,
    };
  });
}
